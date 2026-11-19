import path from 'node:path';
import { StructuredDataStore } from './structured-data-store';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ResearchFilters,
  ResearchQueryPlan,
  ResearchSearchResponse,
  ResearchSearchMode,
  UploadResponse,
} from '@agent/contracts';
import { ExaSearchService } from './exa-search.service';
import { DocumentParserService } from './document-parser.service';
import { ResearchRepository } from './research.repository';
import { QueryPlannerService } from './query-planner.service';
import { ReportService } from './report.service';
import { AiQueryService } from '../modules/ai-query/ai-query.service';
import { KnowledgeItemService } from '../modules/knowledge/knowledge-item.service';
import { KnowledgeLibraryService } from '../modules/knowledge/knowledge-library.service';
import { KnowledgeAccessScopeService } from '../modules/knowledge/knowledge-access-scope.service';
import { UserDepositKnowledgeDto } from '../modules/knowledge/dto/knowledge.dto';
import { KnowledgeItemViewDto } from '../modules/knowledge/dto/knowledge-response.dto';
import { KnowledgeVisibility } from '@prisma/client';
import { BusinessException } from '../common/exceptions/business.exception';
import { EmbeddingService } from '../infrastructure/ai/embedding.service';
import { MilvusService } from '../infrastructure/milvus/milvus.service';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import type { SemanticResolution } from '../modules/semantic/semantic.types';
import {
  ResearchCatalogService,
  type ResearchCatalog,
} from './research-catalog.service';
import {
  buildExternalSearchBranches,
  externalSearchDomains,
  matchesResearchFilters,
} from './research-filtering';
import type { ExaResult, SourceEntity } from './research.types';
import {
  mapQueryEvidenceToSources,
  toResearchSourceResponse,
} from './query-evidence-sources.mapper';
import { WorldBankDataService } from './world-bank-data.service';
import {
  SiteDataDiscoveryService,
  needsStructuredDiscovery,
} from './site-data-discovery.service';
import { reportResearchProgress } from '../modules/search/research-progress';

@Injectable()
export class ResearchService {
  private readonly logger = new Logger(ResearchService.name);
  private readonly structuredStore: StructuredDataStore;
  private readonly cacheTtlSeconds: number;
  private readonly cacheVersion: string;
  private readonly embeddingModel: string;

  constructor(
    private readonly repository: ResearchRepository,
    private readonly parser: DocumentParserService,
    private readonly exa: ExaSearchService,
    private readonly planner: QueryPlannerService,
    private readonly reports: ReportService,
    private readonly knowledge: KnowledgeItemService,
    private readonly knowledgeLibraries: KnowledgeLibraryService,
    private readonly catalog: ResearchCatalogService,
    private readonly worldBank: WorldBankDataService,
    private readonly aiQuery: AiQueryService,
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly milvus: MilvusService,
    config: ConfigService,
    private readonly accessScope?: KnowledgeAccessScopeService,
    @Optional()
    private readonly siteDataDiscovery?: SiteDataDiscoveryService,
  ) {
    this.structuredStore = new StructuredDataStore(
      undefined,
      undefined,
      (message) => this.logger.warn(message),
      prisma,
    );
    this.cacheTtlSeconds =
      config.get<number>('RESEARCH_CACHE_TTL_SECONDS') ?? 3600;
    this.cacheVersion = config.get<string>('RESEARCH_CACHE_VERSION') ?? 'v1';
    this.embeddingModel = config.get<string>('EMBEDDING_MODEL') ?? 'unknown';
  }

  async getFilterCatalog() {
    return (await this.catalog.load()).filters;
  }

  getStatus() {
    return {
      vectorSearch: this.embedding.isReady() && this.milvus.isReady(),
      externalSearch: this.exa.configured,
    };
  }

  async upload(
    file: Express.Multer.File,
    actorId: string | null = null,
  ): Promise<UploadResponse> {
    const parsed = await this.parser.parseFile(file);
    const knowledgeItem = await this.knowledge.ingestPendingUpload(
      file,
      actorId,
    );
    const source = await this.repository.createSource({
      title: path.basename(file.originalname),
      origin: 'upload',
      storageType: parsed.storageType,
      mimeType: file.mimetype,
      textContent: parsed.textContent,
      searchText: `${file.originalname}\n${parsed.textContent}`,
      structuredData: parsed.structuredData,
      metadata: {
        ...parsed.metadata,
        originalName: file.originalname,
        size: file.size,
        storageMode: this.repository.storageMode,
        knowledgeItemId: knowledgeItem.id,
        knowledgeItemCode: knowledgeItem.code,
        libraryId: knowledgeItem.libraryId,
        auditStatus: knowledgeItem.auditStatus,
        publishStatus: knowledgeItem.publishStatus,
        vectorStatus: knowledgeItem.vectorStatus,
      },
      recordCount: parsed.recordCount,
    });

    await this.knowledge.mergeSourceMeta(knowledgeItem.id, {
      researchSourceId: source.id,
    });

    return {
      source,
      message:
        parsed.storageType === 'structured'
          ? `已解析 ${parsed.recordCount} 条结构化记录，并已写入「用户补充数据知识库」开始学习。`
          : '文档已解析并写入「用户补充数据知识库」，正在学习建索引。',
    };
  }

  /**
   * 用户端「存入知识库」：勾选研究来源批量入库。
   * 每个来源独立调用 KnowledgeItemService.ingest*（与上传同一处理链路）。
   */
  async depositToKnowledge(dto: UserDepositKnowledgeDto, actorId: string) {
    const sourceIds = [
      ...new Set(dto.sourceIds.map((id) => id.trim()).filter(Boolean)),
    ];
    if (!sourceIds.length) {
      throw new BusinessException(
        'KNOWLEDGE_DEPOSIT_EMPTY',
        '请至少勾选一个来源',
        400,
      );
    }

    await this.knowledgeLibraries.assertUserCanDeposit(dto.libraryId, actorId);
    const library = await this.knowledgeLibraries.detail(dto.libraryId);
    const sources = await this.repository.getSourcesByIds(sourceIds);
    if (!sources.length) {
      throw new BusinessException(
        'KNOWLEDGE_SOURCE_NOT_FOUND',
        '未找到勾选的研究来源',
        404,
      );
    }
    const found = new Set(sources.map((s) => s.id));
    const missing = sourceIds.filter((id) => !found.has(id));
    if (missing.length) {
      throw new BusinessException(
        'KNOWLEDGE_SOURCE_NOT_FOUND',
        `部分来源不存在：${missing.slice(0, 3).join(', ')}`,
        404,
      );
    }

    const tagNames = dto.tags?.map((t) => t.trim()).filter(Boolean);
    const options = {
      libraryId: dto.libraryId,
      groupCode: dto.groupCode,
      visibility: dto.visibility ?? library.visibility,
      tagNames,
    };

    const results: Array<{
      sourceId: string;
      sourceTitle: string;
      item: KnowledgeItemViewDto;
    }> = [];
    const errors: Array<{ sourceId: string; title: string; message: string }> =
      [];

    for (const source of sources) {
      try {
        const item = await this.ingestSourceToLibrary(source, actorId, options);
        results.push({
          sourceId: source.id,
          sourceTitle: source.title,
          item,
        });
      } catch (err) {
        let message = '存入失败';
        if (err instanceof BusinessException) {
          const resp = err.getResponse();
          message =
            typeof resp === 'object' &&
            resp !== null &&
            'message' in resp &&
            typeof (resp as { message: unknown }).message === 'string'
              ? (resp as { message: string }).message
              : err.message;
        } else if (err instanceof Error) {
          message = err.message;
        }
        errors.push({
          sourceId: source.id,
          title: source.title,
          message,
        });
      }
    }

    const needsAudit = library.visibility === KnowledgeVisibility.public;
    const ok = results.length;
    const fail = errors.length;
    const message =
      fail === 0
        ? needsAudit
          ? `已提交 ${ok} 个来源，公用知识库自动审核通过后将切片建索引`
          : `已存入 ${ok} 个来源，私有知识库将自动学习切片并参与智搜`
        : `成功 ${ok} 个，失败 ${fail} 个`;

    return {
      libraryId: dto.libraryId,
      libraryName: library.name,
      needsAudit,
      successCount: ok,
      failedCount: fail,
      items: results,
      errors,
      message,
    };
  }

  private async ingestSourceToLibrary(
    source: SourceEntity,
    actorId: string,
    options: {
      libraryId: string;
      groupCode?: string;
      visibility?: KnowledgeVisibility;
      tagNames?: string[];
    },
  ) {
    const meta = (source.metadata ?? {}) as Record<string, unknown>;
    const knowledgeItemId =
      typeof meta.knowledgeItemId === 'string'
        ? meta.knowledgeItemId
        : undefined;
    const commonMeta = {
      uploadChannel: 'research_deposit',
      researchSourceId: source.id,
      origin: source.origin,
      sourceUrl: source.sourceUrl ?? null,
    };

    const textBody = [
      source.title,
      source.sourceUrl ? `来源链接：${source.sourceUrl}` : '',
      '',
      source.textContent?.trim() || source.excerpt?.trim() || source.title,
    ]
      .filter((line, i, arr) => !(line === '' && arr[i - 1] === ''))
      .join('\n');

    let item: KnowledgeItemViewDto;
    if (knowledgeItemId) {
      const existing = await this.prisma.knowledgeItem.findFirst({
        where: { id: knowledgeItemId, deletedAt: null },
        select: { id: true, fileKey: true },
      });
      if (existing?.fileKey) {
        item = await this.knowledge.ingestCopyFromItem(
          knowledgeItemId,
          actorId,
          {
            ...options,
            title: source.title,
            sourceMeta: commonMeta,
          },
        );
      } else {
        item = await this.knowledge.ingestFromTextContent(
          {
            title: source.title,
            text: textBody,
          },
          actorId,
          { ...options, sourceMeta: commonMeta },
        );
      }
    } else {
      item = await this.knowledge.ingestFromTextContent(
        {
          title: source.title,
          text: textBody,
        },
        actorId,
        { ...options, sourceMeta: commonMeta },
      );
    }

    await this.knowledge.mergeSourceMeta(item.id, {
      researchSourceId: source.id,
    });
    return item;
  }

  async generateReport(query: string, sourceIds: string[], actorId?: string) {
    const normalizedQuery = query.trim();
    const ids = [...new Set(sourceIds.map((id) => id.trim()).filter(Boolean))];
    if (normalizedQuery.length < 2) {
      throw new BadRequestException('研究问题至少需要两个字符。');
    }
    if (ids.length === 0) {
      throw new BadRequestException('请至少选择一个来源生成研究报告。');
    }
    if (ids.length > 100) {
      throw new BadRequestException('单次报告最多使用 100 个来源。');
    }

    const sources = await this.repository.getSourcesByIds(ids);
    if (sources.length !== ids.length) {
      throw new NotFoundException('部分所选来源已失效，请重新检索。');
    }

    if (actorId && this.accessScope) {
      const accessible =
        await this.accessScope.resolveAccessibleKnowledgeIds(actorId);
      const forbidden = sources.find((source) => {
        const knowledgeItemId = source.metadata?.knowledgeItemId;
        return (
          typeof knowledgeItemId === 'string' &&
          !accessible.has(knowledgeItemId)
        );
      });
      if (forbidden) {
        throw new ForbiddenException(`无权使用来源「${forbidden.title}」。`);
      }
    }

    return this.reports.generate(normalizedQuery, sources);
  }

  async search(
    query: string,
    filters?: Partial<ResearchFilters>,
    mode: ResearchSearchMode = 'mixed',
  ): Promise<ResearchSearchResponse> {
    const normalizedQuery = query.trim();
    const resolvedMode = this.resolveSearchMode(normalizedQuery, mode);
    const normalizedFilters: ResearchFilters = {
      countries: filters?.countries ?? [],
      regions: filters?.regions ?? [],
      entities: filters?.entities ?? [],
      indicators: filters?.indicators ?? [],
      timeRanges: filters?.timeRanges ?? [],
      sources: filters?.sources ?? [],
    };
    const catalog = await this.catalog.load();
    const legacyPlan = this.planner.plan(
      normalizedQuery,
      catalog,
      normalizedFilters,
    );
    const fingerprint = this.queryFingerprint(
      normalizedQuery,
      normalizedFilters,
      resolvedMode,
    );
    const runId = await this.repository.createRun({
      query: normalizedQuery,
      fingerprint,
      filters: normalizedFilters,
    });

    try {
      const result = await this.aiQuery.execute(
        normalizedQuery,
        normalizedFilters,
        resolvedMode,
      );
      const mappedSources = await mapQueryEvidenceToSources(
        await this.prisma.queryEvidence.findMany({
          where: { aiQueryId: result.aiQueryId },
          orderBy: { createdAt: 'asc' },
        }),
        { repository: this.repository, prisma: this.prisma },
      );
      const sources = await this.hydrateStructuredSources(
        mappedSources,
        normalizedQuery,
      );
      const plan = this.semanticToPlan(result.resolution, legacyPlan);
      const usedExa = result.stages.some(
        (stage) => stage.key === 'exa' && stage.status === 'completed',
      );
      const cacheExpiresAt = new Date(Date.now() + this.cacheTtlSeconds * 1000);

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
        reportMarkdown: result.answer,
        resultJson: {
          runId,
          query: normalizedQuery,
          mode: resolvedMode,
          matchedLocally: sources.length > 0,
          usedExa,
          exaConfigured: this.exa.configured,
          cacheHit: false,
          cachedAt: null,
          plan,
          sources: sources.map((source) => this.toResponseSource(source)),
          stages: result.stages,
          answer: result.answer,
          aiQueryId: result.aiQueryId,
        },
      });

      return {
        runId,
        query: normalizedQuery,
        mode: resolvedMode,
        matchedLocally: sources.length > 0,
        usedExa,
        exaConfigured: this.exa.configured,
        cacheHit: false,
        cachedAt: null,
        plan,
        sources: sources.map((source) => this.toResponseSource(source)),
        stages: result.stages,
        answer: result.answer,
        aiQueryId: result.aiQueryId,
      };
    } catch (error) {
      this.logger.error(
        `Research search failed: ${this.errorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.repository.failRun(runId, this.errorMessage(error));
      throw error;
    }
  }

  private semanticToPlan(
    resolution: SemanticResolution,
    fallback: ResearchQueryPlan,
  ): ResearchQueryPlan {
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
      ...regions,
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
    const timeRanges =
      resolution.time.type === 'YEAR' && resolution.time.value
        ? [`${resolution.time.value}`]
        : resolution.time.type === 'RANGE' &&
            resolution.time.start &&
            resolution.time.end
          ? [`${resolution.time.start}-${resolution.time.end}`]
          : fallback.timeRanges;

    const explanationParts = [
      countries.length ? `国家：${countries.join('、')}` : '',
      regions.length ? `地区：${regions.join('、')}` : '',
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

  private resolveSearchMode(
    query: string,
    selected: ResearchSearchMode,
  ): ResearchSearchMode {
    if (selected === 'ai-search') return selected;
    const text = query.toLowerCase();
    // Explicit wording in the question takes precedence over the UI selection.
    if (/混合|本地和网络|知识库和网络|知识库和exa|本地和外部/.test(text))
      return 'mixed';
    if (/知识库|本地知识|本地数据|内部资料/.test(text)) return 'knowledge';
    if (/联网|网络|互联网|exa|外部来源|在线搜索/.test(text)) return 'exa';
    return selected;
  }

  private queryFingerprint(
    query: string,
    filters: ResearchFilters,
    mode: ResearchSearchMode = 'mixed',
  ): string {
    const canonicalFilters = Object.fromEntries(
      Object.entries(filters).map(([key, values]) => [
        key,
        [
          ...new Set(values.map((value) => value.trim()).filter(Boolean)),
        ].sort(),
      ]),
    );
    return createHash('sha256')
      .update(
        JSON.stringify({
          query: query.replace(/\s+/g, ' ').trim().toLowerCase(),
          filters: canonicalFilters,
          mode,
          embeddingModel: this.embeddingModel,
          cacheVersion: this.cacheVersion,
        }),
      )
      .digest('hex');
  }

  private branchFingerprint(
    query: string,
    filters: ResearchFilters,
    domains: string[],
  ): string {
    return createHash('sha256')
      .update(
        JSON.stringify({
          query: query.replace(/\s+/g, ' ').trim().toLowerCase(),
          filters: Object.fromEntries(
            Object.entries(filters).map(([key, values]) => [
              key,
              [
                ...new Set(values.map((value) => value.trim()).filter(Boolean)),
              ].sort(),
            ]),
          ),
          domains: [...domains].sort(),
          cacheVersion: this.cacheVersion,
          embeddingModel: this.embeddingModel,
        }),
      )
      .digest('hex');
  }

  private async hasCompleteBranchCache(
    query: string,
    plan: ResearchSearchResponse['plan'],
    catalog: ResearchCatalog,
  ): Promise<boolean> {
    const domains = externalSearchDomains(plan.sources, catalog);
    const branches = buildExternalSearchBranches(query, plan);
    const cached = await Promise.all(
      branches.map(async (branch) => {
        const value = await this.repository.findCachedBranch(
          this.branchFingerprint(query, branch.filters, domains),
        );
        if (!value || value.sourceIds.length === 0) return false;
        const sources = await this.repository.getSourcesByIds(value.sourceIds);
        return sources.length === value.sourceIds.length;
      }),
    );
    return cached.every(Boolean);
  }

  private sourcesForFilters(
    sources: SourceEntity[],
    filters: ResearchFilters,
    catalog: ResearchCatalog,
  ): SourceEntity[] {
    const filtered = sources.filter((source) =>
      matchesResearchFilters(
        {
          text: `${source.title}\n${source.textContent}`,
          datasetId: this.sourceDatasetId(source),
        },
        filters,
        catalog,
      ),
    );
    const hasExplicitFilter = Object.values(filters).some(
      (values) => values.length > 0,
    );
    // With no filters, a low score can be a collision on a common year or
    // acronym. Do not let it suppress an otherwise necessary Exa search.
    return hasExplicitFilter
      ? filtered
      : filtered.filter((source) => (source.score ?? 0) >= 0.7);
  }

  private sourceScores(sources: SourceEntity[]): Record<string, number> {
    return Object.fromEntries(
      sources
        .filter((source) => source.score !== undefined)
        .map((source) => [source.id, source.score!]),
    );
  }

  private planDetail(query: string, explanation: string): string {
    return `用户问题：“${query}”。${explanation}`;
  }

  private toResponseSource(
    source: SourceEntity,
  ): ResearchSearchResponse['sources'][number] {
    return toResearchSourceResponse(source);
  }

  private dedupeSources(sources: SourceEntity[]): SourceEntity[] {
    return [...new Map(sources.map((source) => [source.id, source])).values()];
  }

  private branchDetail(queries: string[]): string {
    return queries.length > 1 ? `并行执行 ${queries.length} 个筛选分支，` : '';
  }

  private filterDetail(filters: ResearchFilters): string {
    return Object.values(filters).some((values) => values.length > 0)
      ? '按同维度 OR、跨维度 AND 筛选，'
      : '';
  }

  private sourceDatasetId(source: SourceEntity): string | undefined {
    const value = source.metadata?.datasetId;
    return typeof value === 'string' ? value : undefined;
  }

  private async searchExaBranches(
    queries: string[],
    domains: string[] = [],
  ): Promise<{
    results: ExaResult[];
    failed: number;
  }> {
    const settled = await Promise.allSettled(
      queries.map((branch) => this.exa.search(branch, domains)),
    );
    const successful = settled.filter(
      (result): result is PromiseFulfilledResult<ExaResult[]> =>
        result.status === 'fulfilled',
    );
    if (successful.length === 0) {
      const failure = settled.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      throw failure?.reason ?? new Error('Exa 所有检索分支均失败。');
    }
    return {
      results: successful.flatMap((result) => result.value),
      failed: settled.length - successful.length,
    };
  }

  private hasMissingCoverage(
    sources: SourceEntity[],
    plan: ResearchSearchResponse['plan'],
  ): boolean {
    if (sources.length === 0) return true;
    const searchable = sources
      .map((source) => `${source.title}\n${source.textContent}`.toLowerCase())
      .join('\n');
    const missingCountry = plan.countries.some(
      (country) => !searchable.includes(country.toLowerCase()),
    );
    const missingIndicator =
      plan.indicators.length > 0 &&
      !plan.indicators.some((indicator) =>
        searchable.includes(indicator.toLowerCase()),
      );
    return missingCountry || missingIndicator;
  }

  private async ingestExaResults(
    results: ExaResult[],
  ): Promise<SourceEntity[]> {
    return (
      await Promise.all(
        results.map(async (result) => {
          const structured = await this.tryStructuredRemote(result);
          if (structured) return structured;
          const textContent = [result.description, ...result.extraSnippets]
            .filter(Boolean)
            .join('\n');
          return this.repository.createSource({
            title: result.title,
            origin: 'exa',
            storageType: 'knowledge',
            sourceUrl: result.url,
            mimeType: 'text/html',
            textContent: textContent || result.title,
            searchText: `${result.title}\n${textContent}`,
            metadata: {
              provider: 'exa-search',
              knowledgeMode: 'exa-source-text',
            },
            recordCount: 0,
          });
        }),
      )
    ).filter((source): source is SourceEntity => Boolean(source));
  }

  async hydrateStructuredSources(
    sources: SourceEntity[],
    query = '',
  ): Promise<SourceEntity[]> {
    const hydrated = await Promise.all(
      sources.map(async (source) => {
        if (
          source.origin !== 'exa' ||
          source.structuredData != null ||
          !source.sourceUrl
        )
          return source;
        const structured = await this.tryStructuredRemote(
          {
            title: source.title,
            url: source.sourceUrl,
            description: source.excerpt,
            extraSnippets: [],
          },
          source.metadata,
        );
        return structured ? { ...structured, score: source.score } : source;
      }),
    );
    if (!this.siteDataDiscovery) return hydrated;
    if (
      needsStructuredDiscovery(query) &&
      hydrated.some((source) => source.sourceUrl)
    ) {
      await reportResearchProgress({
        stage: 'discovering',
        message: '正在沿相关网站目录查找可下载的数据文件',
      });
    }
    const discovered = await this.siteDataDiscovery.discover(hydrated, query);
    const saved = await Promise.all(
      discovered.map((input) => this.repository.createSource(input)),
    );
    return this.dedupeSources([...hydrated, ...saved]);
  }

  private async tryStructuredRemote(
    result: ExaResult,
    metadata?: Record<string, unknown>,
  ): Promise<SourceEntity | undefined> {
    if (!this.isSafeStructuredUrl(result.url)) return undefined;
    // Only the public, unauthenticated download path uses URL-based shared reuse.
    const key = `public-download-v1:${result.url}`;
    const input = await this.structuredStore.getOrLoad(
      'remote',
      key,
      () => this.downloadStructuredRemote(result),
      (value) =>
        value?.storageType === 'structured' && value.structuredData != null,
    );
    if (!input) return undefined;
    return this.repository.createSource({
      ...input,
      title: result.title,
      metadata: { ...metadata, ...input.metadata },
      searchText: `${result.title}\n${input.textContent}`,
    });
  }

  private async downloadStructuredRemote(
    result: ExaResult,
  ): Promise<import('./research.types').CreateSourceInput | undefined> {
    try {
      const response = await fetch(result.url, {
        signal: AbortSignal.timeout(8_000),
        headers: { Accept: 'application/json,text/csv;q=0.9,*/*;q=0.1' },
      });
      if (!response.ok) return undefined;
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > 2_000_000) return undefined;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 2_000_000) return undefined;
      const parsed = await this.parser.parseBuffer(
        new URL(result.url).pathname,
        response.headers.get('content-type') ?? '',
        buffer,
      );
      if (parsed.storageType !== 'structured') return undefined;
      return {
        title: result.title,
        origin: 'exa',
        storageType: 'structured',
        sourceUrl: result.url,
        mimeType: response.headers.get('content-type') ?? undefined,
        textContent: parsed.textContent,
        searchText: `${result.title}\n${parsed.textContent}`,
        structuredData: parsed.structuredData,
        metadata: { ...parsed.metadata, provider: 'exa-search' },
        recordCount: parsed.recordCount,
      };
    } catch (error) {
      this.logger.debug(
        `Structured source fetch skipped for ${result.url}: ${this.errorMessage(error)}`,
      );
      return undefined;
    }
  }

  private isSafeStructuredUrl(value: string): boolean {
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      if (url.protocol !== 'https:') return false;
      if (
        hostname === 'localhost' ||
        hostname.endsWith('.local') ||
        /^(127\.|10\.|192\.168\.|169\.254\.)/.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
      ) {
        return false;
      }
      return /\.(csv|json|xlsx|xls)$/i.test(url.pathname);
    } catch {
      return false;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

function dedupeExaResults(results: ExaResult[]): ExaResult[] {
  const seen = new Set<string>();
  return results.filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
