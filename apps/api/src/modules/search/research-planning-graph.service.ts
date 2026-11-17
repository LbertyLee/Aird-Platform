import { Injectable, Logger } from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { ResearchFilters } from '@agent/contracts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DeepSeekChatService } from '../../infrastructure/ai/deepseek-chat.service';
import {
  publicResearchWebsite,
  externalSearchDomain,
} from '../../common/utils/external-search-domain';
import { SemanticResolutionService } from '../semantic/semantic-resolution.service';
import type {
  ResearchSourcePlan,
  SemanticResolution,
} from '../semantic/semantic.types';
import { externalSourceDatasetWhere } from '../dataset/dataset-scope';
import {
  buildResearchQueryPlan,
  type ResearchQueryPlan,
} from './research-query-plan';
import { recentYearRangeForQueries } from '../../common/utils/recent-years';
import { reportResearchProgress } from './research-progress';

const PlanningState = Annotation.Root({
  query: Annotation<string>,
  filters: Annotation<ResearchFilters>,
  optimizedQuery: Annotation<string>,
  resolution: Annotation<SemanticResolution>,
  plan: Annotation<ResearchQueryPlan>,
});

@Injectable()
export class ResearchPlanningGraphService {
  private readonly logger = new Logger(ResearchPlanningGraphService.name);
  constructor(
    private readonly semantic: SemanticResolutionService,
    private readonly chat: DeepSeekChatService,
    private readonly prisma: PrismaService,
  ) {}

  async prepare(query: string, filters: ResearchFilters) {
    const graph = new StateGraph(PlanningState)
      .addNode('understand_intent', async () => {
        await reportResearchProgress({
          stage: 'planning',
          message: '正在并行解析问题与查询条件',
        });
        const startedAt = Date.now();
        const optimizedStartedAt = Date.now();
        const optimizedTask = this.chat
          .optimizeResearchQuery(query, filters)
          .finally(() =>
            this.logger.log(
              `Planning queryRewrite durationMs=${Date.now() - optimizedStartedAt}`,
            ),
          );
        const semanticStartedAt = Date.now();
        const semanticTask = this.semantic
          .resolve([query, ...Object.values(filters).flat()].join('；'))
          .finally(() =>
            this.logger.log(
              `Planning semanticResolve durationMs=${Date.now() - semanticStartedAt}`,
            ),
          );
        const [optimizedQuery, parsed] = await Promise.all([
          optimizedTask,
          semanticTask,
        ]);
        this.logger.log(
          `Planning understandIntent durationMs=${Date.now() - startedAt}`,
        );
        const anchoredTime = recentYearRangeForQueries(query, optimizedQuery);
        const resolution: SemanticResolution = anchoredTime
          ? {
              ...parsed,
              time: {
                type: 'RANGE',
                start: anchoredTime.start,
                end: anchoredTime.end,
              },
            }
          : parsed;
        return { optimizedQuery, resolution };
      })
      .addNode('select_websites', async (state) => {
        await reportResearchProgress({
          stage: 'planning',
          message: '意图解析完成，正在规划检索来源',
        });
        const catalogStartedAt = Date.now();
        const sources = await this.prisma.dataset.findMany({
          where: {
            deletedAt: null,
            status: 'active',
            publishStatus: 'published',
            ...externalSourceDatasetWhere(),
            ...(filters.sources.length
              ? { name: { in: filters.sources } }
              : {}),
          },
          select: { name: true, websiteUrl: true },
        });
        this.logger.log(
          `Planning sourceCatalog durationMs=${Date.now() - catalogStartedAt} sourceCount=${sources.length}`,
        );
        const planningStartedAt = Date.now();
        const planned = await this.chat.planResearchSources(
          query,
          state.resolution,
          sources,
          filters.sources,
        );
        this.logger.log(
          `Planning sourceSelection durationMs=${Date.now() - planningStartedAt} sourceCount=${sources.length}`,
        );
        const fallback = this.fallbackSourcePlan(
          query,
          state.optimizedQuery,
          state.resolution,
          sources,
          filters.sources,
        );
        if (!planned)
          this.logger.warn(
            'AI source planner returned no plan; using bounded fallback discovery',
          );
        const allowedDomains = new Set(
          sources.flatMap((source) => {
            const { domain } = externalSearchDomain(source.websiteUrl);
            return domain ? [domain] : [];
          }),
        );
        const seen = new Set<string>();
        const chosen = (planned?.sources ?? fallback.sources).flatMap(
          (source) => {
            const websiteUrl = publicResearchWebsite(source.websiteUrl);
            const { domain } = externalSearchDomain(websiteUrl);
            if (!websiteUrl || !domain || seen.has(domain)) return [];
            if (filters.sources.length && !allowedDomains.has(domain))
              return [];
            seen.add(domain);
            return [{ ...source, websiteUrl }];
          },
        );
        return {
          resolution: {
            ...state.resolution,
            sourcePlan: {
              ...(planned ?? fallback),
              sources: chosen,
              allowDiscovery:
                !filters.sources.length &&
                (planned?.allowDiscovery ?? fallback.allowDiscovery),
            },
          },
        };
      })
      .addNode('build_queries', (state) => ({
        plan: buildResearchQueryPlan({
          originalQuery: query,
          filters,
          optimizedQuery: state.optimizedQuery,
          resolution: state.resolution,
        }),
      }))
      .addEdge(START, 'understand_intent')
      .addEdge('understand_intent', 'select_websites')
      .addEdge('select_websites', 'build_queries')
      .addEdge('build_queries', END)
      .compile();
    const result = await graph.invoke(
      { query, filters },
      { recursionLimit: 6 },
    );
    return {
      optimizedQuery: result.optimizedQuery,
      resolution: result.resolution,
      plan: result.plan,
    };
  }

  private fallbackSourcePlan(
    query: string,
    optimizedQuery: string,
    resolution: SemanticResolution,
    sources: Array<{ name: string; websiteUrl: string | null }>,
    selectedSourceNames: string[],
  ): ResearchSourcePlan {
    const selected = new Set(
      selectedSourceNames.map((name) => name.trim().toLowerCase()),
    );
    const sourceCandidates = selectedSourceNames.length
      ? sources.filter((source) => selected.has(source.name.toLowerCase()))
      : (resolution.discovery?.websites ?? []).flatMap((websiteUrl) => {
          const safeUrl = publicResearchWebsite(websiteUrl);
          return safeUrl
            ? [{ name: new URL(safeUrl).hostname, websiteUrl: safeUrl }]
            : [];
        });
    const fallbackQuery = optimizedQuery.trim() || query.trim();
    return {
      status: 'ready',
      intentSummary: `检索${query.trim().slice(0, 80)}`,
      dataNeeds: resolution.discovery?.dataNeeds ?? [],
      sources: sourceCandidates.slice(0, 5).flatMap((source) => {
        const websiteUrl = source.websiteUrl
          ? publicResearchWebsite(source.websiteUrl)
          : undefined;
        return websiteUrl
          ? [
              {
                websiteUrl,
                query: fallbackQuery,
                reason: '模型规划超时后的来源兜底',
              },
            ]
          : [];
      }),
      allowDiscovery: selectedSourceNames.length === 0,
      translations: [],
      discoveryQueries: { zh: fallbackQuery, en: fallbackQuery },
    };
  }
}
