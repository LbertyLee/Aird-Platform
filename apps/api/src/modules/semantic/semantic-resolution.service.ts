import { Injectable, Logger } from '@nestjs/common';
import { CommonStatus } from '@prisma/client';
import { DeepSeekChatService } from '../../infrastructure/ai/deepseek-chat.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { inferQueryRegions } from '../../common/utils/query-regions';
import { externalSourceDatasetWhere } from '../dataset/dataset-scope';
import { rankIndicatorsForQuery } from '../analysis/indicator-query-rank';
import type {
  LlmSemanticParseResult,
  ResolvedConcept,
  ResolvedDimension,
  ResolvedEntity,
  ResolvedMetric,
  ResolvedTime,
  SemanticCatalog,
  SemanticResolution,
} from './semantic.types';
import {
  parseRecentYearCount,
  recentCompletedYearRange,
  recentYearRangeForQueries,
} from '../../common/utils/recent-years';

type IndicatorRow = {
  id: string;
  code: string;
  name: string;
  aliases: Array<{ alias: string }>;
};

type EntityRow = {
  id: string;
  code: string;
  name: string;
  canonicalName: string;
  aliases: Array<{ alias: string }>;
};

type ConceptRow = {
  id: string;
  code: string;
  name: string;
  aliases: Array<{ alias: string }>;
};

type DictRow = {
  type: string;
  code: string;
  name: string;
  aliases: string[];
};

/**
 * Semantic Layer 解析：由大模型理解自然语言，再对照业务目录落地 code。
 * 未配置 LLM 时退化为目录子串匹配兜底。
 */
@Injectable()
export class SemanticResolutionService {
  private readonly logger = new Logger(SemanticResolutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chat: DeepSeekChatService,
  ) {}

  async resolve(query: string): Promise<SemanticResolution> {
    const text = query.trim();
    const [indicators, entities, concepts, dictionaries, sources] =
      await Promise.all([
        this.prisma.indicator.findMany({
          where: { status: CommonStatus.active, deletedAt: null },
          include: { aliases: true },
        }),
        this.prisma.semanticEntity.findMany({
          where: { status: CommonStatus.active },
          include: { aliases: true },
        }),
        this.prisma.semanticConcept.findMany({
          where: { status: CommonStatus.active },
          include: { aliases: true },
        }),
        this.prisma.dictionaryItem.findMany({
          where: { status: CommonStatus.active, deletedAt: null },
        }),
        this.prisma.dataset.findMany({
          where: {
            status: CommonStatus.active,
            publishStatus: 'published',
            deletedAt: null,
            ...externalSourceDatasetWhere(),
          },
          select: { name: true, websiteUrl: true },
        }),
      ]);

    const catalog = this.buildCatalog(
      indicators,
      entities,
      concepts,
      dictionaries,
    );
    catalog.sources = sources;

    if (!this.chat.isReady()) {
      this.logger.warn(
        'AI_API_KEY 未配置，Qwen 语义解析无法调用大模型，将使用目录兜底匹配',
      );
      return this.applyRecentYearOverride(
        text,
        this.enrichRegionalResolution(
          text,
          this.fallbackResolve(
            text,
            indicators,
            entities,
            concepts,
            dictionaries,
          ),
        ),
      );
    }

    const parsed = await this.chat.parseSemanticQuery(text, catalog);
    if (parsed) {
      const grounded = this.ground(
        parsed,
        indicators,
        entities,
        concepts,
        dictionaries,
        text,
      );
      let resolution = grounded;
      // LLM 常把「近5年」漏成 UNKNOWN，或臆造过时的 2019-2023 等区间
      if (grounded.time.type === 'UNKNOWN') {
        const inferred = this.inferTimeFallback(text);
        if (inferred.type !== 'UNKNOWN') {
          resolution = { ...grounded, time: inferred };
        }
      }
      return this.applyRecentYearOverride(
        text,
        this.enrichRegionalResolution(text, resolution),
      );
    }

    this.logger.warn('大模型语义解析失败，回退到目录兜底匹配');
    return this.applyRecentYearOverride(
      text,
      this.enrichRegionalResolution(
        text,
        this.fallbackResolve(
          text,
          indicators,
          entities,
          concepts,
          dictionaries,
        ),
      ),
    );
  }

  /** 「近 N 年」以当前日历为准，取最近 N 个完整公历年（不含当年）。 */
  private applyRecentYearOverride(
    query: string,
    resolution: SemanticResolution,
  ): SemanticResolution {
    const anchored = recentYearRangeForQueries(query);
    if (!anchored) return resolution;
    return {
      ...resolution,
      time: { type: 'RANGE', start: anchored.start, end: anchored.end },
    };
  }

  /**
   * Region names may be absent from the business catalog or omitted by the LLM.
   * Keep deterministic province and city matching so
   * structured queries can filter the row entity instead of broadening to
   * the country only. These values intentionally use a dimension rather than
   * requiring every province to be seeded as a SemanticEntity.
   */
  private enrichRegionalResolution(
    query: string,
    resolution: SemanticResolution,
  ): SemanticResolution {
    const regions = inferQueryRegions(query);
    if (!regions.length) return resolution;
    const dimensions = resolution.dimensions.filter(
      (item) => !/^(region|province|city|area|country_region)$/.test(item.type),
    );
    for (const region of regions) {
      dimensions.push({
        type: 'region',
        code: region,
        name: region,
        value: region,
      });
    }
    // A specific province is more selective than a generic country entity.
    const entities = resolution.entities.filter(
      (item) => item.name !== '中国' && item.name !== '中华人民共和国',
    );
    return { ...resolution, entities, dimensions };
  }

  private buildCatalog(
    indicators: IndicatorRow[],
    entities: EntityRow[],
    concepts: ConceptRow[],
    dictionaries: DictRow[],
  ): SemanticCatalog {
    return {
      metrics: indicators.map((i) => ({
        code: i.code,
        name: i.name,
        aliases: i.aliases.map((a) => a.alias),
      })),
      entities: entities.map((e) => ({
        code: e.code,
        name: e.canonicalName || e.name,
        aliases: e.aliases.map((a) => a.alias),
      })),
      concepts: concepts.map((c) => ({
        code: c.code,
        name: c.name,
        aliases: c.aliases.map((a) => a.alias),
      })),
      dimensions: dictionaries.map((d) => ({
        code: d.code,
        name: d.name,
        type: d.type,
        aliases: d.aliases ?? [],
      })),
    };
  }

  private ground(
    parsed: LlmSemanticParseResult,
    indicators: IndicatorRow[],
    entities: EntityRow[],
    concepts: ConceptRow[],
    dictionaries: DictRow[],
    query: string,
  ): SemanticResolution {
    const metricByCode = new Map(indicators.map((i) => [i.code, i]));
    const entityByCode = new Map(entities.map((e) => [e.code, e]));
    const conceptByCode = new Map(concepts.map((c) => [c.code, c]));
    const dictByCode = new Map(dictionaries.map((d) => [d.code, d]));

    const metrics: ResolvedMetric[] = [];
    for (const code of parsed.metricCodes) {
      const hit =
        metricByCode.get(code) ??
        this.findByLooseCode(indicators, code, (i) => [
          i.code,
          i.name,
          ...i.aliases.map((a) => a.alias),
        ]);
      if (hit && !metrics.some((m) => m.indicatorId === hit.id)) {
        metrics.push({
          code: hit.code,
          name: hit.name,
          indicatorId: hit.id,
          aliases: hit.aliases.map((a) => a.alias),
        });
      }
    }

    // A broad alias such as "GDP" must not override an explicit growth-rate
    // request, even when the model returned the nominal-level catalog code.
    if (
      /\bgdp\b|国内生产总值|生产总值/i.test(query) &&
      /增速|增长率|同比|growth/i.test(query)
    ) {
      const ranked = rankIndicatorsForQuery(
        query,
        indicators.map((indicator) => ({
          ...indicator,
          unit: '',
          definition: '',
          aliases: indicator.aliases.map((alias) => alias.alias),
        })),
      );
      const growth = ranked.find(
        (indicator) =>
          /growth|增速|增长率|同比/i.test(
            `${indicator.code} ${indicator.name} ${indicator.aliases.join(' ')}`,
          ) &&
          /gdp|国内生产总值|生产总值/i.test(
            `${indicator.code} ${indicator.name} ${indicator.aliases.join(' ')}`,
          ),
      );
      if (growth) {
        const catalogIndicator = indicators.find(
          (indicator) => indicator.id === growth.id,
        );
        if (catalogIndicator) {
          for (let index = metrics.length - 1; index >= 0; index -= 1) {
            if (
              /gdp|国内生产总值|生产总值/i.test(
                `${metrics[index].code} ${metrics[index].name}`,
              )
            ) {
              metrics.splice(index, 1);
            }
          }
          metrics.push({
            code: catalogIndicator.code,
            name: catalogIndicator.name,
            indicatorId: catalogIndicator.id,
            aliases: catalogIndicator.aliases.map((alias) => alias.alias),
          });
        }
      }
    }

    const resolvedEntities: ResolvedEntity[] = [];
    for (const code of parsed.entityCodes) {
      const hit =
        entityByCode.get(code) ??
        this.findByLooseCode(entities, code, (e) => [
          e.code,
          e.name,
          e.canonicalName,
          ...e.aliases.map((a) => a.alias),
        ]);
      if (hit && !resolvedEntities.some((e) => e.entityId === hit.id)) {
        resolvedEntities.push({
          code: hit.code,
          name: hit.canonicalName || hit.name,
          entityId: hit.id,
          aliases: [hit.name, ...hit.aliases.map((a) => a.alias)],
        });
      }
    }

    const resolvedConcepts: ResolvedConcept[] = [];
    for (const code of parsed.conceptCodes) {
      const hit =
        conceptByCode.get(code) ??
        this.findByLooseCode(concepts, code, (c) => [
          c.code,
          c.name,
          ...c.aliases.map((a) => a.alias),
        ]);
      if (hit && !resolvedConcepts.some((c) => c.conceptId === hit.id)) {
        resolvedConcepts.push({
          code: hit.code,
          name: hit.name,
          conceptId: hit.id,
        });
      }
    }

    const dimensions: ResolvedDimension[] = [];
    for (const code of parsed.dimensionCodes) {
      const hit =
        dictByCode.get(code) ??
        this.findByLooseCode(dictionaries, code, (d) => [
          d.code,
          d.name,
          ...(d.aliases ?? []),
        ]);
      if (
        hit &&
        !dimensions.some((d) => d.code === hit.code && d.type === hit.type)
      ) {
        dimensions.push({
          type: hit.type,
          code: hit.code,
          name: hit.name,
          value: hit.code,
          aliases: hit.aliases ?? [],
        });
      }
    }

    const time = this.normalizeTime(parsed.time);
    let intent = parsed.intent;
    if (
      intent === 'general' &&
      (metrics.length > 0 || parsed.discovery?.metrics.length)
    ) {
      intent = 'metric_query';
    }

    const recognized =
      metrics.length +
      resolvedEntities.length +
      resolvedConcepts.length +
      dimensions.length +
      (parsed.discovery?.metrics.length ?? 0) +
      (parsed.discovery?.entities.length ?? 0) +
      (parsed.discovery?.dimensions?.length ?? 0) +
      (time.type !== 'UNKNOWN' ? 1 : 0);
    const confidence = Math.min(
      0.98,
      Math.max(parsed.confidence, 0.35 + recognized * 0.12),
    );

    return {
      metrics,
      entities: resolvedEntities,
      concepts: resolvedConcepts,
      dimensions,
      time,
      confidence,
      intent,
      ...(parsed.discovery ? { discovery: parsed.discovery } : {}),
    };
  }

  private normalizeTime(time: ResolvedTime): ResolvedTime {
    if (time.type === 'RANGE' && time.start && time.end) {
      return {
        type: 'RANGE',
        start: String(time.start).replace(/\D/g, '').slice(0, 4) || time.start,
        end: String(time.end).replace(/\D/g, '').slice(0, 4) || time.end,
      };
    }
    if (time.type === 'YEAR' && time.value) {
      return { type: 'YEAR', value: Number(time.value) };
    }
    return { type: 'UNKNOWN' };
  }

  private findByLooseCode<T>(
    rows: T[],
    code: string,
    termsOf: (row: T) => string[],
  ): T | undefined {
    const needle = code.trim().toLowerCase();
    if (!needle) return undefined;
    return rows.find((row) =>
      termsOf(row).some((t) => t.trim().toLowerCase() === needle),
    );
  }

  /** LLM 不可用时的轻量兜底：目录项名称/别名子串命中（含常见拼写容错） */
  private fallbackResolve(
    text: string,
    indicators: IndicatorRow[],
    entities: EntityRow[],
    concepts: ConceptRow[],
    dictionaries: DictRow[],
  ): SemanticResolution {
    const lower = this.normalizeQueryText(text);
    const metrics = indicators
      .filter((i) =>
        [i.name, i.code, ...i.aliases.map((a) => a.alias)].some((c) =>
          this.containsTerm(lower, this.normalizeQueryText(c)),
        ),
      )
      .map((i) => ({
        code: i.code,
        name: i.name,
        indicatorId: i.id,
        aliases: i.aliases.map((a) => a.alias),
      }));

    const resolvedEntities = entities
      .filter((e) =>
        [
          e.name,
          e.canonicalName,
          e.code,
          ...e.aliases.map((a) => a.alias),
        ].some((c) => this.containsTerm(lower, this.normalizeQueryText(c))),
      )
      .map((e) => ({
        code: e.code,
        name: e.canonicalName || e.name,
        entityId: e.id,
        aliases: [e.name, ...e.aliases.map((a) => a.alias)],
      }));

    const resolvedConcepts = concepts
      .filter((c) =>
        [c.name, c.code, ...c.aliases.map((a) => a.alias)].some((x) =>
          this.containsTerm(lower, this.normalizeQueryText(x)),
        ),
      )
      .map((c) => ({ code: c.code, name: c.name, conceptId: c.id }));

    const dimensions = dictionaries
      .filter((d) => {
        // 兜底时跳过时间粒度，避免「2025年」误命中「5年」
        if (d.type === 'time_granularity') return false;
        return [d.name, d.code, ...(d.aliases ?? [])].some((c) =>
          this.containsTerm(lower, this.normalizeQueryText(c)),
        );
      })
      .map((d) => ({
        type: d.type,
        code: d.code,
        name: d.name,
        value: d.code,
        aliases: d.aliases ?? [],
      }));

    const time = this.inferTimeFallback(text);
    const intent: SemanticResolution['intent'] =
      metrics.length > 0 ? 'metric_query' : 'general';
    const recognized =
      metrics.length +
      resolvedEntities.length +
      resolvedConcepts.length +
      dimensions.length +
      (time.type !== 'UNKNOWN' ? 1 : 0);
    return {
      metrics,
      entities: resolvedEntities,
      concepts: resolvedConcepts,
      dimensions,
      time,
      confidence: Math.min(0.7, 0.3 + recognized * 0.1),
      intent,
    };
  }

  /** 常见错别字 / 全半角归一，便于无 LLM 时仍能命中指标 */
  private normalizeQueryText(text: string): string {
    return text
      .toLowerCase()
      .replace(/ｇｄｐ/g, 'gdp')
      .replace(/\bgpd\b/g, 'gdp')
      .replace(/人均gpd/g, '人均gdp')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private inferTimeFallback(text: string): ResolvedTime {
    const range = text.match(/20\d{2}\s*年?\s*[-—~～至到]\s*20\d{2}\s*年?/);
    if (range) {
      const years = range[0].match(/20\d{2}/g);
      if (years && years.length >= 2) {
        return { type: 'RANGE', start: years[0], end: years[1] };
      }
    }
    const recentCount = parseRecentYearCount(text);
    if (recentCount) {
      const { start, end } = recentCompletedYearRange(recentCount);
      return { type: 'RANGE', start, end };
    }
    const yearMatch = text.match(/20\d{2}/);
    if (yearMatch) return { type: 'YEAR', value: Number(yearMatch[0]) };
    return { type: 'UNKNOWN' };
  }

  private containsTerm(haystack: string, needle: string): boolean {
    if (!needle || needle.length < 2) return false;
    if (/^\d+年$/.test(needle)) {
      return new RegExp(`(?<!\\d)${needle}`).test(haystack);
    }
    return haystack.includes(needle);
  }
}
