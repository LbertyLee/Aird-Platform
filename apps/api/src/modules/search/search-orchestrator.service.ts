import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
  Optional,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { SEARCH_QUEUE, type SearchJobData } from './search-job.types';
import { ConfigService } from '@nestjs/config';
import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import type {
  ResearchFilters,
  ResearchSearchMode,
  ResearchSearchResponse,
  ResearchStage,
  ResearchSearchProgress,
} from '@agent/contracts';
import { AiQueryService } from '../ai-query/ai-query.service';
import { DataAnalysisService } from '../data-analysis/data-analysis.service';
import { ExternalSearchService } from '../external-search/external-search.service';
import { MembershipService } from '../membership/membership.service';
import { ResearchRepository } from '../../research/research.repository';
import {
  ExaContentHydrationService,
  isLowQualityPageText,
} from '../../research/exa-content-hydration.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MinioService } from '../../infrastructure/minio/minio.service';
import { KnowledgeAccessScopeService } from '../knowledge/knowledge-access-scope.service';
import { buildDatasetFilePreview } from '../dataset/dataset-file-preview';
import { BusinessNotificationWriter } from '../../common/services/business-notification.writer';
import { normalizeFilters, normalizeQuery } from './search-normalization';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { LlmUsageMeterService } from '../../infrastructure/ai/llm-usage-meter.service';
import {
  reportResearchProgress,
  withResearchProgress,
} from './research-progress';
import { backgroundJobId } from '../../common/utils/background-job-id';
import { ModelSelectionService } from '../../infrastructure/ai/model-selection.service';

const EXA_PREVIEW_MAX_CHARS = 200_000;

type SearchJobRecord = {
  jobId: string;
  userId: string;
  status: 'running' | 'completed' | 'failed';
  query: string;
  progress?: ResearchSearchProgress;
  error?: string | null;
  result?: ResearchSearchResponse | null;
  createdAt: string;
  updatedAt: string;
};

/** The only user-facing mixed-search entry point; branch services remain isolated. */
@Injectable()
export class SearchOrchestratorService {
  private readonly logger = new Logger(SearchOrchestratorService.name);
  private readonly retrievalCacheTtlSeconds: number;
  private readonly searchJobTtlSeconds = 7200;

  constructor(
    private readonly knowledge: DataAnalysisService,
    private readonly external: ExternalSearchService,
    private readonly aiQuery: AiQueryService,
    private readonly repository: ResearchRepository,
    private readonly exaContent: ExaContentHydrationService,
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly accessScope: KnowledgeAccessScopeService,
    private readonly config: ConfigService,
    private readonly membership: MembershipService,
    private readonly notifications: BusinessNotificationWriter,
    private readonly redis: RedisService,
    private readonly usageMeter: LlmUsageMeterService,
    private readonly modelSelection: ModelSelectionService,
    @Optional()
    @InjectQueue(SEARCH_QUEUE)
    private readonly searchQueue?: Queue<SearchJobData>,
  ) {
    this.retrievalCacheTtlSeconds =
      config.get<number>('SEARCH_CACHE_TTL_SECONDS') ?? 30;
  }

  async search(
    userId: string,
    query: string,
    filters?: Partial<ResearchFilters>,
    mode: ResearchSearchMode = 'mixed',
    model?: string,
  ): Promise<ResearchSearchResponse> {
    if (model && !(await this.modelSelection.resolve(model))) throw new BadRequestException('所选模型当前不可用，请刷新后重试。');
    await this.membership.assertCanSearch(userId);
    const reference = randomUUID();
    const metered = await this.usageMeter.measure(() =>
      this.modelSelection.run(model, () => this.searchUnmetered(userId, query, filters, mode)),
    );
    await this.membership.consumeLlmUsagePoints(
      userId,
      reference,
      metered.usage,
    );
    return metered.result;
  }

  async startSearchJob(
    userId: string,
    query: string,
    filters?: Partial<ResearchFilters>,
    mode: ResearchSearchMode = 'mixed',
    requestId?: string,
    model?: string,
  ) {
    if (model && !(await this.modelSelection.resolve(model))) throw new BadRequestException('所选模型当前不可用，请刷新后重试。');
    const jobId = backgroundJobId(userId, { query, filters, mode, model }, requestId);
    if (requestId && (await this.readSearchJob(jobId)))
      return { jobId, status: 'running' as const };
    await this.membership.assertCanSearch(userId);
    const now = new Date().toISOString();
    const record: SearchJobRecord = {
      jobId,
      userId,
      status: 'running',
      query: normalizeQuery(query),
      progress: { stage: 'planning', message: '任务已提交，等待开始检索' },
      error: null,
      result: null,
      createdAt: now,
      updatedAt: now,
    };
    if (
      !(await this.redis.setIfAbsent(
        this.jobRedisKey(jobId),
        JSON.stringify(record),
        this.searchJobTtlSeconds,
      ))
    ) {
      return { jobId, status: 'running' as const };
    }
    if (this.searchQueue) {
      try {
        await this.searchQueue.add(
          'search',
          { jobId, userId, query, filters, mode, model },
          {
            jobId,
            attempts: 1,
            removeOnComplete: { age: 7200, count: 1000 },
            removeOnFail: { age: 7200, count: 1000 },
          },
        );
      } catch {
        await this.patchSearchJob(jobId, {
          status: 'failed',
          error: '检索任务提交失败，请稍后重试。',
        });
        throw new ServiceUnavailableException('检索任务提交失败，请稍后重试。');
      }
    } else {
      void this.runSearchJobBackground(
        jobId,
        userId,
        query,
        filters,
        mode,
        model,
      ).catch((error: unknown) =>
        this.logger.error(
          `search job ${jobId}: background execution failed`,
          error,
        ),
      );
    }
    return { jobId, status: 'running' as const };
  }

  async getSearchJob(userId: string, jobId: string) {
    const record = await this.readSearchJob(jobId);
    if (!record || record.userId !== userId) {
      throw new NotFoundException('检索任务不存在或已过期。');
    }
    return this.toJobSnapshot(record);
  }

  async markSearchJobFailed(jobId: string) {
    try {
      const current = await this.readSearchJob(jobId);
      if (current?.status === 'running') {
        await this.patchSearchJob(jobId, {
          status: 'failed',
          error: '检索任务执行中断，请稍后重试。',
        });
      }
    } catch {
      this.logger.warn(`search job ${jobId}: unable to persist worker failure`);
    }
  }

  async runSearchJobBackground(
    jobId: string,
    userId: string,
    query: string,
    filters: Partial<ResearchFilters> | undefined,
    mode: ResearchSearchMode,
    model?: string,
  ) {
    try {
      await this.patchSearchJob(jobId, {
        progress: { stage: 'planning', message: '正在理解问题并规划检索来源' },
      });
      const reference = jobId;
      let progressWrites = Promise.resolve();
      const metered = await withResearchProgress(
        (progress) => {
          // Mixed branches may report concurrently. Serialize read/merge/write operations.
          progressWrites = progressWrites
            .then(() => this.patchSearchJob(jobId, { progress }))
            .catch(() => {
              this.logger.warn(
                `search job ${jobId}: progress storage unavailable`,
              );
            });
          return progressWrites;
        },
        () =>
          this.usageMeter.measure(() =>
          this.modelSelection.run(model, () => this.searchUnmetered(userId, query, filters, mode)),
          ),
      );
      await progressWrites;
      await this.membership.consumeLlmUsagePoints(
        userId,
        reference,
        metered.usage,
      );
      await this.patchSearchJob(jobId, {
        status: 'completed',
        result: metered.result,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`search job ${jobId} failed: ${message}`);
      try {
        await this.patchSearchJob(jobId, {
          status: 'failed',
          error: message,
          result: null,
        });
      } catch {
        // Job storage is best-effort once the worker has failed.
      }
    }
  }

  private jobRedisKey(jobId: string) {
    return `search:job:v1:${jobId}`;
  }

  private async writeSearchJob(record: SearchJobRecord) {
    await this.redis.set(
      this.jobRedisKey(record.jobId),
      JSON.stringify(record),
      this.searchJobTtlSeconds,
    );
  }

  private async readSearchJob(jobId: string): Promise<SearchJobRecord | null> {
    try {
      const raw = await this.redis.get(this.jobRedisKey(jobId));
      return raw ? (JSON.parse(raw) as SearchJobRecord) : null;
    } catch {
      // A temporary storage failure must not look like an expired task.
      throw new ServiceUnavailableException(
        '检索任务状态暂时不可用，请稍后重试。',
      );
    }
  }

  private async patchSearchJob(
    jobId: string,
    patch: Partial<Omit<SearchJobRecord, 'jobId' | 'userId' | 'createdAt'>>,
  ) {
    const current = await this.readSearchJob(jobId);
    if (!current) return;
    await this.writeSearchJob({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }

  private toJobSnapshot(record: SearchJobRecord) {
    return {
      jobId: record.jobId,
      status: record.status,
      query: record.query,
      progress: record.progress,
      error: record.error ?? null,
      result: record.result ?? null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private async searchUnmetered(
    userId: string,
    query: string,
    filters?: Partial<ResearchFilters>,
    mode: ResearchSearchMode = 'mixed',
  ): Promise<ResearchSearchResponse> {
    const startedAt = Date.now();
    const mark = (stage: string, stageStartedAt: number) =>
      this.logger.log(
        `search stage=${stage} durationMs=${Date.now() - stageStartedAt} totalMs=${Date.now() - startedAt} mode=${mode}`,
      );
    const cacheKey = this.cacheKey(userId, query, filters, mode);
    const cached = await this.readCachedResult(cacheKey);
    if (cached)
      return { ...cached, cacheHit: true, cachedAt: new Date().toISOString() };
    let result: ResearchSearchResponse;
    if (mode === 'knowledge') {
      await reportResearchProgress({
        stage: 'searching',
        message: '正在检索知识库',
      });
      result = await this.knowledge.search(userId, query, filters);
    } else if (mode === 'exa') {
      result = await this.external.search(userId, query, filters);
    } else if (mode === 'ai-search') {
      result = await this.external.search(userId, query, filters, {
        mode: 'ai-search',
      });
    } else {
      // User searches must always execute a fresh retrieval.  Historical
      // runs remain available for browsing, but they are not search caches.
      const prepareStartedAt = Date.now();
      const prepared = await this.aiQuery.prepareQuery(
        normalizeQuery(query),
        normalizeFilters(filters),
      );
      mark('prepareQuery', prepareStartedAt);
      const branchesStartedAt = Date.now();
      await reportResearchProgress({
        stage: 'searching',
        message: '正在检索知识库及相关网站',
      });
      const [knowledgeBranch, externalBranch] = await Promise.allSettled([
        this.knowledge.search(userId, query, filters, {
          persistHistory: false,
          prepared,
          skipBranchAnswer: true,
        }),
        this.external.search(userId, query, filters, {
          persistHistory: false,
          prepared,
          skipBranchAnswer: true,
          mode: 'ai-search',
        }),
      ]);
      mark('branches', branchesStartedAt);
      const knowledge =
        knowledgeBranch.status === 'fulfilled' ? knowledgeBranch.value : null;
      const external =
        externalBranch.status === 'fulfilled' ? externalBranch.value : null;
      if (!knowledge && !external) {
        throw this.branchError(knowledgeBranch, externalBranch);
      }
      const knowledgeStages = knowledge?.stages ?? [
        this.failedStage('knowledge', knowledgeBranch),
      ];
      const externalStages = external?.stages ?? [
        this.failedStage('exa', externalBranch),
      ];
      const summarizeStartedAt = Date.now();
      await reportResearchProgress({
        stage: 'writing',
        message: '正在汇总证据并整理中文回答',
      });
      const merged = {
        ...(knowledge ?? external),
        mode: 'mixed',
        usedExa: external?.usedExa ?? false,
        exaConfigured: external?.exaConfigured ?? false,
        matchedLocally: knowledge?.matchedLocally ?? false,
        sources: [...(knowledge?.sources ?? []), ...(external?.sources ?? [])],
        stages: [
          ...knowledgeStages.map((stage) => ({
            ...stage,
            detail: `[知识库分支] ${stage.detail}`,
          })),
          ...externalStages.map((stage) => ({
            ...stage,
            detail: `[Exa 分支] ${stage.detail}`,
          })),
        ],
        answer: await this.summarizeMixedAnswer(
          query,
          knowledge?.answer ?? '',
          external?.answer ?? '',
        ),
      } as ResearchSearchResponse;
      mark('summarizeMixedAnswer', summarizeStartedAt);
      const persistStartedAt = Date.now();
      const runId = await this.repository.createRun({
        query,
        fingerprint: this.mixedFingerprint(query, filters, userId),
        filters: normalizeFilters(filters),
        userId,
      });
      await this.repository.completeRun({
        id: runId,
        matchedLocally: merged.matchedLocally,
        usedExa: merged.usedExa,
        sourceIds: merged.sources.map((source) => source.id),
        sourceScores: Object.fromEntries(
          merged.sources
            .filter((source) => source.score !== undefined)
            .map((source) => [source.id, source.score!]),
        ),
        cacheExpiresAt: new Date(Date.now() + 3600_000),
        reportMarkdown: merged.answer,
        resultJson: { ...merged, runId },
      });
      result = { ...merged, runId };
      mark('persistRun', persistStartedAt);
    }

    // Neither cache nor notifications are part of the user-visible search
    // critical path. They must not consume the frontend timeout budget.
    void this.writeCachedResult(cacheKey, result);
    void this.notifications.reportReady(userId, query);
    mark('responseReady', startedAt);
    return result;
  }

  private async summarizeMixedAnswer(
    query: string,
    knowledge: string,
    external: string,
  ) {
    try {
      return await this.aiQuery.summarizeBranchAnswers(
        query,
        knowledge,
        external,
      );
    } catch {
      return (
        [knowledge, external].filter(Boolean).join('\n\n') ||
        '暂无足够内部或外部证据回答该问题。'
      );
    }
  }

  private failedStage(
    branch: 'knowledge' | 'exa',
    outcome: PromiseSettledResult<ResearchSearchResponse>,
  ): ResearchStage {
    const message =
      outcome.status === 'rejected' && outcome.reason instanceof Error
        ? outcome.reason.message
        : '分支未返回结果。';
    return {
      key: branch === 'exa' ? 'exa' : 'vector',
      label: branch === 'exa' ? '外部搜索补充' : '知识库检索',
      status: 'failed',
      detail: message,
    };
  }

  private branchError(
    knowledge: PromiseSettledResult<ResearchSearchResponse>,
    external: PromiseSettledResult<ResearchSearchResponse>,
  ) {
    const messages = [knowledge, external]
      .filter(
        (item): item is PromiseRejectedResult => item.status === 'rejected',
      )
      .map((item) =>
        item.reason instanceof Error
          ? item.reason.message
          : String(item.reason),
      );
    return new Error(`知识库与 Exa 搜索均失败：${messages.join('；')}`);
  }

  history(userId: string) {
    return this.repository.listUserRuns(userId);
  }

  deleteHistory(userId: string, runId: string) {
    return this.repository.deleteUserRun(userId, runId);
  }

  async getFilePreview(userId: string, sourceId: string, _apiBaseUrl: string) {
    const source = await this.repository.getSourceById(sourceId);
    if (!source) throw new NotFoundException('该来源没有可预览的原始文件。');

    // Exa / external pages often set X-Frame-Options, so iframe embed fails in
    // the web app even though the URL opens fine in a normal browser tab.
    // Hydrate full text (Exa Contents → direct HTTP) and return a document pane.
    if (source.origin === 'exa') {
      const [hydrated] = await this.exaContent.ensureFullText([source]);
      const text = (hydrated?.textContent ?? source.textContent ?? '').trim();
      if (
        !text ||
        hydrated?.metadata?.extractionUnavailable ||
        isLowQualityPageText(source.title, text)
      ) {
        throw new NotFoundException(
          '未能获取该网页正文，请使用「在新窗口打开原文」。',
        );
      }
      const truncated = text.length > EXA_PREVIEW_MAX_CHARS;
      return {
        kind: 'document' as const,
        fileName: `${source.title || 'exa-source'}.txt`,
        text: truncated ? text.slice(0, EXA_PREVIEW_MAX_CHARS) : text,
        truncated,
        sourceUrl: source.sourceUrl ?? undefined,
      };
    }

    const knowledgeItemId =
      typeof source.metadata?.knowledgeItemId === 'string'
        ? source.metadata.knowledgeItemId
        : null;
    if (!knowledgeItemId)
      throw new NotFoundException('该来源没有可预览的原始文件。');
    const accessible =
      await this.accessScope.resolveAccessibleKnowledgeIds(userId);
    if (!accessible.has(knowledgeItemId))
      throw new ForbiddenException('无权预览该知识库文件。');
    const item = await this.prisma.knowledgeItem.findFirst({
      where: { id: knowledgeItemId, deletedAt: null },
      select: { fileKey: true, fileName: true, mimeType: true },
    });
    if (!item?.fileKey || !item.fileName)
      throw new NotFoundException('知识库原始文件不存在。');

    const isPdf =
      item.mimeType === 'application/pdf' ||
      item.fileName.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      return {
        kind: 'pdf' as const,
        fileName: item.fileName,
        mimeType: 'application/pdf' as const,
        sourceUrl: await this.minio.createPresignedGetUrl(item.fileKey),
      };
    }

    return buildDatasetFilePreview(
      await this.minio.getObject(item.fileKey),
      item.fileName,
    );
  }

  async getPreviewFile(sourceId: string, expiresAt: number, token: string) {
    if (
      !Number.isSafeInteger(expiresAt) ||
      expiresAt < Date.now() ||
      !this.verifyFileToken(sourceId, expiresAt, token)
    )
      throw new ForbiddenException('预览链接已失效。');
    const source = await this.repository.getSourceById(sourceId);
    const knowledgeItemId =
      typeof source?.metadata?.knowledgeItemId === 'string'
        ? source.metadata.knowledgeItemId
        : null;
    if (!knowledgeItemId) throw new NotFoundException('原始文件不存在。');
    const item = await this.prisma.knowledgeItem.findFirst({
      where: { id: knowledgeItemId, deletedAt: null },
      select: { fileKey: true, fileName: true, mimeType: true },
    });
    if (!item?.fileKey || !item.fileName)
      throw new NotFoundException('原始文件不存在。');
    return {
      buffer: await this.minio.getObject(item.fileKey),
      fileName: item.fileName,
      mimeType: item.mimeType || 'application/octet-stream',
    };
  }

  private signFileToken(sourceId: string, expiresAt: number) {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET'))
      .update(`${sourceId}.${expiresAt}`)
      .digest('hex');
  }
  private verifyFileToken(sourceId: string, expiresAt: number, token: string) {
    const expected = this.signFileToken(sourceId, expiresAt);
    return (
      token.length === expected.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    );
  }

  private mixedFingerprint(
    query: string,
    filters: Partial<ResearchFilters> | undefined,
    userId: string,
  ) {
    const normalized = normalizeFilters(filters);
    return createHash('sha256')
      .update(
        JSON.stringify({
          scope: 'mixed-search',
          userId,
          query: query.replace(/\s+/g, ' ').trim().toLowerCase(),
          filters: Object.fromEntries(
            Object.entries(normalized).map(([key, values]) => [
              key,
              [...new Set(values)].sort(),
            ]),
          ),
        }),
      )
      .digest('hex');
  }

  private cacheKey(
    userId: string,
    query: string,
    filters: Partial<ResearchFilters> | undefined,
    mode: ResearchSearchMode,
  ) {
    return this.mixedFingerprint(query, filters, userId) + `:${mode}`;
  }

  private async readCachedResult(
    key: string,
  ): Promise<ResearchSearchResponse | null> {
    try {
      const raw = await this.redis.get(`search:result:v4:${key}`);
      return raw ? (JSON.parse(raw) as ResearchSearchResponse) : null;
    } catch {
      return null;
    }
  }

  private async writeCachedResult(
    key: string,
    result: ResearchSearchResponse,
  ): Promise<void> {
    try {
      await this.redis.set(
        `search:result:v4:${key}`,
        JSON.stringify(result),
        this.retrievalCacheTtlSeconds,
      );
    } catch {
      // Cache is an optimization; a Redis outage must not fail a search.
    }
  }
}
