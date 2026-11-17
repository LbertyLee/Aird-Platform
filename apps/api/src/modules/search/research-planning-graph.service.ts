import { Injectable } from '@nestjs/common';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import type { ResearchFilters } from '@agent/contracts';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DeepSeekChatService } from '../../infrastructure/ai/deepseek-chat.service';
import { publicResearchWebsite, externalSearchDomain } from '../../common/utils/external-search-domain';
import { SemanticResolutionService } from '../semantic/semantic-resolution.service';
import type { SemanticResolution } from '../semantic/semantic.types';
import { externalSourceDatasetWhere } from '../dataset/dataset-scope';
import { buildResearchQueryPlan, type ResearchQueryPlan } from './research-query-plan';
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
  constructor(
    private readonly semantic: SemanticResolutionService,
    private readonly chat: DeepSeekChatService,
    private readonly prisma: PrismaService,
  ) {}

  async prepare(query: string, filters: ResearchFilters) {
    const graph = new StateGraph(PlanningState)
      .addNode('understand_intent', async () => {
        await reportResearchProgress({ stage: 'planning', message: '正在并行解析问题与查询条件' });
        const [optimizedQuery, parsed] = await Promise.all([
          this.chat.optimizeResearchQuery(query, filters),
          this.semantic.resolve([query, ...Object.values(filters).flat()].join('；')),
        ]);
        const anchoredTime = recentYearRangeForQueries(query, optimizedQuery);
        const resolution: SemanticResolution = anchoredTime
          ? { ...parsed, time: { type: 'RANGE', start: anchoredTime.start, end: anchoredTime.end } }
          : parsed;
        return { optimizedQuery, resolution };
      })
      .addNode('select_websites', async (state) => {
        await reportResearchProgress({ stage: 'planning', message: '意图解析完成，正在规划检索来源' });
        const sources = await this.prisma.dataset.findMany({
          where: {
            deletedAt: null, status: 'active', publishStatus: 'published',
            ...externalSourceDatasetWhere(),
            ...(filters.sources.length ? { name: { in: filters.sources } } : {}),
          },
          select: { name: true, websiteUrl: true },
        });
        const planned = await this.chat.planResearchSources(query, state.resolution, sources, filters.sources);
        const allowedDomains = new Set(sources.flatMap((source) => {
          const { domain } = externalSearchDomain(source.websiteUrl);
          return domain ? [domain] : [];
        }));
        const seen = new Set<string>();
        const chosen = (planned?.sources ?? []).flatMap((source) => {
          const websiteUrl = publicResearchWebsite(source.websiteUrl);
          const { domain } = externalSearchDomain(websiteUrl);
          if (!websiteUrl || !domain || seen.has(domain)) return [];
          if (filters.sources.length && !allowedDomains.has(domain)) return [];
          seen.add(domain);
          return [{ ...source, websiteUrl }];
        });
        return { resolution: {
          ...state.resolution,
          sourcePlan: planned ? { ...planned, sources: chosen, allowDiscovery: !filters.sources.length && planned.allowDiscovery }
            : { status: 'unavailable' as const, intentSummary: '研究来源规划暂不可用', dataNeeds: [], sources: [], allowDiscovery: false },
        } };
      })
      .addNode('build_queries', (state) => ({
        plan: buildResearchQueryPlan({ originalQuery: query, filters,
          optimizedQuery: state.optimizedQuery, resolution: state.resolution }),
      }))
      .addEdge(START, 'understand_intent')
      .addEdge('understand_intent', 'select_websites')
      .addEdge('select_websites', 'build_queries')
      .addEdge('build_queries', END)
      .compile();
    const result = await graph.invoke({ query, filters }, { recursionLimit: 6 });
    return { optimizedQuery: result.optimizedQuery, resolution: result.resolution, plan: result.plan };
  }
}
