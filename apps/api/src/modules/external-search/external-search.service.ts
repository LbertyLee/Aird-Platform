import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type {
  ResearchFilters,
  ResearchSearchResponse,
} from '@agent/contracts';
import { AiQueryService } from '../ai-query/ai-query.service';
import { ExaSearchService } from '../../research/exa-search.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ResearchRepository } from '../../research/research.repository';
import { ResearchService } from '../../research/research.service';
import type { SourceEntity } from '../../research/research.types';
import { toResearchSourceResponse } from '../../research/query-evidence-sources.mapper';
import type { SemanticResolution } from '../semantic/semantic.types';
import type { ResearchQueryPlan } from '../search/research-query-plan';
import { normalizeFilters, normalizeQuery } from '../search/search-normalization';
import { timeRangeLabelsForPlan } from '../../common/utils/recent-years';

/** Isolated external branches; provider selection is scoped to each request. */
@Injectable()
export class ExternalSearchService {
  constructor(
    private readonly aiQuery: AiQueryService,
    private readonly exa: ExaSearchService,
    private readonly prisma: PrismaService,
    private readonly repository: ResearchRepository,
    private readonly research?: ResearchService,
  ) {}

  getStatus() {
    return { externalSearch: this.exa.configured, aiSearch: this.exa.isConfigured('deepseek'), provider: 'exa' };
  }

  async search(
    userId: string,
    query: string,
    filters?: Partial<ResearchFilters>,
    options: {
      mode?: 'exa' | 'ai-search';
      persistHistory?: boolean;
      prepared?: {
        optimizedQuery: string;
        resolution: SemanticResolution;
        plan: ResearchQueryPlan;
      };
      skipBranchAnswer?: boolean;
    } = {},
  ): Promise<ResearchSearchResponse> {
    const mode = options.mode ?? 'exa';
    const provider = mode === 'ai-search' ? 'deepseek' : 'exa';
    const configured = this.exa.isConfigured(provider);
    if (mode === 'ai-search' && !configured) {
      throw new ServiceUnavailableException('AI 搜索未配置 DEEPSEEK_SEARCH_API_KEY');
    }
    const persistHistory = options.persistHistory ?? true;
    const normalizedQuery = normalizeQuery(query);
    const normalizedFilters = normalizeFilters(filters);
    const runId = persistHistory
      ? await this.repository.createRun({
          query: normalizedQuery,
          fingerprint: createHash('sha256')
            .update(JSON.stringify({ scope: mode, query: normalizedQuery, filters: normalizedFilters }))
            .digest('hex'),
          filters: normalizedFilters,
          userId,
        })
      : randomUUID();
    try {
      const prepared = options.prepared ?? (await this.aiQuery.prepareQuery(normalizedQuery, normalizedFilters));
      const result = await this.aiQuery.execute(normalizedQuery, normalizedFilters, mode, {
        userId,
        disableInternalSearch: true,
        optimizedQuery: prepared.optimizedQuery,
        resolution: prepared.resolution,
        plan: prepared.plan,
        skipBranchAnswer: options.skipBranchAnswer,
      });
      const evidenceSources = await this.evidenceToSources(result.aiQueryId, provider);
      const sources = this.research ? await this.research.hydrateStructuredSources(evidenceSources, normalizedQuery) : evidenceSources;
      const resolution = result.resolution;
      const plan: ResearchSearchResponse['plan'] = {
        countries: resolution.dimensions.filter((item) => item.type === 'country_region').map((item) => item.name),
        regions: resolution.dimensions.filter((item) => /^(region|province|city|area)$/.test(item.type)).map((item) => item.name),
        entities: [...new Set([
          ...resolution.entities.map((item) => item.name),
          ...(resolution.discovery?.entities ?? []),
        ])],
        indicators: [...new Set([
          ...resolution.metrics.map((item) => item.name),
          ...(resolution.discovery?.metrics ?? []),
        ])],
        dimensions: [...new Set([
          ...resolution.dimensions.map((item) => item.name),
          ...(resolution.discovery?.dimensions ?? []),
        ])],
        timeRanges: timeRangeLabelsForPlan(
          normalizedQuery,
          prepared.optimizedQuery,
          {
            year:
              resolution.time.type === 'YEAR'
                ? resolution.time.value
                : undefined,
            start:
              resolution.time.type === 'RANGE'
                ? resolution.time.start
                : undefined,
            end:
              resolution.time.type === 'RANGE' ? resolution.time.end : undefined,
          },
        ),
        sources: normalizedFilters.sources,
        intent: resolution.intent === 'metric_query' ? 'lookup' : resolution.intent === 'analysis' ? 'trend' : 'general',
        confidence: resolution.confidence,
        explanation: `${mode === 'ai-search' ? 'AI 搜索' : '联网'}分支，保留语义识别与筛选条件供后续分析使用。`,
      };
      for (const key of ['countries', 'regions', 'entities', 'indicators', 'timeRanges'] as const) {
        if (normalizedFilters[key].length) plan[key] = normalizedFilters[key];
      }
      const stages = result.stages.map((stage) => mode === 'ai-search' && stage.key === 'exa'
        ? { ...stage, label: 'AI 搜索', detail: stage.detail.replace(/Exa/g, 'DeepSeek') }
        : stage);
      if (persistHistory) {
        await this.repository.completeRun({
          id: runId,
          matchedLocally: false,
          usedExa: result.stages.some((stage) => stage.key === 'exa' && stage.status === 'completed'),
          sourceIds: sources.map((source) => source.id),
          sourceScores: Object.fromEntries(sources.filter((source) => source.score !== undefined).map((source) => [source.id, source.score!])),
          cacheExpiresAt: new Date(Date.now() + 3600_000),
          reportMarkdown: result.answer,
          resultJson: {
            runId, query: normalizedQuery, mode, matchedLocally: false,
            usedExa: result.stages.some((stage) => stage.key === 'exa' && stage.status === 'completed'),
            exaConfigured: configured, cacheHit: false, cachedAt: null,
            plan,
            sources: sources.map((source) => this.toResponseSource(source)), stages, answer: result.answer, aiQueryId: result.aiQueryId,
          },
        });
      }

      return {
      runId,
      query: normalizedQuery,
      mode,
      matchedLocally: false,
      usedExa: result.stages.some(
        (stage) => stage.key === 'exa' && stage.status === 'completed',
      ),
      exaConfigured: configured,
      cacheHit: false,
      cachedAt: null,
      plan,
      sources: sources.map((source) => this.toResponseSource(source)),
      stages,
      answer: result.answer,
      aiQueryId: result.aiQueryId,
      } as ResearchSearchResponse;
    } catch (error) {
      if (persistHistory) {
        await this.repository.failRun(runId, error instanceof Error ? error.message : String(error));
      }
      throw error;
    }
  }

  private async evidenceToSources(aiQueryId: string, provider: 'deepseek' | 'exa'): Promise<SourceEntity[]> {
    const evidence = await this.prisma.queryEvidence.findMany({
      where: { aiQueryId, evidenceType: 'external' }, orderBy: { createdAt: 'asc' },
    });
    return Promise.all(evidence.map(async (item, index) => {
      const metadata = item.metadataJson as Record<string, unknown>;
      const rows = Array.isArray(metadata.structuredData) ? metadata.structuredData : undefined;
      const title = typeof metadata.displayTitle === 'string' && metadata.displayTitle.trim()
        ? metadata.displayTitle : item.content?.split('\n', 1)[0]?.trim() || `Exa 搜索结果 #${index + 1}`;
      // Defer full page body until analysis selection; keep title for list/excerpt.
      const source = await this.repository.createSource({
        title, origin: 'exa', storageType: rows ? 'structured' : 'knowledge',
        sourceUrl: typeof metadata.url === 'string' ? metadata.url : undefined,
        mimeType: rows ? 'application/json' : 'text/html', textContent: rows ? JSON.stringify(rows) : title,
        structuredData: rows,
        searchText: title,
        metadata: {
          aiQueryId,
          evidenceId: item.id,
          contentMode: 'deferred',
          ...metadata,
          provider: rows ? metadata.provider ?? `${provider}-search` : `${provider}-search`,
          ...(rows ? { contentMode: 'structured' } : {}),
        },
        recordCount: rows?.length ?? 0,
      });
      return { ...source, score: item.score ?? undefined };
    })).then((sources) => [...new Map(sources.map((source) => [source.id, source])).values()]);
  }

  private toResponseSource(source: SourceEntity): ResearchSearchResponse['sources'][number] {
    return toResearchSourceResponse(source);
  }
}

