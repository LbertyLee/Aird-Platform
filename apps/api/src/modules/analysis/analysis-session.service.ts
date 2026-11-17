import { UnWppDataService, isWppSource } from '../../research/un-wpp-data.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import { StructuredDataStore } from '../../research/structured-data-store';
import { collectDisplayNames, localizeDisplayNames } from './display-name-localization';
import { inferQueryCountries } from '../../common/utils/query-countries';
import {
  AnalysisSessionStatus,
  CommonStatus,
  Prisma,
  ResearchRunStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ResearchRepository } from '../../research/research.repository';
import {
  ExaContentHydrationService,
  isLowQualityPageText,
  isTitleOnly,
} from '../../research/exa-content-hydration.service';
import type { SourceEntity } from '../../research/research.types';
import { KnowledgeAccessScopeService } from '../knowledge/knowledge-access-scope.service';
import type { CreateAnalysisSessionDto } from './dto/analysis-session.dto';
import { DeepSeekChatService } from '../../infrastructure/ai/deepseek-chat.service';
import type { LlmExtractionTrace } from '../../infrastructure/ai/deepseek-chat.service';
import type {
  AnalysisPresentation,
  AnalysisVisualReport,
} from '@agent/contracts';
import {
  buildVisualDatasets,
  buildVisualReport,
  validatePresentation,
} from './analysis-visualization';
import {
  selectIndicatorsForExtraction,
  inferQueryDimensionHints,
} from './indicator-query-rank';
import { buildResearchQueryPlanLite } from '../search/research-query-plan';
import {
  explicitYearRangePeriods,
  periodsFromRecentYearPhrase,
  sortYearStrings,
} from '../../common/utils/recent-years';
import { writeLlmExtractionTraces } from './llm-extraction-trace.store';
import { browsableExternalUrl } from '../../common/utils/external-search-domain';
import { normalizeObservationUnits } from './unit-normalize';
import { extractNominalGdpFallback } from '../../infrastructure/ai/gdp-text-fallback';
import { WorldBankDataService } from '../../research/world-bank-data.service';

type AnalysisRow = Record<string, unknown> & {
  __source: string;
  __sourceId: string;
  __indicators?: Array<{
    id: string;
    code: string;
    name: string;
    field: string;
    unit: string;
  }>;
};

/** One canonical metric observation. A source may produce any number of these. */
type AnalysisObservation = {
  sourceId: string;
  source: string;
  indicatorId: string;
  indicatorCode: string;
  indicatorName: string;
  value: number | null;
  originalValue: unknown;
  originalUnit?: string;
  unit: string;
  normalizedValue?: number | null;
  normalizationStatus?: 'same' | 'converted' | 'unknown';
  period?: string;
  entity?: string;
  citation: {
    rowIndex: number;
    field: string;
  };
};

type AnalysisSummaryRow = {
  key: string;
  indicatorId: string;
  indicatorCode: string;
  indicatorName: string;
  unit: string;
  entity?: string;
  period?: string;
  value: number | null;
  observationCount: number;
  sourceCount: number;
  duplicateCount: number;
  conflict: boolean;
  sourceIds: string[];
};

type SourceSummary = {
  id: string;
  title: string;
  origin: SourceEntity['origin'];
  capability: 'structured' | 'extractable' | 'reference-only';
  rowCount: number;
  observationCount: number;
  indicatorNames: string[];
  message: string;
};

type IndicatorOption = {
  id: string;
  code: string;
  name: string;
  unit: string;
  definition: string;
  mappedSourceIds: string[];
};

type AnalysisResult = {
  displayTranslations?: Record<string, string>;
  pipelineVersion?: number;
  runId?: string;
  presentation?: AnalysisPresentation;
  visualReport?: AnalysisVisualReport;
  query: string;
  status: 'ready' | 'partial';
  selectedSourceIds: string[];
  preferredIndicatorIds: string[];
  /** Dimensions inferred from the research question (not from page text). */
  queryDimensions: {
    entities: string[];
    periods: string[];
    preferredIndicatorCodes: string[];
  };
  sources: SourceSummary[];
  availableIndicators: IndicatorOption[];
  rows: AnalysisRow[];
  observations: AnalysisObservation[];
  summary: AnalysisSummaryRow[];
  llmSummary?: string;
  warnings: string[];
  /** Dev/debug: full prompts + document excerpts sent to the extraction model. */
  llmExtractionTraces?: LlmExtractionTrace[];
};

/** Builds a persisted, server-validated analysis context from selected search sources. */
@Injectable()
export class AnalysisSessionService {
  private readonly logger = new Logger(AnalysisSessionService.name);
  private readonly structuredStore = new StructuredDataStore(undefined, undefined, (message) => this.logger.warn(message));

  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: ResearchRepository,
    private readonly accessScope: KnowledgeAccessScopeService,
    private readonly chat: DeepSeekChatService,
    private readonly exaContent: ExaContentHydrationService,
    private readonly worldBank: WorldBankDataService,
    private readonly unWpp: UnWppDataService = new UnWppDataService(),
  ) {}

  async create(userId: string, dto: CreateAnalysisSessionDto) {
    const startedAt = Date.now();
    const analysisTrace = `analysis=${dto.runId ?? 'unknown'} user=${userId}`;
    const logStage = (stage: string, extra = '') => {
      this.logger.log(
        `analysis_timing ${analysisTrace} phase=${stage} elapsedMs=${Date.now() - startedAt}${extra ? ` ${extra}` : ''}`,
      );
    };
    logStage('start', `requestedSources=${dto.sourceIds?.length ?? 0}`);
    const sourceIds = uniqueIds(dto.sourceIds);
    if (sourceIds.length === 0) {
      throw new BadRequestException('请至少选择一个来源生成数据分析表。');
    }
    if (sourceIds.length > 100) {
      throw new BadRequestException('单次分析最多选择 100 个来源。');
    }

    const run = await this.prisma.researchRun.findFirst({
      where: { id: dto.runId, userId, status: ResearchRunStatus.COMPLETED },
      select: { query: true, sourceIds: true, filters: true, resultJson: true },
    });
    if (!run) throw new NotFoundException('未找到本人的已完成检索记录。');

    const runSourceIds = jsonStringArray(run.sourceIds);
    if (sourceIds.some((id) => !runSourceIds.includes(id))) {
      throw new ForbiddenException('所选来源不属于本次检索结果。');
    }

    const sources = await this.repository.getSourcesByIds(sourceIds);
    if (sources.length !== sourceIds.length) {
      throw new NotFoundException('部分已选来源已失效，请重新检索。');
    }
    await this.assertKnowledgeAccess(userId, sources);

    const existing = await this.prisma.analysisSession.findFirst({
      where: {
        userId,
        selectedSourceIds: { equals: sourceIds },
        selectedIndicatorIds: {
          equals: uniqueIds(dto.indicatorIds ?? []).sort(),
        },
        resultJson: { path: ['runId'], equals: dto.runId },
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, createdAt: true, resultJson: true },
    });
    if (existing?.resultJson && typeof existing.resultJson === 'object') {
      const result = existing.resultJson as unknown as AnalysisResult;
      if (result.pipelineVersion === 9 && result.status === 'ready')
        return {
          id: existing.id,
          createdAt: existing.createdAt.toISOString(),
          ...result,
          visualDatasets: buildVisualDatasets(result),
        };
    }

    const hydrateStartedAt = Date.now();
    const hydratedSources = await this.exaContent.ensureFullText(sources);
    logStage('ensureFullText', `stageMs=${Date.now() - hydrateStartedAt} sources=${sources.length}`);
    const prepareStartedAt = Date.now();
    const result = await this.prepare(
      run.query,
      hydratedSources,
      dto.indicatorIds,
      searchContext(run.filters, run.resultJson),
    );
    logStage('prepare', `stageMs=${Date.now() - prepareStartedAt} status=${result.status}`);
    const persistStartedAt = Date.now();
    result.runId = dto.runId;
    const session = await this.prisma.analysisSession.create({
      data: {
        userId,
        query: run.query,
        status:
          result.status === 'ready'
            ? AnalysisSessionStatus.READY
            : AnalysisSessionStatus.PARTIAL,
        selectedSourceIds: sourceIds,
        selectedIndicatorIds: uniqueIds(dto.indicatorIds ?? []).sort(),
        sourceSummary: result.sources as unknown as Prisma.InputJsonValue,
        resultJson: result as unknown as Prisma.InputJsonValue,
      },
    });
    logStage('persist', `stageMs=${Date.now() - persistStartedAt} sessionId=${session.id}`);
    logStage('complete', `totalMs=${Date.now() - startedAt} sessionId=${session.id}`);
    return {
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      ...result,
      visualDatasets: buildVisualDatasets(result),
    };
  }

  async get(userId: string, id: string) {
    const session = await this.prisma.analysisSession.findFirst({
      where: { id, userId },
      select: { id: true, createdAt: true, resultJson: true },
    });
    if (!session) throw new NotFoundException('分析会话不存在或无权访问。');
    if (!session.resultJson || typeof session.resultJson !== 'object') {
      throw new NotFoundException('分析会话结果不存在。');
    }
    const result = session.resultJson as unknown as Partial<AnalysisResult>;
    return {
      id: session.id,
      createdAt: session.createdAt.toISOString(),
      ...result,
      visualDatasets: buildVisualDatasets(result),
      observations: Array.isArray(result.observations)
        ? result.observations
        : [],
      summary: Array.isArray(result.summary) ? result.summary : [],
    };
  }

  async recent(userId: string, runIds: string[]) {
    if (!runIds.length || runIds.length > 4)
      throw new BadRequestException('仅支持最近四条检索记录。');
    const sessions = await Promise.all(
      [...new Set(runIds)].map((runId) =>
        this.prisma.analysisSession.findFirst({
          where: { userId, resultJson: { path: ['runId'], equals: runId } },
          orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
          select: { id: true },
        }),
      ),
    );
    return Promise.all(
      sessions
        .filter((item): item is { id: string } => Boolean(item))
        .map((item) => this.get(userId, item.id)),
    );
  }

  async savePresentation(
    userId: string,
    id: string,
    presentation: AnalysisPresentation,
    generateReport = false,
  ) {
    const session = await this.get(userId, id);
    const dataset = validatePresentation(session.visualDatasets, presentation);
    let visualReport: AnalysisVisualReport | undefined;
    if (generateReport || session.visualReport) {
      try {
        visualReport = buildVisualReport(
          dataset,
          presentation,
          session.warnings,
        );
      } catch (error) {
        if (generateReport || !(error instanceof BadRequestException))
          throw error;
      }
    }
    const {
      id: _id,
      createdAt: _createdAt,
      visualDatasets: _datasets,
      visualReport: _previousReport,
      ...result
    } = session;
    const next = {
      ...result,
      presentation,
      ...(visualReport ? { visualReport } : {}),
    };
    const saved = await this.prisma.analysisSession.updateMany({
      where: { id, userId },
      data: { resultJson: next as unknown as Prisma.InputJsonValue },
    });
    if (saved.count === 0)
      throw new NotFoundException('分析会话不存在或无权访问。');
    return { ...session, ...next, visualReport };
  }

  async exportXlsx(userId: string, id: string, requestedColumns?: string[]) {
    const session = await this.get(userId, id);
    const rows = Array.isArray(session.rows) ? session.rows : [];
    if (!rows.length) {
      throw new BadRequestException('当前分析会话没有可导出的结构化记录。');
    }
    const availableColumns = collectExportColumns(rows);
    const selectedColumns = uniqueIds(requestedColumns ?? []).filter((column) =>
      availableColumns.includes(column),
    );
    const columns = selectedColumns.length ? selectedColumns : availableColumns;
    if (!columns.length) {
      throw new BadRequestException('当前分析会话没有可导出的数据字段。');
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'AI Data Research Platform';
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet('分析数据', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const headers = ['数据源', ...columns];
    const headerRow = worksheet.addRow(headers);
    headerRow.font = { bold: true, color: { argb: 'FF183762' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFEDF5FF' },
    };
    headerRow.alignment = { vertical: 'middle' };
    rows.forEach((row) => {
      worksheet.addRow([
        exportCellValue(row.__source),
        ...columns.map((column) => exportCellValue(row[column])),
      ]);
    });
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: headers.length },
    };
    worksheet.columns.forEach((column, index) => {
      const header = headers[index] ?? '';
      const widest = Math.max(
        String(header).length,
        ...rows
          .slice(0, 200)
          .map(
            (row) =>
              String(
                index === 0
                  ? exportCellValue(row.__source)
                  : exportCellValue(row[columns[index - 1]]),
              ).length,
          ),
      );
      column.width = Math.min(Math.max(widest + 2, 12), 36);
    });

    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      fileName: `research-data-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  private async assertKnowledgeAccess(userId: string, sources: SourceEntity[]) {
    const accessible =
      await this.accessScope.resolveAccessibleKnowledgeIds(userId);
    for (const source of sources) {
      const knowledgeItemId = source.metadata?.knowledgeItemId;
      if (
        typeof knowledgeItemId === 'string' &&
        !accessible.has(knowledgeItemId)
      ) {
        throw new ForbiddenException(`无权使用来源「${source.title}」。`);
      }
    }
  }

  private async prepare(
    query: string,
    sources: SourceEntity[],
    requestedIndicatorIds?: string[],
    context: Record<string, string[]> = {},
  ): Promise<AnalysisResult> {
    const prepareStartedAt = Date.now();
    const logPrepareStage = (stage: string, extra = '') => {
      this.logger.log(
        `analysis_timing phase=prepare.${stage} elapsedMs=${Date.now() - prepareStartedAt}${extra ? ` ${extra}` : ''}`,
      );
    };
    const versionIds = uniqueIds(
      sources
        .flatMap((source) => [
          source.metadata?.datasetVersionId ??
            source.metadata?.structuredDatasetVersionId,
          ...structuredValues(source.structuredData).map(
            (row) => row.datasetVersionId,
          ),
        ])
        .filter((id): id is string => typeof id === 'string'),
    );
    const mappings = versionIds.length
      ? await this.prisma.indicatorFieldMapping.findMany({
          where: {
            status: CommonStatus.active,
            datasetField: {
              datasetSchema: { datasetVersionId: { in: versionIds } },
            },
            indicator: { status: CommonStatus.active, deletedAt: null },
          },
          include: {
            indicator: {
              select: {
                id: true,
                code: true,
                name: true,
                unit: true,
                definition: true,
              },
            },
            datasetField: { include: { datasetSchema: true } },
          },
          orderBy: [{ priority: 'desc' }, { confidence: 'desc' }],
        })
      : [];

    // Rank the active indicator catalog against the research question so
    // "GDP数据" prefers level series over growth %, and extraction is narrowed.
    const configuredIndicators = await this.prisma.indicator.findMany({
      where: { status: CommonStatus.active, deletedAt: null },
      select: {
        id: true,
        code: true,
        name: true,
        unit: true,
        definition: true,
        aliases: { select: { alias: true } },
      },
      orderBy: { name: 'asc' },
    });
    const rankable = configuredIndicators.map((indicator) => ({
      id: indicator.id,
      code: indicator.code,
      name: indicator.name,
      unit: indicator.unit,
      definition: indicator.definition,
      aliases: indicator.aliases.map((alias) => alias.alias),
    }));
    const queryPlan = buildResearchQueryPlanLite(query, {
      countries: context.countries,
      regions: context.regions,
      entities: context.entities,
      indicators: context.indicators,
      timeRanges: context.timeRanges,
    });
    const selection = selectIndicatorsForExtraction(query, rankable, {
      indicatorHints: context.indicators,
    });
    const explicit = rankable.filter((item) =>
      requestedIndicatorIds?.includes(item.id),
    );
    const extractionCatalog = [
      ...selection.selected,
      ...explicit.filter(
        (item) =>
          !selection.selected.some((selected) => selected.id === item.id),
      ),
    ];
    const preferredCodes = uniqueIds([
      ...selection.preferredCodes,
      ...queryPlan.preferredIndicatorCodes,
      ...explicit.map((item) => item.code),
    ]);
    const dimensionHints = inferQueryDimensionHints(query);
    const contextEntities = uniqueIds([
      ...queryPlan.entities,
      ...(context.countries ?? []),
      ...(context.regions ?? []),
      ...(context.entities ?? []),
    ]);
    if (contextEntities.length)
      dimensionHints.entities = contextEntities.map(normalizeDisplayEntity);
    const recentPeriods = periodsFromRecentYearPhrase(query) ?? explicitYearRangePeriods(query);
    if (recentPeriods) {
      dimensionHints.periods = recentPeriods;
    } else {
      const contextPeriods = sortYearStrings(
        uniqueIds([
          ...queryPlan.periods,
          ...inferQueryDimensionHints((context.timeRanges ?? []).join(' '))
            .periods,
        ]),
      );
      if (contextPeriods.length) dimensionHints.periods = contextPeriods;
    }
    const metricHint =
      queryPlan.metrics.length > 0
        ? queryPlan.metrics.join('、')
        : '（未指定）';
    dimensionHints.promptBlock = [
      `用户研究问题：${queryPlan.originalQuery}`,
      `期望实体/国家：${dimensionHints.entities.join('、') || '（未指定）'}`,
      `期望指标/主题：${metricHint}`,
      `期望年份：${dimensionHints.periods.join('、') || '（未指定）'}`,
      '只抽取原文明确支持的实体、年份及数值；实体或年份与上述期望明显不符时跳过该条，不要编造。',
    ].join('\n');
    const preferredIndicatorIds = extractionCatalog
      .filter((item) => preferredCodes.includes(item.code))
      .map((item) => item.id);
    const configuredByCode = new Map(
      configuredIndicators.map((indicator) => [indicator.code, indicator]),
    );

    const worldBankStartedAt = Date.now();
    sources = await this.worldBank.hydrateSources(
      sources,
      {
        countries: uniqueIds([
          ...inferQueryCountries(query),
          ...(context.countries ?? []),
          ...dimensionHints.entities,
        ]),
        regions: context.regions ?? [],
        entities: context.entities ?? [],
        indicators: extractionCatalog.map((indicator) => indicator.name),
        timeRanges: dimensionHints.periods,
        sources: [],
        intent: 'lookup',
        confidence: 1,
        explanation: 'Selected World Bank sources use official structured observations.',
      },
      query,
      configuredIndicators.map((indicator) => indicator.code),
    );
    logPrepareStage('worldBank', `stageMs=${Date.now() - worldBankStartedAt} sources=${sources.length}`);
    const wppStartedAt = Date.now();
    sources = await this.unWpp.hydrateSources(sources, query, dimensionHints.entities, dimensionHints.periods, extractionCatalog.map((indicator) => indicator.code));
    logPrepareStage('unWpp', `stageMs=${Date.now() - wppStartedAt} sources=${sources.length}`);
    const wppRows = sources.filter((source) => source.metadata?.analysisProvider === 'un-wpp-2024')
      .flatMap((source) => structuredValues(source.structuredData));
    const wppCodes = new Set(wppRows.map((row) => row.indicatorCode));


    // Each textual source is independent, but an unbounded Promise.all can trigger
    // provider rate limits when a search returns dozens of Exa/knowledge documents.
    // Keep a small worker pool so the request remains predictable and retryable.
    const extractSourceIndicators = async (source: SourceEntity) => {
      const content = source.textContent?.trim() ?? '';
      const structuredRows = structuredValues(source.structuredData);
      const isOfficial = source.metadata?.analysisProvider === 'world-bank-api' || source.metadata?.analysisProvider === 'un-wpp-2024';
      const remainingCatalog = isOfficial
        ? extractionCatalog.filter(
            (indicator) =>
              !structuredRows.some((row) => row.indicatorCode === indicator.code),
          )
        : isWppSource(source) && wppRows.length
          ? extractionCatalog.filter((indicator) => !wppCodes.has(indicator.code))
          : extractionCatalog;
      if (isWppSource(source) && wppRows.length && !remainingCatalog.length) {
        return { sourceId: source.id, attempted: false, items: [], failed: false, unavailable: false, officialReference: true };
      }
      if (
        (structuredRows.length && (!isOfficial || !remainingCatalog.length)) ||
        !content
      ) {
        return {
          sourceId: source.id,
          attempted: false,
          items: [],
          failed: false,
          unavailable: false,
        };
      }
      // Title-only deferred Exa rows have nothing numeric to extract.
      if (
        isTitleOnly(source.title, content) ||
        (source.origin === 'exa' &&
          isLowQualityPageText(source.title, content)) ||
        source.metadata?.extractionUnavailable === true ||
        source.metadata?.contentMode === 'unavailable'
      ) {
        return {
          sourceId: source.id,
          attempted: false,
          items: [],
          failed: false,
          titleOnly: true,
          unavailable:
            source.metadata?.extractionUnavailable === true ||
            source.metadata?.contentMode === 'unavailable',
        };
      }
      // An empty active catalog is a supported fallback: the extractor will
      // identify indicatorCode/indicatorName from the question and evidence.
      const extractionIndicators = remainingCatalog.map((indicator) => ({
        id: indicator.id,
        code: indicator.code,
        name: indicator.name,
        unit: indicator.unit,
        definition: indicator.definition,
        aliases: indicator.aliases,
      }));
      const fallbackItems = extractNominalGdpFallback(
        content,
        extractionIndicators,
        queryPlan,
      );
      if (!this.chat.isReady()) {
        return fallbackItems.length
          ? {
              sourceId: source.id,
              attempted: true,
              items: fallbackItems,
              failed: false,
              unavailable: false,
            }
          : {
              sourceId: source.id,
              attempted: false,
              items: [],
              failed: false,
              unavailable: true,
            };
      }
      const extractionKey = this.structuredStore.fingerprint({
        version: 1, sourceId: source.id, title: source.title, origin: source.origin,
        sourceUrl: source.sourceUrl, content, indicators: extractionIndicators,
        query, preferredCodes, dimensionHints: dimensionHints.promptBlock, plan: queryPlan,
        model: process.env.OPENAI_MODEL, endpoint: process.env.OPENAI_BASE_URL,
      });
      // Access to the selected source was checked before prepare(); source IDs isolate private evidence.
      const runExtraction = () => this.structuredStore.getOrLoad(
        'extractions', extractionKey, 7 * 86400_000, () =>
        this.chat.extractIndicators(
          {
            title: source.title,
            origin: source.origin,
            sourceUrl: source.sourceUrl
              ? browsableExternalUrl(source.sourceUrl)
              : undefined,
            content,
          },
          extractionIndicators,
          {
            query,
            preferredCodes,
            dimensionHints: dimensionHints.promptBlock,
            plan: queryPlan,
          },
        ),
        (result) => Array.isArray(result.items) && result.items.length > 0 && !result.trace?.error,
      );
      let extraction = await runExtraction();
      let attemptCount = 1;
      if (
        !extraction.trace?.passes &&
        (extraction.items === null ||
          extraction.trace?.error ||
          (extraction.items.length === 0 &&
            fallbackItems.length === 0 &&
            shouldRetryEmptyExtraction(
              content,
              extractionIndicators,
              preferredCodes,
            )))
      ) {
        this.logger.warn(
          `指标抽取首次未得到可用结果，自动重试：${source.title}`,
        );
        extraction = await runExtraction();
        attemptCount = 2;
      }
      const mergedItems = mergeExtractedItems(
        extraction.items ?? [],
        fallbackItems,
      );
      const trace = extraction.trace
        ? {
            ...extraction.trace,
            itemCount: mergedItems.length,
            attemptCount: extraction.trace.attemptCount ?? attemptCount,
            fallbackItemCount: fallbackItems.length,
          }
        : extraction.trace;
      return {
        sourceId: source.id,
        attempted: true,
        items: mergedItems,
        failed:
          mergedItems.length === 0 &&
          (extraction.items === null || Boolean(trace?.error)),
        unavailable: false,
        trace,
      };
    };
    const extractionResults: Array<
      Awaited<ReturnType<typeof extractSourceIndicators>>
    > = [];
    const concurrency = Math.min(6, Math.max(1, sources.length));
    let nextSourceIndex = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (nextSourceIndex < sources.length) {
        const source = sources[nextSourceIndex++];
        const sourceStartedAt = Date.now();
        try {
          const extraction = await extractSourceIndicators(source);
          extractionResults.push(extraction);
          this.logger.log(
            `analysis_timing phase=prepare.extract sourceId=${source.id} stageMs=${Date.now() - sourceStartedAt} attempted=${extraction.attempted} items=${extraction.items.length} failed=${extraction.failed}`,
          );
        } catch (error) {
          this.logger.warn(
            `Indicator extraction worker failed for ${source.title}: ${String(error)}`,
          );
          extractionResults.push({
            sourceId: source.id,
            attempted: true,
            items: [],
            failed: true,
            unavailable: false,
          });
          this.logger.warn(
            `analysis_timing phase=prepare.extract sourceId=${source.id} stageMs=${Date.now() - sourceStartedAt} failed=true error=${String(error).slice(0, 240)}`,
          );
        }
      }
    });
    await Promise.all(workers);
    logPrepareStage('extract', `sources=${sources.length} completed=${extractionResults.length}`);
    const llmExtractionTraces: LlmExtractionTrace[] = extractionResults.flatMap(
      (result) => (result.trace ? [result.trace] : []),
    );
    const extractionBySource = new Map(
      extractionResults.map((result) => [result.sourceId, result]),
    );

    const mappingByVersion = new Map<string, (typeof mappings)[number][]>();
    for (const mapping of mappings) {
      const versionId = mapping.datasetField.datasetSchema.datasetVersionId;
      const versionMappings = mappingByVersion.get(versionId) ?? [];
      versionMappings.push(mapping);
      mappingByVersion.set(versionId, versionMappings);
    }

    const inferredCodes = uniqueIds(
      sources.flatMap((source) =>
        structuredValues(source.structuredData)
          .map((row) => row.indicatorCode ?? row.indicator_code)
          .filter(
            (code): code is string | number =>
              typeof code === 'string' || typeof code === 'number',
          )
          .map(String),
      ),
    );
    const inferredLabels = uniqueIds(
      sources.flatMap((source) =>
        structuredValues(source.structuredData)
          .map(
            (row) =>
              row.indicator ??
              row.indicatorName ??
              row.metric ??
              row['指标'] ??
              row['指标名称'],
          )
          .filter(
            (label): label is string | number =>
              typeof label === 'string' || typeof label === 'number',
          )
          .map(String),
      ),
    );
    const inferredIndicators = inferredCodes.length
      ? await this.prisma.indicator.findMany({
          where: {
            code: { in: inferredCodes },
            status: CommonStatus.active,
            deletedAt: null,
          },
          select: {
            id: true,
            code: true,
            name: true,
            unit: true,
            definition: true,
            aliases: { select: { alias: true } },
          },
        })
      : [];
    const labelMatches = inferredLabels.length
      ? await this.prisma.indicator.findMany({
          where: {
            OR: [
              { name: { in: inferredLabels } },
              { aliases: { some: { alias: { in: inferredLabels } } } },
            ],
            status: CommonStatus.active,
            deletedAt: null,
          },
          select: {
            id: true,
            code: true,
            name: true,
            unit: true,
            definition: true,
            aliases: { select: { alias: true } },
          },
        })
      : [];
    const allInferredIndicators = [
      ...inferredIndicators,
      ...labelMatches.filter(
        (candidate) =>
          !inferredIndicators.some(
            (indicator) => indicator.id === candidate.id,
          ),
      ),
    ];
    const inferredByCode = new Map(
      allInferredIndicators.map((indicator) => [indicator.code, indicator]),
    );
    const inferredByLabel = new Map<
      string,
      (typeof allInferredIndicators)[number]
    >();
    allInferredIndicators.forEach((indicator) => {
      inferredByLabel.set(normalizeLabel(indicator.name), indicator);
      indicator.aliases?.forEach((alias) =>
        inferredByLabel.set(normalizeLabel(alias.alias), indicator),
      );
    });

    const rows: AnalysisRow[] = [];
    const observations: AnalysisObservation[] = [];
    const summaries: SourceSummary[] = [];
    const indicatorSources = new Map<string, Set<string>>();
    const observationCounts = new Map<string, number>();
    let truncatedSources = 0;
    for (const source of sources) {
      const values = structuredValues(source.structuredData);
      const versionId =
        source.metadata?.datasetVersionId ??
        source.metadata?.structuredDatasetVersionId;
      const sourceMappings =
        typeof versionId === 'string'
          ? (mappingByVersion.get(versionId) ?? [])
          : [];
      if (values.length) {
        const rowLimit = source.metadata?.analysisProvider === 'un-wpp-2024' ? 20_000 : 1_000;
        if (values.length > rowLimit) truncatedSources += 1;
        values.slice(0, rowLimit).forEach((value, rowIndex) => {
          const rowMappings =
            typeof value.datasetVersionId === 'string'
              ? (mappingByVersion.get(value.datasetVersionId) ?? [])
              : sourceMappings;
          const matchedMappings = rowMappings.filter((mapping) =>
            Object.prototype.hasOwnProperty.call(
              value,
              mapping.datasetField.fieldName,
            ),
          );
          const inferredIndicator =
            inferredByCode.get(
              String(value.indicatorCode ?? value.indicator_code ?? ''),
            ) ??
            inferredByLabel.get(
              normalizeLabel(
                String(
                  value.indicator ??
                    value.indicatorName ??
                    value.metric ??
                    value['指标'] ??
                    value['指标名称'] ??
                    '',
                ),
              ),
            );
          const hasInferredMapping = inferredIndicator
            ? matchedMappings.some(
                (mapping) => mapping.indicator.id === inferredIndicator.id,
              )
            : false;
          rows.push({
            ...value,
            __source: source.title,
            __sourceId: source.id,
            ...(matchedMappings.length
              ? {
                  __indicators: matchedMappings.map((mapping) => ({
                    id: mapping.indicator.id,
                    code: mapping.indicator.code,
                    name: mapping.indicator.name,
                    field: mapping.datasetField.fieldName,
                    unit: mapping.indicator.unit,
                  })),
                }
              : {}),
          });
          matchedMappings.forEach((mapping) => {
            const ids =
              indicatorSources.get(mapping.indicator.id) ?? new Set<string>();
            ids.add(source.id);
            indicatorSources.set(mapping.indicator.id, ids);
            const originalValue = value[mapping.datasetField.fieldName];
            observations.push({
              sourceId: source.id,
              source: source.title,
              indicatorId: mapping.indicator.id,
              indicatorCode: mapping.indicator.code,
              indicatorName: mapping.indicator.name,
              value: numericValue(originalValue),
              originalValue,
              originalUnit:
                sourceUnit(value) ?? mapping.datasetField.unit ?? undefined,
              unit: mapping.indicator.unit,
              ...periodAndEntity(value),
              citation: { rowIndex, field: mapping.datasetField.fieldName },
            });
            observationCounts.set(
              source.id,
              (observationCounts.get(source.id) ?? 0) + 1,
            );
          });
          if (
            inferredIndicator &&
            !hasInferredMapping &&
            Object.prototype.hasOwnProperty.call(value, 'value')
          ) {
            const ids =
              indicatorSources.get(inferredIndicator.id) ?? new Set<string>();
            ids.add(source.id);
            indicatorSources.set(inferredIndicator.id, ids);
            const originalValue = value.value;
            observations.push({
              sourceId: source.id,
              source: source.title,
              indicatorId: inferredIndicator.id,
              indicatorCode: inferredIndicator.code,
              indicatorName: inferredIndicator.name,
              value: numericValue(originalValue),
              originalValue,
              originalUnit: sourceUnit(value),
              unit: inferredIndicator.unit,
              ...periodAndEntity(value),
              citation: { rowIndex, field: 'value' },
            });
            observationCounts.set(
              source.id,
              (observationCounts.get(source.id) ?? 0) + 1,
            );
          }
        });
        const mappedNames = uniqueIds(
          sourceMappings
            .filter((mapping) =>
              values.some((value) =>
                Object.prototype.hasOwnProperty.call(
                  value,
                  mapping.datasetField.fieldName,
                ),
              ),
            )
            .map((mapping) => mapping.indicator.name),
        );
        if (
          allInferredIndicators.some((indicator) =>
            values.some(
              (value) =>
                String(value.indicatorCode ?? value.indicator_code ?? '') ===
                  indicator.code ||
                inferredByLabel.get(
                  normalizeLabel(
                    String(
                      value.indicator ??
                        value.indicatorName ??
                        value.metric ??
                        value['指标'] ??
                        value['指标名称'] ??
                        '',
                    ),
                  ),
                )?.id === indicator.id,
            ),
          )
        ) {
          allInferredIndicators.forEach((indicator) => {
            if (
              !values.some(
                (value) =>
                  String(value.indicatorCode ?? value.indicator_code ?? '') ===
                    indicator.code ||
                  inferredByLabel.get(
                    normalizeLabel(
                      String(
                        value.indicator ??
                          value.indicatorName ??
                          value.metric ??
                          value['指标'] ??
                          value['指标名称'] ??
                          '',
                      ),
                    ),
                  )?.id === indicator.id,
              )
            )
              return;
            if (!mappedNames.includes(indicator.name))
              mappedNames.push(indicator.name);
          });
        }
        summaries.push({
          id: source.id,
          title: source.title,
          origin: source.origin,
          capability: 'structured',
          rowCount: values.length,
          observationCount: observationCounts.get(source.id) ?? 0,
          indicatorNames: mappedNames,
          message:
            source.metadata?.analysisProvider === 'un-wpp-2024'
              ? `已读取联合国 WPP 2024 官方年度数据（中方案），载入 ${Math.min(values.length, rowLimit)} 条记录，关联 ${mappedNames.length} 个指标；数据文件链接、原始字段和单位保留在数据行中。`
              : source.metadata?.analysisProvider === 'world-bank-api'
              ? `已通过 World Bank 官方 API 补充 ${values.length} 条结构化记录，已关联 ${mappedNames.length} 个指标；原始 API 地址保留在数据行中。`
              : mappedNames.length
                ? `已按 ${mappedNames.length} 个指标载入 ${values.length} 条结构化记录。`
                : `已载入 ${values.length} 条结构化记录，尚未关联后台指标。`,
        });
        if (
          source.metadata?.analysisProvider !== 'world-bank-api' ||
          !extractionBySource.get(source.id)?.items.length
        )
          continue;
      }

      const isExa = source.origin === 'exa';
      const extraction = extractionBySource.get(source.id);
      const extractedItems = extraction?.items ?? [];
      const extractedNames: string[] = [];
      extractedItems.forEach((item, itemIndex) => {
        const configured = configuredByCode.get(item.indicatorCode);
        const indicator = configured ?? (configuredIndicators.length === 0
          ? {
              id: `dynamic:${item.indicatorCode}`,
              code: item.indicatorCode,
              name: item.indicatorName?.trim() || item.indicatorCode,
              unit: item.unit?.trim() || '原文单位',
              definition: '由模型根据用户问题和来源证据识别的指标',
            }
          : undefined);
        if (!indicator) return;
        if (!extractedNames.includes(indicator.name))
          extractedNames.push(indicator.name);
        const observation: AnalysisObservation = {
          sourceId: source.id,
          source: source.title,
          indicatorId: indicator.id,
          indicatorCode: indicator.code,
          indicatorName: indicator.name,
          value: numericValue(item.value),
          originalValue: item.value,
          originalUnit: item.unit,
          unit: indicator.unit,
          ...(item.period ? { period: item.period } : {}),
          ...(item.entity
            ? { entity: normalizeDisplayEntity(item.entity) }
            : {}),
          citation: { rowIndex: itemIndex, field: `llm:${indicator.code}` },
        };
        observations.push(observation);
        const ids = indicatorSources.get(indicator.id) ?? new Set<string>();
        ids.add(source.id);
        indicatorSources.set(indicator.id, ids);
        observationCounts.set(
          source.id,
          (observationCounts.get(source.id) ?? 0) + 1,
        );
        rows.push({
          indicatorCode: indicator.code,
          indicatorName: indicator.name,
          value: item.value,
          // Rows are displayed/exported to Chinese users. Keep the source
          // unit separately and consistently display the catalog's Chinese
          // canonical unit after normalization.
          unit: indicator.unit,
          ...(item.unit ? { originalUnit: item.unit } : {}),
          ...(item.period ? { period: item.period } : {}),
          ...(item.entity
            ? { entity: normalizeDisplayEntity(item.entity) }
            : {}),
          ...(item.evidence ? { evidence: item.evidence } : {}),
          __source: source.title,
          __sourceId: source.id,
        });
      });
      const extractionMessage = source.metadata?.officialDataUnavailable
        ? '联合国官方年度数据下载失败，当前仅保留文档抽取结果，请重试。'
        : extraction && 'officialReference' in extraction && extraction.officialReference
          ? '年度观测已由所选联合国来源关联的官方数据文件提供，本文保留为参考资料。'
          : !extraction?.attempted
        ? extraction?.unavailable
            ? '未配置大模型，未执行指标抽取；当前仅保留来源正文。'
            : extraction?.titleOnly
              ? '未能拉取网页正文（当前仅有标题），无法抽取数值；请重试分析或换用来源。'
              : '该文档没有可供模型抽取的正文内容。'
        : extraction?.failed
          ? '大模型指标抽取失败，已保留来源，可重试分析。'
          : extraction?.trace?.error && extractedNames.length
            ? `已提取 ${extractedItems.length} 条观测，但部分正文抽取失败，结果可能不完整；请重试分析。`
            : extractedNames.length
              ? configuredIndicators.length
                ? `已按 ${extractedNames.length} 个后台指标完成逐篇抽取，共 ${extractedItems.length} 条观测。`
                : `已由模型识别 ${extractedNames.length} 个指标并完成逐篇抽取，共 ${extractedItems.length} 条观测。`
              : extraction?.trace?.rejectedItemCount
                ? `模型返回的 ${extraction.trace.rejectedItemCount} 条候选未通过原文、数值或统计口径校验，未计入分析。`
                : '已完成逐篇指标抽取，但正文中未发现后台指标目录内的明确数值。';
      const structuredSummary = summaries.find(
        (summary) => summary.id === source.id,
      );
      if (structuredSummary) {
        structuredSummary.rowCount += extractedItems.length;
        structuredSummary.observationCount = observationCounts.get(source.id) ?? 0;
        structuredSummary.indicatorNames = uniqueIds([
          ...structuredSummary.indicatorNames,
          ...extractedNames,
        ]);
        structuredSummary.message += ` 另从网页正文提取 ${extractedItems.length} 条观测。`;
      } else {
        summaries.push({
          id: source.id,
          title: source.title,
          origin: source.origin,
          capability: extraction?.attempted ? 'extractable' : 'reference-only',
          rowCount: extractedItems.length,
          observationCount: observationCounts.get(source.id) ?? 0,
          indicatorNames: extractedNames,
          message: extractionMessage,
        });
      }
    }

    const requested = uniqueIds(requestedIndicatorIds ?? []);
    // Workspace filters are driven exclusively by the research question and
    // explicit user selection. Source extraction may fill values, but must not
    // introduce new filter dimensions or indicators.
    const indicatorIds = uniqueIds([...preferredIndicatorIds, ...requested]);
    const indicators = indicatorIds.length
      ? await this.prisma.indicator.findMany({
          where: {
            id: { in: indicatorIds },
            status: CommonStatus.active,
            deletedAt: null,
          },
          select: {
            id: true,
            code: true,
            name: true,
            unit: true,
            definition: true,
          },
        })
      : [];
    const indicatorOrder = new Map(
      indicatorIds.map((id, index) => [id, index]),
    );
    indicators.sort(
      (left, right) =>
        (indicatorOrder.get(left.id) ?? 999) -
        (indicatorOrder.get(right.id) ?? 999),
    );
    const availableIndicators = indicators.map((indicator) => ({
      ...indicator,
      mappedSourceIds: [...(indicatorSources.get(indicator.id) ?? new Set())],
    }));
    const normalizedObservations = observations.map((observation) =>
      normalizeObservation(observation),
    );
    // The detail table and exports must use the same values as charts.
    const normalizedRows = rows.map((row) => {
      if (!row.indicatorCode) return row;
      const dimensions = periodAndEntity(row);
      const observation = normalizedObservations.find(
        (item) =>
          item.sourceId === row.__sourceId &&
          item.indicatorCode === row.indicatorCode &&
          (item.period ?? '') === (dimensions.period ?? '') &&
          (item.entity ?? '') === (dimensions.entity ?? '') &&
          String(item.originalValue) === String(row.value),
      );
      return observation
        ? {
            ...row,
            value: observation.value,
            unit: observation.unit,
            ...(Object.prototype.hasOwnProperty.call(row, 'metric_value')
              ? { metric_value: observation.value }
              : {}),
            originalValue: observation.originalValue,
            originalUnit: observation.originalUnit,
            normalizationStatus: observation.normalizationStatus,
          }
        : row;
    });
    const summary = summarizeObservations(normalizedObservations);
    const summaryStartedAt = Date.now();
    const officialWppOnly = wppRows.length > 0 && extractionCatalog.every((indicator) => wppCodes.has(indicator.code));
    const llmSummary = officialWppOnly
      ? `已从联合国 WPP 2024 中方案官方年度文件读取 ${normalizedObservations.length} 条观测，覆盖 ${[...new Set(normalizedObservations.map((item) => item.entity))].join('、')}；人口总量为7月1日人口，出生人数与净迁移人数为年度人数，具体年份、单位及缺失情况见明细与提示。`
      : await this.chat.summarizeAnalysis(
      query,
      normalizedObservations.map((item) => ({
        source: item.source,
        indicatorCode: item.indicatorCode,
        indicatorName: item.indicatorName,
        value: item.normalizedValue ?? item.value,
        unit: item.unit,
        originalUnit: item.originalUnit,
        period: item.period,
        entity: item.entity,
      })),
    );
    logPrepareStage('summarize', `stageMs=${Date.now() - summaryStartedAt} observations=${normalizedObservations.length}`);
    const queryDimensions = {
      entities: dimensionHints.entities,
      periods: dimensionHints.periods,
      preferredIndicatorCodes: preferredCodes,
    };
    const warnings = summaries
      .filter(
        (source) =>
          source.capability !== 'structured' && source.observationCount === 0,
      )
      .map((source) => `「${source.title}」${source.message}`);
    // WPP annual coverage must be complete for each requested country, not just any country.
    const coverageEntities = wppRows.length ? [...new Set(dimensionHints.entities)] : [''];
    const missingTargets = extractionCatalog.flatMap((indicator) =>
      coverageEntities.flatMap((entity) => dimensionHints.periods
        .filter((period) => !normalizedObservations.some((item) =>
          item.indicatorCode === indicator.code &&
          item.period?.match(/[12]\d{3}/)?.[0] === period &&
          (!entity || item.entity === entity) && item.value != null,
        ))
        .map((period) => `${indicator.name}${entity ? ` × ${entity}` : ''} × ${period}`)),
    );
    const incompleteSources = extractionResults.filter(
      (result) => result.trace?.error,
    ).length;
    if (missingTargets.length)
      warnings.push(
        `以下指标/年份尚无可用观测，保留为空：${missingTargets.slice(0, 20).join('、')}${missingTargets.length > 20 ? `等 ${missingTargets.length} 项` : ''}。`,
      );
    if (incompleteSources)
      warnings.push(
        `${incompleteSources} 个来源存在抽取失败的正文分段，结果可能不完整。`,
      );
    const unknownUnitCount = normalizedObservations.filter(
      (item) => item.normalizationStatus === 'unknown',
    ).length;
    const conflictCount = summary.filter((item) => item.conflict).length;
    if (unknownUnitCount > 0) {
      warnings.push(
        `${unknownUnitCount} 条观测的原始单位无法自动换算，已保留原始数值并标记。`,
      );
    }
    const convertedFxCount = normalizedObservations.filter(
      (item) =>
        item.normalizationStatus === 'converted' &&
        item.originalUnit &&
        /元/.test(item.originalUnit) &&
        !/美元|usd|us\$/i.test(item.originalUnit) &&
        /美元|usd/i.test(item.unit),
    ).length;
    if (convertedFxCount > 0) {
      warnings.push(
        `已将 ${convertedFxCount} 条人民币金额按对应年份平均汇率换算为目录美元单位（如「万亿美元」；保留 originalUnit 便于核对）。`,
      );
    }
    if (conflictCount > 0) {
      warnings.push(
        `${conflictCount} 个指标/实体/期间组合存在不同来源数值冲突，未静默覆盖。`,
      );
    }
    const usableCount = normalizedObservations.filter(
      (item) => item.value != null && item.normalizationStatus !== 'unknown',
    ).length;
    if (!usableCount) {
      warnings.unshift(
        '所选来源暂未形成结构化观测值，当前仅可查看来源与生成研究报告。',
      );
    }
    if (truncatedSources) {
      warnings.push(`${truncatedSources} 个来源超过记录上限（普通来源 1,000 条，联合国年度数据 20,000 条），当前结果已截断。`);
    }
    if (wppRows.length) {
      warnings.push('联合国 WPP 2024：人口总量采用7月1日人口；1950—2023年为估计值，2024—2100年为中方案预测值；出生人数和人口总量由千人换算为人。');
      if (wppCodes.has('net_migration')) warnings.push('移民人口采用净迁移人数（迁入减迁出），不是移民存量或迁入人数；负值表示净迁出。');
    }
    if (
      queryDimensions.entities.length ||
      queryDimensions.periods.length ||
      queryDimensions.preferredIndicatorCodes.length
    ) {
      warnings.unshift(
        `已按研究问题填充筛选维度：实体 ${queryDimensions.entities.join('、') || '（未识别）'}；年份 ${queryDimensions.periods.join('、') || '（未识别）'}；指标 ${queryDimensions.preferredIndicatorCodes.join('、') || '（未识别）'}。数值仍以来源抽取为准。`,
      );
    }
    if (llmExtractionTraces.length) {
      warnings.push(
        `开发调试：已记录 ${llmExtractionTraces.length} 条大模型抽取交互（提示词/原文），可在工作台「LLM 抽取调试」查看。`,
      );
      void writeLlmExtractionTraces(query, llmExtractionTraces).catch(
        (error) => {
          this.logger.warn(
            `Failed to write LLM extraction traces: ${String(error)}`,
          );
        },
      );
    }
    const display = {
      sources: summaries, availableIndicators, rows: normalizedRows,
      observations: normalizedObservations, summary, queryDimensions,
    };
    const names = collectDisplayNames(display);
    const translationStartedAt = Date.now();
    const translations = await this.chat.translateDisplayNames(names);
    logPrepareStage('translate', `stageMs=${Date.now() - translationStartedAt} names=${names.length}`);
    if (names.some((name) => !translations[name]))
      warnings.push('部分英文名称暂未获得可靠中文译名，已保留原名。');
    logPrepareStage('complete', `totalMs=${Date.now() - prepareStartedAt} observations=${normalizedObservations.length}`);
    return {
      pipelineVersion: 9,
      query,
      status:
        usableCount && !missingTargets.length && !incompleteSources && !truncatedSources
          ? 'ready'
          : 'partial',
      selectedSourceIds: sources.map((source) => source.id),
      preferredIndicatorIds,
      ...localizeDisplayNames(display, translations),
      displayTranslations: translations,
      ...(llmSummary ? { llmSummary } : {}),
      warnings,
      ...(llmExtractionTraces.length ? { llmExtractionTraces } : {}),
    };
  }
}

function uniqueIds(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function mergeExtractedItems(
  primary: import('../../infrastructure/ai/deepseek-chat.service').ExtractedIndicatorValue[],
  fallback: import('../../infrastructure/ai/deepseek-chat.service').ExtractedIndicatorValue[],
) {
  const seen = new Set<string>();
  return [...primary, ...fallback].filter((item) => {
    const key = [
      item.indicatorCode,
      item.period ?? '',
      item.entity ?? '',
      String(item.value),
      item.unit ?? '',
    ].join('\u0001');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function shouldRetryEmptyExtraction(
  content: string,
  indicators: Array<{
    code: string;
    name: string;
    aliases?: string[];
  }>,
  preferredCodes: string[],
): boolean {
  if (
    !/\d+(?:\.\d+)?\s*(?:亿元|万亿元|亿美元|万亿美元|美元|%|％)/i.test(content)
  ) {
    return false;
  }
  const preferred = new Set(preferredCodes);
  const needles = indicators
    .filter(
      (indicator) => preferred.size === 0 || preferred.has(indicator.code),
    )
    .flatMap((indicator) => [indicator.name, ...(indicator.aliases ?? [])])
    .map((value) => value.replace(/\s+/g, '').toLowerCase())
    .filter((value) => value.length >= 2);
  const normalizedContent = content.replace(/\s+/g, '').toLowerCase();
  return needles.some((needle) => normalizedContent.includes(needle));
}

function searchContext(
  filters: unknown,
  result: unknown,
): Record<string, string[]> {
  const stored =
    result && typeof result === 'object'
      ? (result as Record<string, unknown>).plan
      : undefined;
  const plan =
    stored && typeof stored === 'object'
      ? (stored as Record<string, unknown>)
      : {};
  const selected =
    filters && typeof filters === 'object'
      ? (filters as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    ['countries', 'regions', 'entities', 'indicators', 'timeRanges'].map(
      (key) => {
        const values = (value: unknown): string[] =>
          Array.isArray(value)
            ? value.filter((item): item is string => typeof item === 'string')
            : [];
        const explicit = values(selected[key]);
        return [key, explicit.length ? explicit : values(plan[key])];
      },
    ),
  );
}

function jsonStringArray(value: Prisma.JsonValue | null) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function collectExportColumns(rows: AnalysisRow[]) {
  const columns = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row)
      .filter((column) => !column.startsWith('__'))
      .forEach((column) => columns.add(column));
  });
  return [...columns];
}

function exportCellValue(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  return JSON.stringify(value);
}

function structuredValues(value: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  return rows.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  );
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.replace(/,/g, '').replace(/%$/, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceUnit(value: Record<string, unknown>): string | undefined {
  const key = Object.keys(value).find((item) =>
    /^(unit|units|单位|计量单位)$/i.test(item),
  );
  return key && value[key] != null ? String(value[key]).trim() : undefined;
}

function normalizeObservation(
  observation: AnalysisObservation,
): AnalysisObservation {
  const normalized = normalizeObservationUnits({
    value: observation.value,
    originalUnit: observation.originalUnit,
    targetUnit: observation.unit,
    period: observation.period,
  });
  return {
    ...observation,
    ...normalized,
  };
}

function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_\-./()（）]/g, '')
    .replace(/[：:]/g, '');
}

/** Convert common English entity labels from external sources into chart labels. */
export function normalizeDisplayEntity(value: string): string {
  const normalized = value.trim().toLocaleLowerCase().replace(/[.]/g, '');
  const names: Record<string, string> = {
    china: '中国',
    "people's republic of china": '中国',
    'pr china': '中国',
    'united states': '美国',
    'united states of america': '美国',
    usa: '美国',
    us: '美国',
    japan: '日本',
    india: '印度',
    'united kingdom': '英国',
    uk: '英国',
    germany: '德国',
    france: '法国',
    canada: '加拿大',
    australia: '澳大利亚',
    'south korea': '韩国',
    'republic of korea': '韩国',
    brazil: '巴西',
    russia: '俄罗斯',
    'russian federation': '俄罗斯',
    mexico: '墨西哥',
    indonesia: '印度尼西亚',
  };
  return names[normalized] ?? value.trim();
}

function summarizeObservations(
  observations: AnalysisObservation[],
): AnalysisSummaryRow[] {
  const groups = new Map<string, AnalysisObservation[]>();
  observations.forEach((observation) => {
    const key = [
      observation.indicatorId,
      observation.entity ?? '',
      observation.period ?? '',
    ].join('|');
    groups.set(key, [...(groups.get(key) ?? []), observation]);
  });
  return [...groups.entries()].map(([key, group]) => {
    const preferred = group.filter(
      (item) => item.normalizationStatus !== 'unknown',
    );
    const pool = preferred;
    const numeric = pool
      .map((item) => item.normalizedValue ?? item.value)
      .filter(
        (value): value is number =>
          typeof value === 'number' && Number.isFinite(value),
      );
    const distinct = new Set(numeric.map((value) => value.toPrecision(12)));
    const sourceIds = [...new Set(group.map((item) => item.sourceId))];
    return {
      key,
      indicatorId: group[0].indicatorId,
      indicatorCode: group[0].indicatorCode,
      indicatorName: group[0].indicatorName,
      unit: group[0].unit,
      ...(group[0].entity ? { entity: group[0].entity } : {}),
      ...(group[0].period ? { period: group[0].period } : {}),
      value: numeric.length && distinct.size === 1 ? numeric[0] : null,
      observationCount: group.length,
      sourceCount: sourceIds.length,
      duplicateCount: Math.max(group.length - distinct.size, 0),
      conflict: distinct.size > 1,
      sourceIds,
    };
  });
}

function periodAndEntity(value: Record<string, unknown>) {
  const periodKey = Object.keys(value).find((key) =>
    /^(year|date|period|年份|年度|时间|日期)$/i.test(key),
  );
  const entityKey = Object.keys(value).find((key) =>
    /^(entity|entityName|country|countryName|region|province|city|地区|区域|省份|城市|国家|公司|主体)$/i.test(
      key,
    ),
  );
  return {
    ...(periodKey && value[periodKey] != null
      ? { period: String(value[periodKey]) }
      : {}),
    ...(entityKey && value[entityKey] != null
      ? { entity: normalizeDisplayEntity(String(value[entityKey])) }
      : {}),
  };
}
