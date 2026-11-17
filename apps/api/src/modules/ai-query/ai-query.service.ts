import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiQueryStatus,
  CommonStatus,
  DatasetPublishStatus,
  Prisma,
  QueryRouteType,
} from '@prisma/client';
import type {
  ResearchFilters,
  ResearchSearchMode,
  ResearchSearchResponse,
  ResearchStage,
} from '@agent/contracts';
import { DeepSeekChatService } from '../../infrastructure/ai/deepseek-chat.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ExaSearchService,
  type ExaSourceSearchSummary,
} from '../../research/exa-search.service';
import { SemanticResolutionService } from '../semantic/semantic-resolution.service';
import type {
  ResearchEvaluation,
  SemanticResolution,
} from '../semantic/semantic.types';
import { EvidenceService } from './evidence.service';
import { QueryRouterService } from './query-router.service';
import { RagQueryService } from './rag-query.service';
import { TextToSqlService } from './text-to-sql.service';
import { externalSourceDatasetWhere } from '../dataset/dataset-scope';
import {
  alignExternalResultUrl,
  preferredHostsByApex,
  publicResearchWebsite,
  externalSearchDomain,
} from '../../common/utils/external-search-domain';
import type { ExaResult } from '../../research/research.types';
import {
  attachRelevanceMetadata,
  buildRelevanceMatcher,
  scoreDocumentRelevance,
  textMatchesPlanEntities,
  textFocusesOnPlanRegions,
} from './retrieval-relevance';
import { hasEncodingDamage } from '../../common/utils/external-text-quality';
import {
  buildResearchQueryPlan,
  type ResearchQueryPlan,
} from '../search/research-query-plan';
import { ResearchPlanningGraphService } from '../search/research-planning-graph.service';
import { runResearchRetrievalGraph } from '../search/research-retrieval-graph';
import { recentYearRangeForQueries } from '../../common/utils/recent-years';
import { WorldBankDataService } from '../../research/world-bank-data.service';
import { InternationalDataApiService } from '../../research/international-data-api.service';
import { OfficialResearchCoverage } from '../search/official-research-coverage';
import { reportResearchProgress } from '../search/research-progress';

export type AiQueryOptions = {
  userId?: string;
  /** 用户端数据分析：不调用外部搜索 */
  disableExternalSearch?: boolean;
  /** Exa 独立分支：不调用结构化数据和知识库检索。 */
  disableInternalSearch?: boolean;
  /** 由编排层生成并复用的检索语句，避免分支重复调用查询优化。 */
  optimizedQuery?: string;
  /** Reuse semantic parsing performed by the search orchestrator. */
  resolution?: SemanticResolution;
  /** Mixed-search branches: skip per-branch answer LLM; orchestrator merges once. */
  skipBranchAnswer?: boolean;
  /** Shared retrieval/extraction constraints from prepareQuery. */
  plan?: ResearchQueryPlan;
};

export type AiQueryResult = {
  aiQueryId: string;
  answer: string;
  routeType: QueryRouteType;
  resolution: SemanticResolution;
  evidenceCount: number;
};

@Injectable()
export class AiQueryService {
  private readonly logger = new Logger(AiQueryService.name);
  private readonly externalAnswerTopK: number;
  private readonly researchMaxRounds: number;
  /** Max merged Exa hits to score globally (all configured sources). */
  private readonly externalRerankCandidateMax: number;
  private readonly externalPlatformScoreWeight: number;
  private readonly externalExaScoreWeight: number;
  private readonly sourceTrustByDomain: Map<string, number>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly semantic: SemanticResolutionService,
    private readonly router: QueryRouterService,
    private readonly textToSql: TextToSqlService,
    private readonly rag: RagQueryService,
    private readonly evidence: EvidenceService,
    private readonly chat: DeepSeekChatService,
    private readonly exa: ExaSearchService,
    config: ConfigService,
    private readonly planning: ResearchPlanningGraphService,
    private readonly worldBank: WorldBankDataService = new WorldBankDataService(),
    private readonly internationalData: InternationalDataApiService = new InternationalDataApiService(
      config,
    ),
  ) {
    const rounds = Number(config.get('RESEARCH_MAX_ROUNDS') ?? 3);
    this.researchMaxRounds = Number.isFinite(rounds)
      ? Math.min(5, Math.max(1, Math.floor(rounds)))
      : 3;
    this.externalAnswerTopK = Math.max(
      1,
      config.get<number>('EXTERNAL_ANSWER_TOP_K') ?? 10,
    );
    this.externalRerankCandidateMax = Math.min(
      500,
      Math.max(10, config.get<number>('EXTERNAL_RERANK_CANDIDATE_MAX') ?? 250),
    );
    const platformWeight = Math.max(
      0,
      config.get<number>('EXTERNAL_PLATFORM_SCORE_WEIGHT') ?? 0.5,
    );
    const exaWeight = Math.max(
      0,
      config.get<number>('EXTERNAL_EXA_SCORE_WEIGHT') ?? 0.5,
    );
    const weightSum = platformWeight + exaWeight || 1;
    this.externalPlatformScoreWeight = platformWeight / weightSum;
    this.externalExaScoreWeight = exaWeight / weightSum;
    this.sourceTrustByDomain = this.parseSourceTrust(
      config.get<string>('EXTERNAL_SOURCE_TRUST_JSON'),
    );
  }

  async optimizeQuery(
    query: string,
    filters: ResearchFilters,
  ): Promise<string> {
    return this.chat.optimizeResearchQuery(query, filters);
  }

  async prepareQuery(
    query: string,
    filters: ResearchFilters,
  ): Promise<{
    optimizedQuery: string;
    resolution: SemanticResolution;
    plan: ResearchQueryPlan;
  }> {
    return this.planning.prepare(query, filters);
  }

  async summarizeBranchAnswers(
    query: string,
    knowledgeAnswer: string,
    externalAnswer: string,
  ): Promise<string> {
    const evidence = [
      knowledgeAnswer ? `[知识库分支]\n${knowledgeAnswer}` : '',
      externalAnswer ? `[Exa 联网分支]\n${externalAnswer}` : '',
    ].filter(Boolean);
    const fallback = evidence.length
      ? evidence.join('\n\n')
      : '暂无足够内部或外部证据回答该问题。';
    return this.chat.answerFromEvidence(query, evidence, fallback);
  }

  async execute(
    query: string,
    filters?: Partial<ResearchFilters>,
    mode: ResearchSearchMode = 'mixed',
    options?: AiQueryOptions,
  ): Promise<AiQueryResult & { stages: ResearchStage[] }> {
    const normalized = query.trim();
    const normalizedFilters: ResearchFilters = {
      countries: filters?.countries ?? [],
      regions: filters?.regions ?? [],
      entities: filters?.entities ?? [],
      indicators: filters?.indicators ?? [],
      timeRanges: filters?.timeRanges ?? [],
      sources: filters?.sources ?? [],
      ...(filters?.libraryIds?.length
        ? { libraryIds: filters.libraryIds }
        : {}),
    };
    const prepared = options?.resolution
      ? undefined
      : await this.prepareQuery(normalized, normalizedFilters);
    const optimizedQuery =
      options?.optimizedQuery ??
      prepared?.optimizedQuery ??
      (await this.chat.optimizeResearchQuery(normalized, normalizedFilters));
    const aiQuery = await this.prisma.aiQuery.create({
      data: {
        userQuery: normalized,
        status: AiQueryStatus.running,
        userId: options?.userId,
      },
    });
    const stages: ResearchStage[] = [];

    try {
      let resolution = options?.resolution ?? prepared!.resolution;
      const anchoredTime = recentYearRangeForQueries(
        normalized,
        optimizedQuery,
      );
      if (anchoredTime) {
        resolution = {
          ...resolution,
          time: {
            type: 'RANGE',
            start: anchoredTime.start,
            end: anchoredTime.end,
          },
        };
      }
      await this.prisma.semanticQuery.create({
        data: {
          aiQueryId: aiQuery.id,
          metricsJson: resolution.metrics as Prisma.InputJsonValue,
          entitiesJson: resolution.entities as Prisma.InputJsonValue,
          dimensionsJson: resolution.dimensions as Prisma.InputJsonValue,
          conceptsJson: resolution.concepts as Prisma.InputJsonValue,
          timeJson: resolution.time as Prisma.InputJsonValue,
          confidence: resolution.confidence,
          resolvedQueryJson: resolution as unknown as Prisma.InputJsonValue,
        },
      });
      stages.push({
        key: 'plan',
        label: 'Semantic Layer 解析',
        status: 'completed',
        detail: this.resolutionDetail(resolution),
      });

      const plan =
        options?.plan ??
        buildResearchQueryPlan({
          originalQuery: normalized,
          filters: normalizedFilters,
          optimizedQuery,
          resolution,
        });

      const route =
        mode === 'exa' || mode === 'ai-search'
          ? 'semantic'
          : this.router.route(resolution, normalized);
      const routeType =
        route === 'structured'
          ? QueryRouteType.structured
          : route === 'hybrid'
            ? QueryRouteType.hybrid
            : QueryRouteType.semantic;

      const evidenceBlocks: string[] = [];
      let evidenceCount = 0;

      const parallelMixedRetrieval =
        mode === 'mixed' &&
        !options?.disableInternalSearch &&
        !options?.disableExternalSearch;
      let externalRetrievalTask: Promise<{
        stages: ResearchStage[];
        evidenceBlocks: string[];
        evidenceCount: number;
      }> | null = null;
      if (parallelMixedRetrieval) {
        externalRetrievalTask = this.collectExternalSearchEvidence({
          aiQueryId: aiQuery.id,
          resolution,
          normalized,
          optimizedQuery,
          normalizedFilters,
          plan,
        });
      }

      let sqlHadRows = false;
      if (
        !options?.disableInternalSearch &&
        (route === 'structured' || route === 'hybrid')
      ) {
        const sqlResult = await this.textToSql.execute(
          resolution,
          options?.userId,
          normalizedFilters,
        );
        const usableRows =
          sqlResult?.rows.filter((row) => {
            const value = row.value ?? row.metric_value;
            return (
              value != null &&
              String(value).trim() !== '' &&
              Number.isFinite(Number(value))
            );
          }) ?? [];
        if (sqlResult && usableRows.length) {
          sqlHadRows = resolution.metrics.every((metric) =>
            usableRows.some((row) => row.indicatorCode === metric.code),
          );
          await this.evidence.saveSqlEvidence(aiQuery.id, {
            ...sqlResult,
            rows: usableRows,
          });
          evidenceCount += 1;
          evidenceBlocks.push(
            `[E${evidenceBlocks.length + 1}] SQL 结构化查询\nSQL: ${sqlResult.sql}\n结果: ${JSON.stringify(usableRows.slice(0, 8))}`,
          );
          stages.push({
            key: 'database',
            label: 'PostgreSQL 结构化查询',
            status: 'completed',
            detail: `执行 SQL 返回 ${usableRows.length} 行结果。`,
          });
        } else {
          stages.push({
            key: 'database',
            label: 'PostgreSQL 结构化查询',
            status: 'skipped',
            detail: sqlResult
              ? 'SQL 已执行但未命中有效数值（字段名/年份列可能不匹配）。'
              : '未找到可用指标字段映射或 READY 版本数据集。',
          });
        }
      }

      // 结构化无结果时回退向量检索，避免「有知识库文档却搜不到」
      const runRag =
        mode !== 'ai-search' &&
        !options?.disableInternalSearch &&
        (route === 'semantic' ||
          route === 'hybrid' ||
          (route === 'structured' && !sqlHadRows));
      if (runRag) {
        const ragHits = await this.rag.search(
          plan.searchQuery,
          resolution,
          8,
          options?.userId,
          normalizedFilters,
          plan,
        );
        if (ragHits.length) {
          await this.evidence.saveVectorEvidence(aiQuery.id, ragHits);
          evidenceCount += ragHits.length;
          ragHits.slice(0, 5).forEach((hit, i) => {
            evidenceBlocks.push(
              `[E${evidenceBlocks.length + 1}] ${hit.sourceType} 向量证据 (score=${hit.score.toFixed(2)})\n${hit.content.slice(0, 800)}`,
            );
          });
          stages.push({
            key: 'vector',
            label: 'Milvus 语义检索',
            status: 'completed',
            detail: `命中 ${ragHits.length} 条文档/数据集分块。`,
          });
        } else {
          stages.push({
            key: 'vector',
            label: 'Milvus 语义检索',
            status: 'skipped',
            detail: '内部知识库未检索到满足问题指标和对象的相关证据。',
          });
        }
      }

      if (externalRetrievalTask) {
        const external = await externalRetrievalTask;
        stages.push(...external.stages);
        evidenceBlocks.push(...external.evidenceBlocks);
        evidenceCount += external.evidenceCount;
      } else if (
        !options?.disableExternalSearch &&
        mode !== 'knowledge' &&
        (mode === 'exa' ||
          mode === 'ai-search' ||
          mode === 'mixed' ||
          evidenceCount === 0)
      ) {
        const external = await this.collectExternalSearchEvidence({
          provider: mode === 'ai-search' ? 'deepseek' : 'exa',
          aiQueryId: aiQuery.id,
          resolution,
          normalized,
          optimizedQuery,
          normalizedFilters,
          plan,
        });
        stages.push(...external.stages);
        evidenceBlocks.push(...external.evidenceBlocks);
        evidenceCount += external.evidenceCount;
      }

      const fallback = evidenceBlocks.length
        ? evidenceBlocks.join('\n\n')
        : '暂无足够内部或外部证据回答该问题；检索规划未能获得可核验的证据。';
      const answer = options?.skipBranchAnswer
        ? fallback.slice(0, 12_000)
        : await this.chat.answerFromEvidence(
            normalized,
            evidenceBlocks,
            fallback,
          );

      await this.prisma.aiQuery.update({
        where: { id: aiQuery.id },
        data: {
          status: AiQueryStatus.completed,
          routeType,
          intent: resolution.intent,
          answer,
          queryPlanJson: { route, resolution } as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });

      return {
        aiQueryId: aiQuery.id,
        answer,
        routeType,
        resolution,
        evidenceCount,
        stages,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.aiQuery.update({
        where: { id: aiQuery.id },
        data: {
          status: AiQueryStatus.failed,
          answer: message,
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  private async collectExternalSearchEvidence(input: {
    provider?: 'deepseek' | 'exa';
    aiQueryId: string;
    resolution: SemanticResolution;
    normalized: string;
    optimizedQuery: string;
    normalizedFilters: ResearchFilters;
    plan: ResearchQueryPlan;
  }): Promise<{
    stages: ResearchStage[];
    evidenceBlocks: string[];
    evidenceCount: number;
  }> {
    const {
      aiQueryId,
      resolution,
      normalized,
      optimizedQuery,
      normalizedFilters,
      plan,
    } = input;
    const stages: ResearchStage[] = [];
    const evidenceBlocks: string[] = [];
    let evidenceCount = 0;

    const provider = input.provider ?? 'exa';
    const webConfigured =
      provider === 'deepseek'
        ? this.exa.isConfigured(provider)
        : this.exa.configured;
    // Explicit source restrictions also apply to official API access.
    const officialAllowed =
      !normalizedFilters.sources.length ||
      normalizedFilters.sources.some((source) =>
        /world\s*bank|worldbank|世界银行/i.test(source),
      );
    const official = new OfficialResearchCoverage(
      this.worldBank,
      normalized,
      normalizedFilters,
      plan,
      officialAllowed,
    );
    try {
      const selectedSourceNames = [
        ...new Set(
          normalizedFilters.sources
            .map((source) => source.trim())
            .filter(Boolean),
        ),
      ];
      const configuredSources = await this.prisma.dataset.findMany({
        where: {
          deletedAt: null,
          status: CommonStatus.active,
          publishStatus: DatasetPublishStatus.published,
          ...(selectedSourceNames.length
            ? { name: { in: selectedSourceNames } }
            : {}),
          ...externalSourceDatasetWhere(),
        },
        select: { id: true, name: true, websiteUrl: true },
      });
      if (!configuredSources.length && selectedSourceNames.length) {
        stages.push({
          key: 'exa',
          label: '外部搜索补充',
          status: 'skipped',
          detail:
            '未找到已发布且配置了网站地址的外部数据源，外部来源检索未执行。',
        });
        return { stages, evidenceBlocks, evidenceCount };
      }

      const externalQuery = plan.searchQuery;
      this.logger.log(
        `Exa branch query=${JSON.stringify(externalQuery)} planEntities=${JSON.stringify(plan.entities)} planMetrics=${JSON.stringify(plan.metrics.slice(0, 4))} configuredSources=${configuredSources.length}`,
      );
      const sourcePlan =
        resolution.sourcePlan?.status === 'ready'
          ? resolution.sourcePlan
          : official.gapPlan();
      if (!sourcePlan || sourcePlan.status !== 'ready') {
        throw new Error(
          '研究来源规划暂不可用，请稍后重试；本次未扫描全部来源。',
        );
      }
      const selectedWorldBank = selectedSourceNames.some((source) =>
        /world\s*bank|worldbank|世界银行/i.test(source),
      );
      const plannedWorldBank = sourcePlan.sources.some((source) => {
        const { domain } = externalSearchDomain(source.websiteUrl);
        return domain === 'worldbank.org' || domain?.endsWith('.worldbank.org');
      });
      const officialRequested =
        official.enabled && (selectedWorldBank || plannedWorldBank);
      const plannedApiSources = sourcePlan.sources.filter((source) =>
        /imf\.org|oecd\.org|europa\.eu|comtrade\.un\.org|unstats\.un\.org|who\.int|ghoapi\.azureedge\.net/i.test(
          source.websiteUrl,
        ),
      );
      const selectedApiSource = selectedSourceNames.some((source) =>
        /\bimf\b|oecd|eurostat|comtrade|sdg|\bwho\b|世界卫生组织|联合国可持续发展/i.test(
          source,
        ),
      );
      const internationalApiRequested =
        plannedApiSources.length > 0 || selectedApiSource;
      if (!webConfigured && !officialRequested && !internationalApiRequested) {
        stages.push({
          key: 'exa',
          label: '外部搜索补充',
          status: 'skipped',
          detail: `规划来源无法通过当前配置的搜索服务访问，且无需查询世界银行官方 API。`,
        });
        return { stages, evidenceBlocks, evidenceCount };
      }
      if (
        !sourcePlan.sources.length &&
        !sourcePlan.allowDiscovery &&
        !officialRequested
      ) {
        stages.push({
          key: 'exa',
          label: '外部搜索补充',
          status: 'skipped',
          detail: `研究目的：${sourcePlan.intentSummary}；规划未找到符合当前来源限制的网站，未执行外部检索。`,
        });
        return { stages, evidenceBlocks, evidenceCount };
      }
      const discovery = resolution.discovery;
      const matchesEvidence = buildRelevanceMatcher(
        resolution,
        normalizedFilters,
      );
      const allowedDomains = new Set(
        (selectedSourceNames.length
          ? configuredSources
          : sourcePlan.allowDiscovery
            ? []
            : sourcePlan.sources
        ).flatMap((source) => {
          const { domain } = externalSearchDomain(source.websiteUrl);
          return domain ? [domain] : [];
        }),
      );
      const retrieval = await runResearchRetrievalGraph({
        initialPlan:
          !sourcePlan.sources.length && officialRequested
            ? official.gapPlan()!
            : sourcePlan,
        maxRounds: this.researchMaxRounds,
        replan: async (evaluation, previousQueries) => {
          let next: SemanticResolution['sourcePlan'] | null = null;
          try {
            next = await this.chat.planResearchSources(
              normalized,
              resolution,
              configuredSources,
              selectedSourceNames,
              {
                gaps: evaluation.gaps,
                reason: evaluation.reason,
                previousQueries,
              },
            );
          } catch {
            /* The deterministic gap plan remains usable if the model is unavailable. */
          }
          const gapPlan = officialRequested ? official.gapPlan() : null;
          if (!next) return gapPlan;
          const seen = new Set<string>();
          return {
            ...next,
            allowDiscovery:
              !selectedSourceNames.length &&
              sourcePlan.allowDiscovery &&
              next.allowDiscovery,
            sources: [...(gapPlan?.sources ?? []), ...next.sources]
              .flatMap((source) => {
                const websiteUrl = publicResearchWebsite(source.websiteUrl);
                const { domain } = externalSearchDomain(websiteUrl);
                if (
                  !websiteUrl ||
                  !domain ||
                  seen.has(`${domain}\n${source.query}`)
                )
                  return [];
                if (
                  (selectedSourceNames.length || !sourcePlan.allowDiscovery) &&
                  !allowedDomains.has(domain) &&
                  !(
                    officialRequested &&
                    (domain === 'worldbank.org' ||
                      domain.endsWith('.worldbank.org'))
                  )
                )
                  return [];
                seen.add(`${domain}\n${source.query}`);
                return [{ ...source, websiteUrl }];
              })
              .slice(0, 5),
          };
        },
        retrieve: async (currentPlan) => {
          await reportResearchProgress({
            stage: 'searching',
            message: officialRequested
              ? '正在并行查询官方数据与规划来源'
              : '正在查询规划指定的来源',
          });
          const officialStartedAt = Date.now();
          const webStartedAt = Date.now();
          const webTasks = webConfigured
            ? currentPlan.sources.map((source) =>
                source.websiteUrl
                  ? this.exa.searchSources(
                      source.query,
                      [{ id: '', name: '', websiteUrl: source.websiteUrl }],
                      provider,
                    )
                  : this.exa.discoverSources(source.query, [], provider),
              )
            : [];
          const internationalStartedAt = Date.now();
          const internationalTask = this.internationalData
            .retrieve(currentPlan.sources, normalized, plan)
            .catch((error: unknown) => {
              this.logger.warn(
                `International API retrieval failed: ${error instanceof Error ? error.message : String(error)}`,
              );
              return [];
            });
          const [officialResults, settled, internationalResults] =
            await Promise.all([
              officialRequested
                ? official
                    .retrieve()
                    .catch((error: unknown) => {
                      this.logger.warn(
                        `Research official retrieval failed: ${error instanceof Error ? error.message : String(error)}`,
                      );
                      return [];
                    })
                    .finally(() =>
                      this.logger.log(
                        `Research official retrieval durationMs=${Date.now() - officialStartedAt}`,
                      ),
                    )
                : Promise.resolve([]),
              Promise.allSettled(webTasks).finally(() =>
                this.logger.log(
                  `Research web retrieval durationMs=${Date.now() - webStartedAt} sourceCount=${webTasks.length}`,
                ),
              ),
              internationalTask,
            ]);
          this.logger.log(
            `International API retrieval durationMs=${Date.now() - internationalStartedAt} results=${internationalResults.length}`,
          );
          const summary: ExaSourceSearchSummary = {
            results: [
              ...(officialResults.length
                ? [
                    {
                      sourceId: '',
                      sourceName: '世界银行官方 API',
                      results: officialResults,
                    },
                  ]
                : []),
            ],
            attempted:
              (officialResults.length ? 1 : 0) +
              (internationalApiRequested ? plannedApiSources.length || 1 : 0),
            succeeded:
              (officialResults.length ? 1 : 0) +
              (internationalResults.length ? 1 : 0),
            failed: 0,
            skipped: 0,
          };
          for (const providerName of new Set(
            internationalResults.map(
              (item) => item.officialProvider ?? 'international-api',
            ),
          )) {
            const providerResults = internationalResults.filter(
              (item) =>
                (item.officialProvider ?? 'international-api') === providerName,
            );
            summary.results.push({
              sourceId: '',
              sourceName: `${providerName} 官方 API`,
              results: providerResults,
            });
          }
          for (const item of settled) {
            if (item.status === 'rejected') {
              summary.attempted++;
              summary.failed++;
              continue;
            }
            summary.results.push(...item.value.results);
            summary.attempted += item.value.attempted ?? 1;
            summary.succeeded += item.value.succeeded ?? 1;
            summary.failed += item.value.failed ?? 0;
            summary.skipped += item.value.skipped ?? 0;
          }
          return summary;
        },
        evaluate: async (summary) => {
          const candidates = summary.results
            .flatMap((group) => group.results)
            .filter(
              (item) =>
                matchesEvidence(
                  `${item.title}\n${item.description}\n${item.extraSnippets.join('\n')}`,
                ) && this.isStrongExternalMatch(item, plan),
            );
          const unique = [
            ...new Map(
              candidates.map((item) => [
                this.normalizeExternalUrl(item.url),
                item,
              ]),
            ).values(),
          ];
          const officialEvaluation = officialRequested
            ? official.evaluate(null)
            : null;
          if (officialEvaluation?.sufficient) return officialEvaluation;
          if (!unique.length) {
            const noEvidence: ResearchEvaluation = {
              sufficient: false,
              reason: '尚未检索到符合问题维度的证据',
              gaps: sourcePlan.dataNeeds.length
                ? sourcePlan.dataNeeds
                : [normalized],
              coveredNeeds: [],
              evidenceUrls: [],
            };
            return officialRequested
              ? official.evaluate(noEvidence)!
              : noEvidence;
          }
          let model = null;
          try {
            model = await this.chat.evaluateResearchEvidence(
              normalized,
              sourcePlan.dataNeeds,
              unique.slice(0, 20).map((item) => ({
                url: item.url,
                title: item.title,
                content: [item.description, ...item.extraSnippets]
                  .join('\n')
                  .slice(0, 2500),
              })),
            );
          } catch {
            /* Official coverage can still identify gaps without an LLM. */
          }
          return officialRequested ? official.evaluate(model) : model;
        },
      });
      const configuredSearch = retrieval.summary;
      const useDiscovery =
        retrieval.round > 1 ||
        sourcePlan.sources.some(
          (source) =>
            !configuredSources.some(
              (configured) =>
                externalSearchDomain(configured.websiteUrl).domain ===
                externalSearchDomain(source.websiteUrl).domain,
            ),
        );
      const discoveryNote = `研究目的：${sourcePlan.intentSummary}；完成 ${retrieval.round} 轮规划检索；停止原因：${
        (
          {
            sufficient: '证据充分',
            max_rounds: '达到迭代上限',
            no_new_queries: '无新的查询计划',
            planning_unavailable: '再规划暂不可用',
            evaluation_unavailable: '充分性评估暂不可用',
          } as Record<string, string>
        )[retrieval.stopReason] ?? retrieval.stopReason
      }；`;
      const researchLoop = {
        rounds: retrieval.round,
        stopReason: retrieval.stopReason,
        evaluation: retrieval.evaluation ?? null,
        history: retrieval.history,
      };
      const sourceResults = configuredSearch.results;
      const preferredHosts = preferredHostsByApex(configuredSources);
      const exaResults = sourceResults.flatMap((source) =>
        source.results.map((result) => ({
          ...result,
          title: source.sourceName
            ? `${source.sourceName}：${result.title}`
            : result.title,
        })),
      );
      const bestByUrl = new Map<string, (typeof exaResults)[number]>();
      for (const result of exaResults) {
        const key = this.normalizeExternalUrl(result.url);
        const browsableUrl = result.officialData?.length
          ? result.url
          : alignExternalResultUrl(result.url, preferredHosts);
        const current = bestByUrl.get(key);
        if (current?.officialData?.length && result.officialData?.length) {
          const rows = [
            ...new Map(
              [...current.officialData, ...result.officialData].map((row) => [
                `${row.countryCode}/${row.year}/${row.indicatorCode}`,
                row,
              ]),
            ).values(),
          ];
          bestByUrl.set(key, {
            ...result,
            officialData: rows,
            description: `${current.description}\n${result.description}`,
          });
          continue;
        }
        if (!current || (result.score ?? 0) > (current.score ?? 0)) {
          bestByUrl.set(key, { ...result, url: browsableUrl });
        } else {
          const upgraded = alignExternalResultUrl(current.url, preferredHosts);
          if (upgraded !== current.url) {
            bestByUrl.set(key, { ...current, url: upgraded });
          }
        }
      }
      const afterUrlDedupe = [...bestByUrl.values()];
      const afterSimilarDedupe =
        this.dedupeSimilarExternalResults(afterUrlDedupe);
      const reranked = await this.rerankExternalResults(
        normalized,
        afterSimilarDedupe.filter((item) => !item.officialData?.length),
        resolution,
        normalizedFilters,
        plan,
      );
      // Empty relevant results are preferable to presenting unrelated evidence.
      const matches = buildRelevanceMatcher(resolution, normalizedFilters);
      const relevantExaResults = reranked.filter(
        (item) =>
          matches(
            `${item.title}\n${item.description}\n${item.extraSnippets.join('\n')}`,
          ) && this.isStrongExternalMatch(item, plan),
      );
      const uniqueExaResults = [
        ...afterUrlDedupe.filter((item) => item.officialData?.length),
        ...relevantExaResults,
      ];
      this.logger.log(
        `Exa pipeline configuredSources=${configuredSources.length} ` +
          `rawHits=${exaResults.length} uniqueUrl=${afterUrlDedupe.length} ` +
          `afterSimilarDedupe=${afterSimilarDedupe.length} afterRerank=${reranked.length} ` +
          `kept=${uniqueExaResults.length} ` +
          `searchQuery=${JSON.stringify(externalQuery)}`,
      );
      if (uniqueExaResults.length) {
        this.logger.log(
          `Exa kept results=${JSON.stringify(
            uniqueExaResults.map((item) => ({
              score: Number((item.score ?? 0).toFixed(3)),
              url: item.url,
              title: item.title.slice(0, 120),
            })),
          )}`,
        );
      }
      if (uniqueExaResults.length) {
        const titleTranslations = await this.chat.translateDisplayNames(
          uniqueExaResults.map((result) => result.title),
        );
        await this.evidence.saveExternalEvidence(
          aiQueryId,
          uniqueExaResults.map((r) => {
            const body = [r.description, ...r.extraSnippets]
              .filter(Boolean)
              .join('\n');
            const relevance = scoreDocumentRelevance(
              `${r.title}\n${body}`,
              plan,
            );
            return {
              title: titleTranslations[r.title] ?? r.title,
              content: body,
              url: r.url,
              score: r.score ?? 0.6,
              metadata: attachRelevanceMetadata(
                {
                  provider: `${provider}-search`,
                  originalTitle: r.title,
                  displayTitle: titleTranslations[r.title] ?? r.title,
                  ...(r.officialData?.length
                    ? {
                        provider: r.officialProvider ?? 'official-api',
                        analysisProvider: r.officialProvider ?? 'official-api',
                        structuredData: r.officialData,
                        contentMode: 'structured',
                      }
                    : {}),
                  researchSourcePlan: sourcePlan,
                  researchLoop,
                  ...(discovery ? { researchDiscovery: discovery } : {}),
                  exaScore: r.exaScore,
                  platformScore: r.platformScore,
                },
                relevance,
              ),
            };
          }),
        );
        evidenceCount += uniqueExaResults.length;
        if (retrieval.evaluation && !retrieval.evaluation.sufficient) {
          evidenceBlocks.push(
            `检索质量说明：${discoveryNote}缺口：${retrieval.evaluation.gaps.join('、')}。仅依据实际证据回答，未覆盖内容必须明确说明。`,
          );
        }
        const answerEvidence = uniqueExaResults.slice(
          0,
          this.externalAnswerTopK,
        );
        answerEvidence.forEach((r) => {
          const description = r.officialData?.length
            ? JSON.stringify(
                r.officialData.map((row) => ({
                  country: row.country,
                  year: row.year,
                  indicator: row.indicatorCode,
                  value: row.value,
                  unit: row.unit,
                })),
              ).slice(0, 12000)
            : r.description.slice(0, 600);
          evidenceBlocks.push(
            `[E${evidenceBlocks.length + 1}] 外部搜索\n${r.title}\n${description}`,
          );
        });
        stages.push({
          key: 'exa',
          label: '外部搜索补充',
          status: 'completed',
          detail:
            discoveryNote +
            this.exaStageDetail(
              selectedSourceNames.length,
              sourcePlan.sources.length,
              configuredSearch,
              uniqueExaResults.length,
              answerEvidence.length,
              useDiscovery,
            ),
        });
      } else {
        stages.push({
          key: 'exa',
          label: '外部搜索补充',
          status: 'completed',
          detail:
            discoveryNote +
            this.exaStageDetail(
              selectedSourceNames.length,
              sourcePlan.sources.length,
              configuredSearch,
              0,
              0,
              useDiscovery,
            ),
        });
      }
    } catch (err) {
      stages.push({
        key: 'exa',
        label: '外部搜索补充',
        status: 'failed',
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    return { stages, evidenceBlocks, evidenceCount };
  }

  /**
   * Keeps the LLM-rewritten query expressive while making the resolved business
   * constraints explicit for the external search engine.
   */
  private buildExternalSearchQuery(
    optimizedQuery: string,
    resolution: SemanticResolution,
    filters: ResearchFilters,
  ): string {
    const constraints = this.externalConstraints(resolution, filters);
    const intentTerms = {
      metric_query: '统计 数据 指标 数据集',
      analysis: '趋势 报告 数据 分析 对比',
      lookup: '官方 定义 说明 资料',
      general: '',
    }[resolution.intent];
    const phrases = [optimizedQuery, intentTerms, ...constraints.all];
    return [...new Set(phrases.map((value) => value.trim()).filter(Boolean))]
      .join(' ')
      .slice(0, 500);
  }

  private async rerankExternalResults(
    _query: string,
    results: ExaResult[],
    resolution: SemanticResolution,
    filters: ResearchFilters,
    plan: ResearchQueryPlan,
  ): Promise<ExaResult[]> {
    const constraints = this.externalConstraints(resolution, filters);
    const candidates = [...results]
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .slice(0, this.externalRerankCandidateMax);

    return candidates
      .map((item) => {
        const exaScore = this.normalizeScore(item.score ?? 0.6);
        const platformScore = this.computePlatformCompositeScore(
          item,
          constraints,
          plan,
        );
        const score =
          this.externalPlatformScoreWeight * platformScore +
          this.externalExaScoreWeight * exaScore;
        return { ...item, score, exaScore, platformScore };
      })
      .sort((left, right) => this.compareExternalRankScores(left, right));
  }

  /** Platform-side composite (keywords, dimensions, plan relevance, site trust). */
  private computePlatformCompositeScore(
    item: ExaResult,
    constraints: ReturnType<AiQueryService['externalConstraints']>,
    plan: ResearchQueryPlan,
  ): number {
    const titleScore = this.keywordCoverage(item.title, constraints.keywords);
    const body = `${item.title}\n${item.description}\n${item.extraSnippets.join('\n')}`;
    const contentScore = this.keywordCoverage(
      `${item.description}\n${item.extraSnippets.join('\n')}`,
      constraints.keywords,
    );
    const dimensionScore = this.dimensionCoverage(body, constraints);
    const trustScore = this.externalSourceTrust(item.url);
    const relevanceScore = scoreDocumentRelevance(body, plan).score;
    const snippetScore = scoreDocumentRelevance(
      `${item.description}\n${item.extraSnippets.join('\n')}`,
      plan,
    ).score;
    const titleOnly =
      scoreDocumentRelevance(item.title, plan).score >= 0.45 &&
      snippetScore < 0.28;
    const blendedRelevance = titleOnly ? relevanceScore * 0.45 : relevanceScore;
    return this.normalizeScore(
      titleScore * 0.22 +
        contentScore * 0.18 +
        dimensionScore * 0.28 +
        trustScore * 0.12 +
        blendedRelevance * 0.2,
    );
  }

  private isStrongExternalMatch(
    item: ExaResult,
    plan: ResearchQueryPlan,
  ): boolean {
    const body = `${item.title}\n${item.description}\n${item.extraSnippets.join('\n')}`;
    const relevance = scoreDocumentRelevance(body, plan);
    if (
      hasEncodingDamage(item.title) ||
      hasEncodingDamage(item.description) ||
      item.extraSnippets.some(hasEncodingDamage)
    )
      return false;
    if (!textMatchesPlanEntities(body, plan)) return false;
    if (
      !textFocusesOnPlanRegions(
        item.title,
        `${item.description}\n${item.extraSnippets.join('\n')}`,
        plan,
      )
    )
      return false;
    if (plan.entities.length && !relevance.matchedEntities.length) return false;
    if (plan.metrics.length && !relevance.matchedMetrics.length) return false;
    // A title match with no useful snippet is a navigation page, not evidence.
    const snippet =
      `${item.description}\n${item.extraSnippets.join('\n')}`.trim();
    if (snippet.length < 80 && relevance.score < 0.62) return false;
    return relevance.score >= (plan.confidence >= 0.65 ? 0.42 : 0.32);
  }

  private compareExternalRankScores(left: ExaResult, right: ExaResult): number {
    const combinedDelta = (right.score ?? 0) - (left.score ?? 0);
    if (Math.abs(combinedDelta) > 1e-9) return combinedDelta;
    const platformDelta =
      (right.platformScore ?? 0) - (left.platformScore ?? 0);
    if (Math.abs(platformDelta) > 1e-9) return platformDelta;
    return (right.exaScore ?? 0) - (left.exaScore ?? 0);
  }

  private externalConstraints(
    resolution: SemanticResolution,
    filters: ResearchFilters,
  ): {
    countries: string[];
    indicators: string[];
    timeRanges: string[];
    all: string[];
    keywords: string[];
  } {
    const unique = (values: string[]) => [
      ...new Set(values.map((value) => value.trim()).filter(Boolean)),
    ];
    const countries = unique([
      ...resolution.dimensions
        .filter((item) => item.type === 'country_region')
        .map((item) => item.name),
      ...filters.countries,
      ...filters.regions,
    ]);
    const indicators = unique([
      ...resolution.metrics.map((item) => item.name),
      ...filters.indicators,
      ...resolution.entities.map((item) => item.name),
    ]);
    const timeRanges = unique([
      ...(resolution.time.type === 'YEAR' && resolution.time.value
        ? [`${resolution.time.value}`]
        : resolution.time.type === 'RANGE'
          ? [resolution.time.start ?? '', resolution.time.end ?? '']
          : []),
      ...filters.timeRanges,
    ]);
    const all = unique([...countries, ...indicators, ...timeRanges]);
    return {
      countries,
      indicators,
      timeRanges,
      all,
      keywords: unique([
        ...all,
        ...this.keywordTerms([...countries, ...indicators].join(' ')),
      ]),
    };
  }

  private dimensionCoverage(
    text: string,
    constraints: ReturnType<AiQueryService['externalConstraints']>,
  ): number {
    const groups = [
      constraints.countries,
      constraints.indicators,
      constraints.timeRanges,
    ].filter((group) => group.length > 0);
    if (!groups.length) return 1;
    return (
      groups.reduce(
        (total, group) => total + this.keywordCoverage(text, group),
        0,
      ) / groups.length
    );
  }

  private keywordCoverage(text: string, terms: string[]): number {
    if (!terms.length) return 1;
    const normalized = text.toLocaleLowerCase();
    return (
      terms.filter((term) => normalized.includes(term.toLocaleLowerCase()))
        .length / terms.length
    );
  }

  private keywordTerms(text: string): string[] {
    const words =
      text.toLocaleLowerCase().match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]{2,}/g) ??
      [];
    const bigrams = words
      .filter((word) => /^[\u4e00-\u9fff]+$/.test(word))
      .flatMap((word) =>
        Array.from({ length: Math.max(0, word.length - 1) }, (_, index) =>
          word.slice(index, index + 2),
        ),
      );
    return [...new Set([...words, ...bigrams])];
  }

  private normalizeScore(score: number): number {
    if (!Number.isFinite(score)) return 0;
    return Math.min(1, Math.max(0, score));
  }

  private parseSourceTrust(value?: string): Map<string, number> {
    if (!value) return new Map();
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return new Map(
        Object.entries(parsed)
          .map(
            ([domain, score]) =>
              [
                domain.toLowerCase().replace(/^www\./, ''),
                this.normalizeScore(Number(score)),
              ] as const,
          )
          .filter(([, score]) => Number.isFinite(score)),
      );
    } catch {
      this.logger.warn(
        'EXTERNAL_SOURCE_TRUST_JSON 无法解析，将使用默认来源可信度。',
      );
      return new Map();
    }
  }

  private externalSourceTrust(value: string): number {
    try {
      const hostname = new URL(value).hostname
        .toLowerCase()
        .replace(/^www\./, '');
      const configured = this.sourceTrustByDomain.get(hostname);
      if (configured !== undefined) return configured;
      if (
        hostname.endsWith('.gov') ||
        hostname.endsWith('.gov.cn') ||
        hostname.endsWith('.gouv.fr')
      )
        return 1;
      if (
        ['worldbank.org', 'imf.org', 'oecd.org', 'un.org', 'data.gov'].some(
          (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
        )
      )
        return 0.98;
      if (hostname.endsWith('.edu') || hostname.endsWith('.edu.cn'))
        return 0.88;
      return 0.55;
    } catch {
      return 0.3;
    }
  }

  private normalizeExternalUrl(value: string): string {
    try {
      const url = new URL(value);
      url.protocol = url.protocol.toLowerCase();
      url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
      url.hash = '';
      const tracking = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i;
      for (const key of [...url.searchParams.keys()]) {
        if (tracking.test(key)) url.searchParams.delete(key);
      }
      url.search = [...url.searchParams.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(
          ([key, item]) =>
            `${encodeURIComponent(key)}=${encodeURIComponent(item)}`,
        )
        .join('&');
      url.pathname =
        url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
      return url.toString();
    } catch {
      return value.trim();
    }
  }

  private dedupeSimilarExternalResults<T extends ExaResult>(results: T[]): T[] {
    const kept: T[] = [];
    for (const result of results) {
      const signature = this.textSignature(
        `${result.title} ${result.description}`,
      );
      const duplicate = kept.some(
        (item) =>
          result.title.trim() === item.title.trim() &&
          JSON.stringify(
            `${result.title} ${result.description}`.match(
              /[+-]?\d+(?:[.,]\d+)*/g,
            ),
          ) ===
            JSON.stringify(
              `${item.title} ${item.description}`.match(
                /[+-]?\d+(?:[.,]\d+)*/g,
              ),
            ) &&
          this.similarity(
            signature,
            this.textSignature(`${item.title} ${item.description}`),
          ) >= 0.82,
      );
      if (!duplicate) kept.push(result);
    }
    return kept;
  }

  private textSignature(value: string): Set<string> {
    const normalized = value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '');
    return new Set(
      Array.from({ length: Math.max(0, normalized.length - 1) }, (_, index) =>
        normalized.slice(index, index + 2),
      ),
    );
  }

  private similarity(left: Set<string>, right: Set<string>): number {
    if (!left.size || !right.size) return 0;
    let intersection = 0;
    for (const item of left) if (right.has(item)) intersection += 1;
    return intersection / (left.size + right.size - intersection);
  }

  private exaStageDetail(
    selectedSourceCount: number,
    matchedSourceCount: number,
    sourceSearch: {
      attempted: number;
      succeeded: number;
      failed: number;
      skipped: number;
    },
    resultCount: number,
    answerEvidenceCount: number,
    discoveryUsed = false,
  ) {
    if (discoveryUsed) {
      return `在 ${matchedSourceCount} 个计划来源及补充发现范围中分 ${sourceSearch.attempted} 批检索（成功 ${sourceSearch.succeeded}，失败 ${sourceSearch.failed}），返回 ${resultCount} 条去重结果，取前 ${answerEvidenceCount} 条高相关证据生成回答。`;
    }
    if (selectedSourceCount === 0) {
      return `仅在 ${matchedSourceCount} 个计划来源中分 ${sourceSearch.attempted} 批检索（成功 ${sourceSearch.succeeded}，失败 ${sourceSearch.failed}），返回 ${resultCount} 条去重结果，取前 ${answerEvidenceCount} 条高相关证据生成回答。`;
    }
    const skipped = sourceSearch.skipped
      ? `，跳过 ${sourceSearch.skipped} 个重复或无有效域名的来源`
      : '';
    return `仅在 ${matchedSourceCount}/${selectedSourceCount} 个指定来源中分 ${sourceSearch.attempted} 批检索（成功 ${sourceSearch.succeeded}，失败 ${sourceSearch.failed}${skipped}），返回 ${resultCount} 条去重结果，取前 ${answerEvidenceCount} 条高相关证据生成回答。`;
  }

  private resolutionDetail(resolution: SemanticResolution): string {
    const parts = [
      resolution.sourcePlan?.status === 'ready'
        ? `研究目的：${resolution.sourcePlan.intentSummary}；数据需求：${resolution.sourcePlan.dataNeeds.join('、')}；选定网站：${resolution.sourcePlan.sources.map((source) => `${source.websiteUrl}（${source.reason}）`).join('、')}`
        : '',
      resolution.discovery?.metrics.length
        ? `补充指标：${resolution.discovery.metrics.join('、')}`
        : '',
      resolution.discovery?.dataNeeds.length
        ? `待查询数据：${resolution.discovery.dataNeeds.join('、')}`
        : '',
      resolution.metrics.length
        ? `指标：${resolution.metrics.map((m) => m.name).join('、')}`
        : '',
      resolution.entities.length
        ? `实体：${resolution.entities.map((e) => e.name).join('、')}`
        : '',
      resolution.concepts.length
        ? `概念：${resolution.concepts.map((c) => c.name).join('、')}`
        : '',
      resolution.dimensions.length
        ? `维度：${resolution.dimensions.map((d) => d.name).join('、')}`
        : '',
      resolution.time.type !== 'UNKNOWN'
        ? `时间：${resolution.time.type === 'YEAR' ? resolution.time.value : `${resolution.time.start}-${resolution.time.end}`}`
        : '',
    ].filter(Boolean);
    return parts.length
      ? `${parts.join('；')}。路由意图：${resolution.intent}。`
      : '暂未识别明确语义对象，将尝试向量或外部检索。';
  }
}
