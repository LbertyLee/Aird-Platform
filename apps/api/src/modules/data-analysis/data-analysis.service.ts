import { createHash } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ResearchFilters,
  ResearchSearchResponse,
} from '@agent/contracts';
import { EmbeddingService } from '../../infrastructure/ai/embedding.service';
import { MilvusService } from '../../infrastructure/milvus/milvus.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AiQueryService } from '../ai-query/ai-query.service';
import type { SemanticResolution } from '../semantic/semantic.types';
import type { ResearchQueryPlan } from '../search/research-query-plan';
import { ResearchRepository } from '../../research/research.repository';
import { ResearchCatalogService } from '../../research/research-catalog.service';
import { QueryPlannerService } from '../../research/query-planner.service';
import {
  mapQueryEvidenceToSources,
  toResearchSourceResponse,
} from '../../research/query-evidence-sources.mapper';
import { normalizeFilters, normalizeQuery } from '../search/search-normalization';
import { timeRangeLabelsForPlan } from '../../common/utils/recent-years';

/**
 * 用户端数据分析检索：关系型数据 + 知识库，范围限定为公共库 + 本人库。
 */
@Injectable()
export class DataAnalysisService {
  private readonly logger = new Logger(DataAnalysisService.name);
  private readonly cacheTtlSeconds: number;
  private readonly cacheVersion: string;
  private readonly embeddingModel: string;

  constructor(
    private readonly aiQuery: AiQueryService,
    private readonly repository: ResearchRepository,
    private readonly catalog: ResearchCatalogService,
    private readonly planner: QueryPlannerService,
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly milvus: MilvusService,
    config: ConfigService,
  ) {
    this.cacheTtlSeconds =
      config.get<number>('RESEARCH_CACHE_TTL_SECONDS') ?? 3600;
    this.cacheVersion = config.get<string>('RESEARCH_CACHE_VERSION') ?? 'v1';
    this.embeddingModel = config.get<string>('EMBEDDING_MODEL') ?? 'unknown';
  }

  getStatus() {
    return {
      vectorSearch: this.embedding.isReady() && this.milvus.isReady(),
    };
  }

  async search(
    userId: string,
    query: string,
    filters?: Partial<ResearchFilters>,
    options: {
      persistHistory?: boolean;
      prepared?: {
        optimizedQuery: string;
        resolution: SemanticResolution;
        plan: ResearchQueryPlan;
      };
      skipBranchAnswer?: boolean;
    } = {},
  ): Promise<ResearchSearchResponse> {
    const persistHistory = options.persistHistory ?? true;
    const normalizedQuery = normalizeQuery(query);
    const normalizedFilters = normalizeFilters(filters);
    const catalog = await this.catalog.load();
    const legacyPlan = this.planner.plan(
      normalizedQuery,
      catalog,
      normalizedFilters,
    );
    const fingerprint = this.queryFingerprint(normalizedQuery, normalizedFilters);
    const runId = persistHistory
      ? await this.repository.createRun({
          query: normalizedQuery,
          fingerprint,
          filters: normalizedFilters,
          userId,
        })
      : randomUUID();

    try {
      const prepared = options.prepared ?? (await this.aiQuery.prepareQuery(normalizedQuery, normalizedFilters));
      const knowledgeResult = await this.aiQuery.execute(
        normalizedQuery,
        normalizedFilters,
        'knowledge',
        {
          userId,
          disableExternalSearch: true,
          optimizedQuery: prepared.optimizedQuery,
          resolution: prepared.resolution,
          plan: prepared.plan,
          skipBranchAnswer: options.skipBranchAnswer,
        },
      );
      const sources = await mapQueryEvidenceToSources(
        await this.prisma.queryEvidence.findMany({
          where: { aiQueryId: knowledgeResult.aiQueryId },
          orderBy: { createdAt: 'asc' },
        }),
        {
          repository: this.repository,
          prisma: this.prisma,
          userId,
        },
      );
      const plan = this.semanticToPlan(
        normalizedQuery,
        prepared.optimizedQuery,
        knowledgeResult.resolution,
        legacyPlan,
      );
      const usedExa = false;
      const answer = knowledgeResult.answer;
      const stages = knowledgeResult.stages;
      const cacheExpiresAt = new Date(
        Date.now() + this.cacheTtlSeconds * 1000,
      );

      if (persistHistory) {
        await this.repository.completeRun({
          id: runId,
          matchedLocally: sources.length > 0,
          usedExa,
          sourceIds: sources.map((source) => source.id),
          sourceScores: Object.fromEntries(
            sources
              .filter((source) => source.score !== undefined)
              .map((source) => [source.id, source.score!]),
          ),
          cacheExpiresAt,
          reportMarkdown: answer,
          resultJson: {
            runId, query: normalizedQuery, mode: 'knowledge', matchedLocally: sources.length > 0,
            usedExa, exaConfigured: false, cacheHit: false, cachedAt: null, plan,
            sources: sources.map((source) => this.toResponseSource(source)), stages, answer, aiQueryId: knowledgeResult.aiQueryId,
          },
        });
      }

      return {
        runId,
        query: normalizedQuery,
        mode: 'knowledge',
        matchedLocally: sources.length > 0,
        usedExa,
        exaConfigured: false,
        cacheHit: false,
        cachedAt: null,
        plan,
        sources: sources.map((source) => this.toResponseSource(source)),
        stages,
        answer,
        aiQueryId: knowledgeResult.aiQueryId,
      } as ResearchSearchResponse;
    } catch (error) {
      this.logger.error(
        `Data analysis search failed: ${this.errorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      if (persistHistory) {
        await this.repository.failRun(runId, this.errorMessage(error));
      }
      throw error;
    }
  }

  private semanticToPlan(
    originalQuery: string,
    optimizedQuery: string,
    resolution: SemanticResolution,
    fallback: ResearchSearchResponse['plan'],
  ): ResearchSearchResponse['plan'] {
    const countries = uniqueStrings([
      ...resolution.dimensions
        .filter((d) => d.type === 'country_region')
        .map((d) => d.name),
      ...fallback.countries,
    ]);
    const regions = uniqueStrings([
      ...resolution.dimensions
        .filter((d) => /^(region|province|city|area)$/.test(d.type))
        .map((d) => d.name),
      ...fallback.regions,
    ]);
    const entities = uniqueStrings([
      ...resolution.entities.map((e) => e.name),
      ...(resolution.discovery?.entities ?? []),
      ...fallback.entities,
    ]);
    const indicators = uniqueStrings([
      ...resolution.metrics.map((m) => m.name),
      ...(resolution.discovery?.metrics ?? []),
      ...fallback.indicators,
    ]);
    const dimensions = uniqueStrings([
      ...resolution.dimensions.map((dimension) => dimension.name),
      ...(resolution.discovery?.dimensions ?? []),
      ...(fallback.dimensions ?? []),
    ]);
    const resolvedTimeRanges = timeRangeLabelsForPlan(
      originalQuery,
      optimizedQuery,
      {
        year:
          resolution.time.type === 'YEAR' ? resolution.time.value : undefined,
        start:
          resolution.time.type === 'RANGE' ? resolution.time.start : undefined,
        end:
          resolution.time.type === 'RANGE' ? resolution.time.end : undefined,
      },
    );
    const timeRanges = resolvedTimeRanges.length
      ? resolvedTimeRanges
      : fallback.timeRanges;

    const explanationParts = [
      countries.length ? `国家：${countries.join('、')}` : '',
      indicators.length ? `指标：${indicators.join('、')}` : '',
      entities.length ? `实体：${entities.join('、')}` : '',
      dimensions.length ? `维度：${dimensions.join('、')}` : '',
      resolution.concepts.length
        ? `概念：${resolution.concepts.map((c) => c.name).join('、')}`
        : '',
      timeRanges.length ? `时间：${timeRanges.join('、')}` : '',
    ].filter(Boolean);

    return {
      countries,
      regions,
      entities,
      indicators,
      dimensions,
      entityGroups: resolution.entityGroups,
      timeRanges,
      sources: fallback.sources,
      intent:
        resolution.intent === 'metric_query'
          ? ('lookup' as const)
          : resolution.intent === 'analysis'
            ? ('trend' as const)
            : fallback.intent,
      confidence: resolution.confidence,
      explanation:
        explanationParts.length > 0
          ? `已识别${explanationParts.join('；')}。`
          : fallback.explanation,
    };
  }

  private toResponseSource(
    source: Parameters<typeof toResearchSourceResponse>[0],
  ): ResearchSearchResponse['sources'][number] {
    return toResearchSourceResponse(source);
  }

  private queryFingerprint(
    query: string,
    filters: ResearchFilters,
  ): string {
    const canonicalFilters = Object.fromEntries(
      Object.entries(filters).map(([key, values]) => [
        key,
        [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort(),
      ]),
    );
    return createHash('sha256')
      .update(
        JSON.stringify({
          scope: 'user-data-analysis',
          query: query.replace(/\s+/g, ' ').trim().toLowerCase(),
          filters: canonicalFilters,
          embeddingModel: this.embeddingModel,
          cacheVersion: this.cacheVersion,
        }),
      )
      .digest('hex');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
