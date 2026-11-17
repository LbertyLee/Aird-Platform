import { Injectable, Logger } from '@nestjs/common';
import {
  CommonStatus,
  FieldMappingSource,
} from '@prisma/client';
import { DeepSeekChatService } from '../../infrastructure/ai/deepseek-chat.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { knowledgeStructuredDatasetWhere } from '../dataset/dataset-scope';
import {
  classifyMatchConfidence,
  matchFieldsToIndicators,
  type FieldMappingFieldInput,
  type FieldMappingMatchCandidate,
  type FieldMappingScoredMatch,
} from './field-mapping-match';

export type FieldMappingAutoApplyResult = {
  datasetVersionId: string;
  created: number;
  updated: number;
  skippedManual: number;
  active: number;
  pending: number;
  llmReviewed: number;
  llmRejected: number;
};

/**
 * 结构化字段 → 指标映射自动生成。
 * 仅规则满分(1.0)直接启用；其余候选经 LLM 审核后决定启用或丢弃；
 * LLM 不可用时降级为待确认，绝不因模糊规则直接启用。
 */
@Injectable()
export class FieldMappingAutoService {
  private readonly logger = new Logger(FieldMappingAutoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: DeepSeekChatService,
  ) {}

  /**
   * 对单个 READY 数据集版本跑自动映射。
   * 不覆盖 source=manual 的已有映射。
   */
  async applyForDatasetVersion(
    datasetVersionId: string,
  ): Promise<FieldMappingAutoApplyResult> {
    const empty: FieldMappingAutoApplyResult = {
      datasetVersionId,
      created: 0,
      updated: 0,
      skippedManual: 0,
      active: 0,
      pending: 0,
      llmReviewed: 0,
      llmRejected: 0,
    };

    const schema = await this.prisma.datasetSchema.findUnique({
      where: { datasetVersionId },
      include: {
        fields: true,
        datasetVersion: { select: { status: true, isCurrent: true } },
      },
    });
    if (!schema || schema.datasetVersion.status !== 'ready') {
      return empty;
    }

    const fields: FieldMappingFieldInput[] = schema.fields.map((f) => ({
      id: f.id,
      fieldName: f.fieldName,
      displayName: f.displayName,
      dataType: f.dataType,
      semanticType: f.semanticType,
    }));
    if (!fields.length) return empty;

    const indicators = await this.loadIndicatorCandidates();
    const indicatorById = new Map(indicators.map((i) => [i.id, i]));
    const fieldById = new Map(fields.map((f) => [f.id, f]));
    const matches = matchFieldsToIndicators(fields, indicators);
    if (!matches.length) return empty;

    const exact: FieldMappingScoredMatch[] = [];
    const needsLlm: FieldMappingScoredMatch[] = [];
    for (const match of matches) {
      const band = classifyMatchConfidence(match.confidence);
      if (band === 'exact') exact.push(match);
      else if (band === 'needs_llm') needsLlm.push(match);
    }

    let llmAccepted = new Set<string>();
    let llmRejected = 0;
    let llmReviewed = 0;
    let llmUnavailable = false;

    if (needsLlm.length) {
      const candidates = needsLlm.map((m, idx) => {
        const ind = indicatorById.get(m.indicatorId)!;
        const field = fieldById.get(m.datasetFieldId)!;
        return {
          id: `c${idx}`,
          match: m,
          indicatorCode: ind.code,
          indicatorName: ind.name,
          indicatorAliases: ind.aliases,
          fieldName: field.fieldName,
          displayName: field.displayName,
          dataType: field.dataType,
          ruleScore: m.confidence,
          matchTerm: m.matchTerm,
        };
      });

      const acceptedIds = await this.chat.verifyFieldMappingCandidates(
        candidates.map(({ match: _m, ...rest }) => rest),
      );
      llmReviewed = candidates.length;

      if (acceptedIds == null) {
        // LLM 不可用/失败：全部降级待确认，不自动启用
        llmUnavailable = true;
        for (const c of candidates) {
          llmAccepted.add(c.id);
        }
      } else {
        const acceptedSet = new Set(acceptedIds);
        for (const c of candidates) {
          if (acceptedSet.has(c.id)) llmAccepted.add(c.id);
          else llmRejected += 1;
        }
      }
    }

    type Planned = {
      match: FieldMappingScoredMatch;
      source: FieldMappingSource;
      status: CommonStatus;
    };

    const planned: Planned[] = [];
    for (const match of exact) {
      planned.push({
        match,
        source: FieldMappingSource.auto,
        status: CommonStatus.active,
      });
    }

    needsLlm.forEach((match, idx) => {
      const cid = `c${idx}`;
      if (!llmAccepted.has(cid)) return;
      if (llmUnavailable) {
        planned.push({
          match,
          source: FieldMappingSource.auto_pending,
          status: CommonStatus.disabled,
        });
      } else {
        planned.push({
          match,
          source: FieldMappingSource.auto,
          status: CommonStatus.active,
        });
      }
    });

    let created = 0;
    let updated = 0;
    let skippedManual = 0;
    let active = 0;
    let pending = 0;

    for (const item of planned) {
      const { match, source, status } = item;
      const existing = await this.prisma.indicatorFieldMapping.findFirst({
        where: {
          indicatorId: match.indicatorId,
          datasetFieldId: match.datasetFieldId,
        },
      });

      if (existing) {
        if (existing.source === FieldMappingSource.manual) {
          skippedManual += 1;
          continue;
        }
        await this.prisma.indicatorFieldMapping.update({
          where: { id: existing.id },
          data: {
            source,
            status,
            confidence: match.confidence,
            matchTerm: match.matchTerm.slice(0, 256),
            aggregation: match.aggregation,
            priority: Math.round(match.confidence * 100),
          },
        });
        updated += 1;
      } else {
        const manualOnIndicator =
          await this.prisma.indicatorFieldMapping.findFirst({
            where: {
              indicatorId: match.indicatorId,
              source: FieldMappingSource.manual,
              datasetField: {
                datasetSchemaId: schema.id,
              },
            },
            select: { id: true },
          });
        if (manualOnIndicator) {
          skippedManual += 1;
          continue;
        }

        await this.prisma.indicatorFieldMapping.create({
          data: {
            indicatorId: match.indicatorId,
            datasetFieldId: match.datasetFieldId,
            aggregation: match.aggregation,
            priority: Math.round(match.confidence * 100),
            source,
            status,
            confidence: match.confidence,
            matchTerm: match.matchTerm.slice(0, 256),
          },
        });
        created += 1;
      }

      if (status === CommonStatus.active) active += 1;
      else pending += 1;
    }

    // 清理：同版本上此前自动误映射、本次已被 LLM 拒绝的 auto 记录
    if (llmRejected > 0 && needsLlm.length) {
      const rejectedMatches = needsLlm.filter((_, idx) => !llmAccepted.has(`c${idx}`));
      for (const match of rejectedMatches) {
        await this.prisma.indicatorFieldMapping.deleteMany({
          where: {
            indicatorId: match.indicatorId,
            datasetFieldId: match.datasetFieldId,
            source: {
              in: [FieldMappingSource.auto, FieldMappingSource.auto_pending],
            },
          },
        });
      }
    }

    this.logger.log(
      `auto field-mapping version=${datasetVersionId} created=${created} updated=${updated} active=${active} pending=${pending} llmReviewed=${llmReviewed} llmRejected=${llmRejected} skippedManual=${skippedManual}`,
    );

    return {
      datasetVersionId,
      created,
      updated,
      skippedManual,
      active,
      pending,
      llmReviewed,
      llmRejected,
    };
  }

  /**
   * 按数据集当前 READY 版本重跑；未指定则对知识库结构化 READY 全量重跑。
   */
  async reapply(datasetId?: string): Promise<{
    datasets: number;
    results: FieldMappingAutoApplyResult[];
  }> {
    const versions = await this.prisma.datasetVersion.findMany({
      where: {
        isCurrent: true,
        status: 'ready',
        schema: { isNot: null },
        dataset: {
          deletedAt: null,
          ...(datasetId
            ? { id: datasetId }
            : knowledgeStructuredDatasetWhere()),
        },
      },
      select: { id: true },
      take: 500,
      orderBy: { updatedAt: 'desc' },
    });

    const results: FieldMappingAutoApplyResult[] = [];
    for (const version of versions) {
      results.push(await this.applyForDatasetVersion(version.id));
    }
    return { datasets: results.length, results };
  }

  private async loadIndicatorCandidates(): Promise<
    FieldMappingMatchCandidate[]
  > {
    const rows = await this.prisma.indicator.findMany({
      where: { deletedAt: null, status: CommonStatus.active },
      select: {
        id: true,
        code: true,
        name: true,
        aliases: { select: { alias: true } },
      },
      take: 3000,
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      aliases: row.aliases.map((a) => a.alias),
    }));
  }
}
