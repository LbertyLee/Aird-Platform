import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type {
  LoginResponse,
  ResearchSearchResponse,
  ResearchSource,
} from '@agent/contracts';
import AnalysisResults from './components/AnalysisResults';
import ResearchLayout from './layouts/ResearchLayout';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Check,
  Database,
  Download,
  Eye,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { apiErrorMessage } from './api/research';
import {
  createAnalysisSession,
  exportAnalysisSession,
  getAnalysisSession,
  type AnalysisSession,
} from './api/data-analysis';
import './DataAnalysisWorkspace.css';

type AnalysisTab = 'matrix' | 'charts' | 'report';
type DataRow = Record<string, unknown> & {
  __source: string;
  __sourceId?: string;
};

// Analysis sessions may contain a saved result produced by a long-running
// extraction. Allow the read path enough time to pass through the API gateway
// and retry once instead of reporting a false timeout after 45 seconds.
const ANALYSIS_SESSION_REQUEST_TIMEOUT_MS = 120_000;

interface MatrixAnomaly {
  key: string;
  level: 'warning' | 'info';
  title: string;
  detail: string;
}

export function SearchResultsPanel({
  result,
  selectedIds,
  onSelectionChange,
  onEnterAnalysis,
  onModifyQuery,
}: {
  result: ResearchSearchResponse;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onEnterAnalysis: () => void;
  onModifyQuery: () => void;
}) {
  const [sortMode, setSortMode] = useState('score');
  const [previewSource, setPreviewSource] = useState<ResearchSource>();
  const structuredSources = result.sources.filter(
    (source) => source.storageType === 'structured',
  );
  const structuredRecords = structuredSources.reduce(
    (total, source) => total + source.recordCount,
    0,
  );
  const sortedSources = useMemo(() => {
    const sources = [...result.sources];
    if (sortMode === 'records') {
      return sources.sort((a, b) => b.recordCount - a.recordCount);
    }
    if (sortMode === 'newest') {
      return sources.sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
      );
    }
    return sources.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [result.sources, sortMode]);
  const previewRows = useMemo(
    () => (previewSource ? extractRows([previewSource]) : []),
    [previewSource],
  );
  const previewColumns = useMemo(
    () => collectColumns(previewRows),
    [previewRows],
  );

  function toggleSource(id: string) {
    onSelectionChange(
      selectedIds.includes(id)
        ? selectedIds.filter((sourceId) => sourceId !== id)
        : [...selectedIds, id],
    );
  }

  function toggleAll() {
    onSelectionChange(
      selectedIds.length === result.sources.length
        ? []
        : result.sources.map((source) => source.id),
    );
  }

  if (result.sources.length === 0) {
    return (
      <div className="search-results-empty">
        <Search size={28} />
        <h3>没有找到可用数据</h3>
        <p>请修改查询条件、上传资料，或配置 Exa Search 后重新检索。</p>
        <button
          className="secondary-button"
          type="button"
          onClick={onModifyQuery}
        >
          <SlidersHorizontal size={16} />
          修改查询
        </button>
      </div>
    );
  }

  return (
    <div className="selection-results">
      <header className="selection-header">
        <div>
          <span>搜索结果</span>
          <strong>{result.sources.length} 条匹配结果</strong>
          <small>已选择 {selectedIds.length} 条</small>
          <small>
            {structuredSources.length} 条可分析数据，{structuredRecords}{' '}
            条数据记录
          </small>
        </div>
        <div>
          <button
            className="secondary-button"
            type="button"
            onClick={onModifyQuery}
          >
            <SlidersHorizontal size={16} />
            修改查询
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={selectedIds.length === 0}
            onClick={onEnterAnalysis}
          >
            <Database size={16} />
            生成数据分析表
          </button>
        </div>
      </header>

      <div className="selection-toolbar">
        <label className="source-check all-source-check">
          <input
            type="checkbox"
            checked={selectedIds.length === result.sources.length}
            onChange={toggleAll}
          />
          <span>
            <Check size={13} />
          </span>
          全选
        </label>
        <select
          value={sortMode}
          onChange={(event) => setSortMode(event.target.value)}
        >
          <option value="score">相关度优先</option>
          <option value="records">记录数优先</option>
          <option value="newest">最新入库</option>
        </select>
      </div>

      <div className="selection-list">
        {sortedSources.map((source) => {
          const selected = selectedIds.includes(source.id);
          const score = Math.round((source.score ?? 0) * 100);
          return (
            <div
              className={selected ? 'selection-row selected' : 'selection-row'}
              key={source.id}
              role="checkbox"
              aria-checked={selected}
              tabIndex={0}
              onClick={() => toggleSource(source.id)}
              onKeyDown={(event) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  toggleSource(source.id);
                }
              }}
            >
              <label
                className="source-check"
                onClick={(event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleSource(source.id)}
                />
                <span>
                  <Check size={13} />
                </span>
              </label>
              <span className="selection-main">
                <strong>{source.title}</strong>
                <small>{source.excerpt || '已完成结构化解析'}</small>
              </span>
              <span className="selection-meta">
                <strong>
                  {source.storageType === 'structured'
                    ? '结构化数据'
                    : '知识资料'}
                </strong>
                <small>
                  {originLabel(source.origin)} ·{' '}
                  {source.storageType === 'structured'
                    ? `${source.recordCount} 条记录`
                    : source.recordCount > 0
                      ? `${source.recordCount} 个内容分片`
                      : '网页或文档资料'}
                </small>
              </span>
              <span className="quality-score">
                <span>
                  <i style={{ width: `${score}%` }} />
                </span>
                <strong>{score || '-'}</strong>
              </span>
              <span className={`availability ${source.storageType}`}>
                {source.storageType === 'structured' ? '可分析' : '参考'}
              </span>
              <button
                className="source-preview-button"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setPreviewSource(source);
                }}
              >
                <Eye size={14} />
                {source.storageType === 'structured'
                  ? '查看数据表'
                  : '查看内容'}
              </button>
            </div>
          );
        })}
      </div>
      {previewSource && (
        <div
          className="data-preview-backdrop"
          role="presentation"
          onMouseDown={() => setPreviewSource(undefined)}
        >
          <section
            className="data-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-preview-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <span>
                  {previewSource.storageType === 'structured'
                    ? '结构化数据预览'
                    : previewSource.origin === 'exa'
                      ? 'Exa 联网检索结果'
                      : '知识资料预览'}
                </span>
                <h2 id="data-preview-title">{previewSource.title}</h2>
                <p>
                  {previewSource.storageType === 'structured'
                    ? `${previewRows.length} 条数据记录`
                    : originLabel(previewSource.origin)}
                </p>
              </div>
              <button
                className="icon-button"
                type="button"
                title="关闭数据预览"
                onClick={() => setPreviewSource(undefined)}
              >
                <X size={18} />
              </button>
            </header>
            {previewSource.storageType !== 'structured' ? (
              <div className="source-content-preview">
                <p>
                  {(previewSource as ResearchSource & { content?: string })
                    .content || previewSource.excerpt}
                </p>
                {previewSource.sourceUrl && (
                  <a
                    href={previewSource.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开原始网页
                  </a>
                )}
              </div>
            ) : previewRows.length === 0 ? (
              <AnalysisEmpty
                title="该数据源没有可展示的记录"
                description="数据源已标记为结构化数据，但返回内容为空或格式不支持。"
              />
            ) : (
              <div className="analysis-table-scroll">
                <table className="analysis-table">
                  <thead>
                    <tr>
                      {previewColumns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 20).map((row, index) => (
                      <tr key={`${row.__source}-${index}`}>
                        {previewColumns.map((column) => (
                          <td key={column}>{formatCell(row[column])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default function DataAnalysisWorkspace({
  result,
  selectedIds,
  onBack,
  session,
  onLogout,
}: {
  result: ResearchSearchResponse | null;
  selectedIds: string[];
  onBack: () => void;
  session: LoginResponse | null;
  onLogout: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const analysisSessionId = searchParams.get('sessionId');
  const [analysisSession, setAnalysisSession] = useState<AnalysisSession>();
  const [analysisLoading, setAnalysisLoading] = useState(
    Boolean(analysisSessionId),
  );
  const [analysisLoadError, setAnalysisLoadError] = useState('');
  const [analysisLoadAttempt, setAnalysisLoadAttempt] = useState(0);
  const exportRequestRef = useRef<AbortController | null>(null);
  useEffect(() => {
    let cancelled = false;
    exportRequestRef.current?.abort();
    exportRequestRef.current = null;
    setExcelExporting(false);
    if (!analysisSessionId) {
      setAnalysisSession(undefined);
      setExportError('');
      setAnalysisLoading(false);
      setAnalysisLoadError('');
      return () => {
        cancelled = true;
      };
    }
    setAnalysisSession(undefined);
    setExportError('');
    setAnalysisLoading(true);
    setAnalysisLoadError('');
    let timedOut = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, ANALYSIS_SESSION_REQUEST_TIMEOUT_MS);
    void getAnalysisSession(analysisSessionId, controller.signal)
      .then((next) => {
        if (!cancelled) setAnalysisSession(next);
      })
      .catch((error) => {
        if (!cancelled) {
          setAnalysisLoadError(
            timedOut
              ? '加载分析会话耗时过长，已自动停止。请稍后重试。'
              : isRequestCancelled(error)
                ? '加载已取消，请重新加载。'
                : apiErrorMessage(error),
          );
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!cancelled) setAnalysisLoading(false);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [analysisLoadAttempt, analysisSessionId]);
  const savedSessionUnavailable = Boolean(
    analysisSessionId && !analysisSession,
  );
  const effectiveSelectedIds = useMemo(
    () =>
      analysisSession
        ? analysisSession.selectedSourceIds
        : savedSessionUnavailable
          ? []
          : selectedIds,
    [analysisSession, savedSessionUnavailable, selectedIds],
  );
  const sessionSources = useMemo<ResearchSource[]>(
    () =>
      (analysisSession?.sources ?? []).map((source) => ({
        id: source.id,
        title: source.title,
        origin: source.origin,
        storageType:
          source.capability === 'structured' ? 'structured' : 'knowledge',
        sourceUrl: null,
        mimeType: null,
        excerpt: source.message,
        recordCount: source.rowCount,
        createdAt: analysisSession?.createdAt ?? new Date(0).toISOString(),
      })),
    [analysisSession?.createdAt, analysisSession?.sources],
  );
  const selectedSources = useMemo(
    () =>
      (analysisSession
        ? sessionSources
        : savedSessionUnavailable
          ? []
          : (result?.sources ?? [])
      ).filter((source) => effectiveSelectedIds.includes(source.id)),
    [
      analysisSession,
      effectiveSelectedIds,
      result?.sources,
      savedSessionUnavailable,
      sessionSources,
    ],
  );
  const structuredSourceCount = analysisSession
    ? analysisSession.sources.filter(
        (source) => source.capability === 'structured',
      ).length
    : selectedSources.filter((source) => source.storageType === 'structured')
        .length;
  const knowledgeSourceCount =
    (analysisSession?.sources.length ?? selectedSources.length) -
    structuredSourceCount;
  const rows = useMemo<DataRow[]>(() => {
    if (analysisSession?.rows?.length) return analysisSession.rows;
    if (analysisSession?.summary?.length) {
      return analysisSession.summary.map((item) => ({
        __source:
          item.sourceCount > 1
            ? `${item.sourceCount} 个来源汇总`
            : '统一指标结果',
        __sourceId: item.sourceIds[0] ?? '',
        指标: item.indicatorName,
        实体: item.entity ?? '-',
        年份: item.period ?? '-',
        数值: item.value,
        单位: item.unit,
        来源数: item.sourceCount,
        观测数: item.observationCount,
      }));
    }
    if (analysisSession?.observations?.length) {
      return analysisSession.observations.map((item) => ({
        __source: item.source,
        __sourceId: item.sourceId,
        指标: item.indicatorName,
        实体: item.entity ?? '-',
        年份: item.period ?? '-',
        数值: item.normalizedValue ?? item.value,
        单位: item.unit,
        证据: item.citation.field,
      }));
    }
    return extractRows(selectedSources);
  }, [
    analysisSession?.observations,
    analysisSession?.rows,
    analysisSession?.summary,
    selectedSources,
  ]);
  const observationCount = analysisSession?.observations.length ?? rows.length;
  const summaryCount = analysisSession?.summary.length ?? 0;
  const columns = useMemo(() => collectColumns(rows), [rows]);
  const requestedView = searchParams.get('view');
  const initialView: AnalysisTab =
    requestedView === 'charts' || requestedView === 'report'
      ? requestedView
      : 'matrix';
  const [activeTab, setActiveTab] = useState<AnalysisTab>(initialView);
  const [tableSearch, setTableSearch] = useState('');
  const [matrixIndicator, setMatrixIndicator] = useState('');
  const [matrixSortPeriod, setMatrixSortPeriod] = useState<string>();
  const [selectedMatrixEntities, setSelectedMatrixEntities] = useState<
    string[]
  >([]);
  const [selectedMatrixPeriods, setSelectedMatrixPeriods] = useState<string[]>(
    [],
  );
  const [selectedMatrixSources, setSelectedMatrixSources] = useState<string[]>(
    [],
  );
  const [expandedMatrixEntity, setExpandedMatrixEntity] = useState<string>();
  const [activeRow, setActiveRow] = useState<DataRow>();
  const [excelExporting, setExcelExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  useEffect(() => {
    setActiveTab((current) =>
      current === initialView ? current : initialView,
    );
  }, [initialView]);

  function navigateView(view: AnalysisTab) {
    setActiveTab(view);
    const next = new URLSearchParams(searchParams);
    next.set('view', view);
    setSearchParams(next, { replace: true });
  }

  useEffect(() => {
    return () => {
      exportRequestRef.current?.abort();
    };
  }, []);

  const filterOptions = useMemo(() => {
    return {
      // The filter dimensions describe the user's research question, not
      // incidental entities, periods, or fields found in source documents.
      entities: analysisSession?.queryDimensions?.entities?.length
        ? analysisSession.queryDimensions.entities
        : [...new Set((analysisSession?.observations ?? []).map((item) => item.entity || item.source))],
    };
  }, [analysisSession?.queryDimensions?.entities, analysisSession?.observations]);
  const matrixIndicators = useMemo(() => {
    const preferredCodes = new Set(
      analysisSession?.queryDimensions?.preferredIndicatorCodes ?? [],
    );
    const preferredIds = new Set(analysisSession?.preferredIndicatorIds ?? []);
    return (analysisSession?.availableIndicators ?? [])
      .filter(
        (item) => preferredCodes.has(item.code) || preferredIds.has(item.id),
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        unit: item.unit,
      }));
  }, [
    analysisSession?.availableIndicators,
    analysisSession?.preferredIndicatorIds,
    analysisSession?.queryDimensions?.preferredIndicatorCodes,
  ]);
  const activeMatrixIndicator =
    matrixIndicators.find((item) => item.id === matrixIndicator) ??
    matrixIndicators[0];
  const matrixPeriods = useMemo(() => {
    const periods = analysisSession?.queryDimensions?.periods;
    return [...(periods?.length ? periods : [...new Set((analysisSession?.observations ?? []).flatMap((item) => item.period ? [item.period] : []))])].sort(
      (a, b) => a.localeCompare(b, undefined, { numeric: true }),
    );
  }, [analysisSession?.queryDimensions?.periods, analysisSession?.observations]);
  const matrixAnomalies = useMemo(
    () =>
      detectMatrixAnomalies(
        analysisSession,
        activeMatrixIndicator?.id,
        activeMatrixIndicator?.name,
        matrixPeriods,
      ),
    [
      activeMatrixIndicator?.id,
      activeMatrixIndicator?.name,
      analysisSession,
      matrixPeriods,
    ],
  );
  const matrixRows = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    const normRank = (status?: string) => {
      if (status === 'converted' || status === 'same') return 2;
      if (status === 'unknown') return 0;
      return 1;
    };
    for (const item of analysisSession?.observations ?? []) {
      if (
        activeMatrixIndicator &&
        item.indicatorId !== activeMatrixIndicator.id &&
        item.indicatorName !== activeMatrixIndicator.name
      )
        continue;
      if (
        selectedMatrixSources.length > 0 &&
        !selectedMatrixSources.includes(item.source)
      )
        continue;
      if (item.normalizationStatus === 'unknown') continue;
      const entity = item.entity || item.source || '未标注实体';
      const row = map.get(entity) ?? { entity };
      if (item.period) {
        const nextValue = item.normalizedValue ?? item.value;
        const ranks =
          (row.__normRanks as Record<string, number> | undefined) ?? {};
        const previousRank = ranks[item.period] ?? -1;
        const nextRank = normRank(item.normalizationStatus);
        // Prefer successfully normalized values over raw "unknown" unit rows
        // (e.g. traditional 億元 that failed before alias mapping).
        if (nextValue != null && nextRank >= previousRank) {
          const conflicts = (row.__conflicts as Record<string, boolean> | undefined) ?? {};
          const previous = row[item.period];
          if (nextRank > previousRank) conflicts[item.period] = false;
          else if (typeof previous === 'number' && Math.abs(previous - nextValue) / Math.max(Math.abs(previous), Math.abs(nextValue), 1e-9) > 0.02) {
            conflicts[item.period] = true;
          }
          row[item.period] = conflicts[item.period] ? null : nextValue;
          row.__conflicts = conflicts;
          ranks[item.period] = nextRank;
          row.__normRanks = ranks;
        }
      }
      const sources = new Set<string>(
        Array.isArray(row.__sources) ? row.__sources.map(String) : [],
      );
      sources.add(item.source);
      row.__sources = [...sources];
      row.__source = [...sources].join('、');
      row.__unit = item.unit;
      row.__citation = item.citation.field;
      map.set(entity, row);
    }
    if (map.size === 0) {
      for (const row of rows) {
        const indicator = String(
          row['指标'] ?? row.indicatorName ?? row.indicator ?? '',
        );
        if (
          activeMatrixIndicator &&
          indicator !== activeMatrixIndicator.name &&
          indicator !== activeMatrixIndicator.id
        )
          continue;
        if (
          selectedMatrixSources.length > 0 &&
          !selectedMatrixSources.includes(row.__source)
        )
          continue;
        const entity = String(
          row['实体'] ?? row['entity'] ?? row.__source ?? '未标注实体',
        );
        const period = String(
          row['年份'] ?? row['period'] ?? row['year'] ?? '',
        );
        const next = map.get(entity) ?? { entity };
        if (period) {
          next[period] =
            row['数值'] ?? row.value ?? row['value'] ?? next[period];
        }
        next.__source = row.__source;
        map.set(entity, next);
      }
    }
    // Seed empty skeleton from the research question so filters/table show
    // 中国 × 近5年 even before any observation is extracted.
    if (map.size === 0) {
      for (const entity of analysisSession?.queryDimensions?.entities ?? []) {
        const row: Record<string, unknown> = { entity, __fromQuery: true };
        for (const period of matrixPeriods) row[period] = null;
        map.set(entity, row);
      }
    } else {
      for (const entity of analysisSession?.queryDimensions?.entities ?? []) {
        if (map.has(entity)) continue;
        const row: Record<string, unknown> = { entity, __fromQuery: true };
        for (const period of matrixPeriods) row[period] = null;
        map.set(entity, row);
      }
    }
    let list = [...map.values()];
    if (selectedMatrixEntities.length > 0) {
      list = list.filter((row) =>
        selectedMatrixEntities.includes(String(row.entity)),
      );
    }
    if (tableSearch.trim()) {
      const needle = tableSearch.trim().toLowerCase();
      list = list.filter((row) =>
        String(row.entity ?? '')
          .toLowerCase()
          .includes(needle),
      );
    }
    if (matrixSortPeriod) {
      list.sort((left, right) => {
        const a = Number(left[matrixSortPeriod] ?? Number.NEGATIVE_INFINITY);
        const b = Number(right[matrixSortPeriod] ?? Number.NEGATIVE_INFINITY);
        return b - a;
      });
    } else {
      list.sort((left, right) =>
        String(left.entity).localeCompare(String(right.entity), 'zh-CN'),
      );
    }
    return list;
  }, [
    activeMatrixIndicator,
    analysisSession?.observations,
    analysisSession?.queryDimensions?.entities,
    matrixPeriods,
    matrixSortPeriod,
    rows,
    selectedMatrixEntities,
    selectedMatrixSources,
    tableSearch,
  ]);
  useEffect(() => {
    if (matrixIndicators.length === 0) return;
    setMatrixIndicator((current) => {
      if (matrixIndicators.some((item) => item.id === current)) return current;
      const preferred = analysisSession?.preferredIndicatorIds ?? [];
      const preferredHit = preferred
        .map((id) => matrixIndicators.find((item) => item.id === id))
        .find(Boolean);
      return preferredHit?.id ?? matrixIndicators[0].id;
    });
  }, [analysisSession?.preferredIndicatorIds, matrixIndicators]);
  const matrixEntityOptionsSignature = filterOptions.entities.join('\u0001');
  const matrixPeriodOptionsSignature = matrixPeriods.join('\u0001');
  const matrixSourceOptionsSignature = selectedSources
    .map((source) => `${source.id}:${source.title}`)
    .join('\u0001');
  useEffect(() => {
    setSelectedMatrixEntities((current) => {
      const next = current.filter((item) =>
        filterOptions.entities.includes(item),
      );
      return next.length === current.length &&
        next.every((item, index) => item === current[index])
        ? current
        : next;
    });
    setSelectedMatrixPeriods((current) => {
      const next = current.filter((item) => matrixPeriods.includes(item));
      return next.length === current.length &&
        next.every((item, index) => item === current[index])
        ? current
        : next;
    });
    setSelectedMatrixSources((current) => {
      const next = current.filter((item) =>
        selectedSources.some((source) => source.title === item),
      );
      return next.length === current.length &&
        next.every((item, index) => item === current[index])
        ? current
        : next;
    });
  }, [
    filterOptions.entities,
    matrixPeriods,
    selectedSources,
    matrixEntityOptionsSignature,
    matrixPeriodOptionsSignature,
    matrixSourceOptionsSignature,
  ]);

  async function exportExcel() {
    if (!rows.length || excelExporting) return;
    exportRequestRef.current?.abort();
    const controller = new AbortController();
    exportRequestRef.current = controller;
    setExcelExporting(true);
    setExportError('');
    try {
      let sessionId = analysisSessionId ?? analysisSession?.id;
      if (!sessionId) {
        if (!result || effectiveSelectedIds.length === 0) {
          throw new Error(
            '缺少可导出的数据来源，请返回搜索结果后重新进入分析。',
          );
        }
        const created = await createAnalysisSession(
          {
            runId: result.runId,
            query: result.query,
            sourceIds: effectiveSelectedIds,
          },
          controller.signal,
        );
        if (exportRequestRef.current !== controller) return;
        setAnalysisSession(created);
        sessionId = created.id;
      }
      const blob = await exportAnalysisSession(
        sessionId,
        columns,
        controller.signal,
      );
      if (exportRequestRef.current !== controller) return;
      downloadBlob(
        blob,
        `research-data-${new Date().toISOString().slice(0, 10)}.xlsx`,
      );
    } catch (error) {
      if (
        exportRequestRef.current !== controller ||
        isRequestCancelled(error)
      ) {
        return;
      }
      setExportError(apiErrorMessage(error));
    } finally {
      if (exportRequestRef.current === controller) {
        exportRequestRef.current = null;
        setExcelExporting(false);
      }
    }
  }

  return (
    <ResearchLayout session={session} onLogout={onLogout}>
      <div className="analysis-app">
        <div className="analysis-workspace">
        <header className="analysis-topbar">
          <div>
            <button
              className="icon-button"
              type="button"
              title="返回搜索结果"
              onClick={onBack}
            >
              <ArrowLeft size={18} />
            </button>
            <span>AI数据智搜</span>
            <span>/</span>
            <strong>
              {activeTab === 'matrix'
                ? '数据分析工作台'
                : activeTab === 'charts'
                  ? '数据图表'
                  : '分析结果'}
            </strong>
          </div>
        </header>

        <main className="analysis-content">
          {activeTab !== 'matrix' && (
            <section className="analysis-heading">
              <div>
                <p className="eyebrow">DATA EXPLORATION</p>
                <h1>{activeTab === 'charts' ? '数据图表' : '分析结果'}</h1>
                <p>
                  {analysisSession?.query ?? (savedSessionUnavailable ? undefined : result?.query) ?? '已保存分析会话'}
                </p>
              </div>
              {!savedSessionUnavailable && <div className="analysis-stats">
                <span>
                  <strong>
                    {analysisSession?.sources.length ?? selectedSources.length}
                  </strong>{' '}
                  数据来源
                </span>
                <span>
                  <strong>{structuredSourceCount}</strong> 表格来源
                </span>
                <span>
                  <strong>{rows.length}</strong> 数据记录
                </span>
                <span>
                  <strong>{observationCount}</strong> 指标观测
                </span>
                <span>
                  <strong>{summaryCount}</strong> 汇总项
                </span>
                <span>
                  <strong>{knowledgeSourceCount}</strong> 知识资料
                </span>
              </div>}
            </section>
          )}

          {analysisLoading && (
            <div className="analysis-session-state">
              正在加载已保存的分析会话...
            </div>
          )}
          {analysisLoadError && (
            <div className="analysis-session-state error" role="alert">
              <span>{analysisLoadError}</span>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setAnalysisLoadAttempt((attempt) => attempt + 1)}
              >
                <LoaderCircle size={14} /> 重新加载
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={onBack}
              >
                <ArrowLeft size={14} /> 返回搜索结果
              </button>
            </div>
          )}
          {exportError && (
            <div className="analysis-session-state error" role="alert">
              {exportError}
            </div>
          )}
          {!savedSessionUnavailable && activeTab === 'matrix' && (
            <section className="prototype-matrix-shell">
              <aside className="prototype-matrix-filter">
                <div className="prototype-filter-title">多级筛选</div>
                <div className="prototype-filter-stats">
                  <b>{matrixRows.length}</b>
                  <span>国家/地区</span>
                  <b>{matrixPeriods.length}</b>
                  <span>时间（年份）</span>
                </div>
                <label className="prototype-search">
                  <Search size={14} />
                  <input
                    value={tableSearch}
                    onChange={(event) => setTableSearch(event.target.value)}
                    placeholder="关键词检索筛选项"
                  />
                </label>
                <SelectableFilterGroup
                  title="国家/地区"
                  items={filterOptions.entities}
                  selected={selectedMatrixEntities}
                  onChange={setSelectedMatrixEntities}
                />
                <SelectableFilterGroup
                  title="时间（年份）"
                  items={matrixPeriods}
                  selected={selectedMatrixPeriods}
                  onChange={setSelectedMatrixPeriods}
                />
                <SelectableFilterGroup
                  title="指标序列"
                  items={matrixIndicators.map((item) => item.name)}
                  selected={
                    activeMatrixIndicator ? [activeMatrixIndicator.name] : []
                  }
                  onChange={(names) => {
                    const next = matrixIndicators.find((item) =>
                      names.includes(item.name),
                    );
                    if (next) setMatrixIndicator(next.id);
                  }}
                  singleSelect
                />
                <SelectableFilterGroup
                  title="数据来源"
                  items={selectedSources.map((source) => source.title)}
                  selected={selectedMatrixSources}
                  onChange={setSelectedMatrixSources}
                />
                <div className="prototype-source-note">
                  <Database size={14} />
                  <span>
                    {selectedSources.length} 个来源，
                    {analysisSession?.observations.length ?? 0}{' '}
                    条指标观测已统一汇总
                  </span>
                </div>
              </aside>
              <div className="prototype-matrix-main">
                <div className="prototype-matrix-toolbar">
                  <label>分析指标</label>
                  <select
                    value={activeMatrixIndicator?.id ?? ''}
                    onChange={(event) => setMatrixIndicator(event.target.value)}
                  >
                    {matrixIndicators.length === 0 ? (
                      <option value="">暂无指标</option>
                    ) : (
                      matrixIndicators.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                          {item.unit ? `（${item.unit}）` : ''}
                        </option>
                      ))
                    )}
                  </select>
                  <span className="prototype-info">i</span>
                  <span className="prototype-matrix-meta">
                    {matrixPeriods[0] ?? '-'} -{' '}
                    {matrixPeriods[matrixPeriods.length - 1] ?? '-'} ·{' '}
                    {matrixRows.length} 个国家/地区
                  </span>
                </div>
                <div
                  className={`prototype-anomaly-panel ${matrixAnomalies.some((item) => item.level === 'warning') ? 'has-warning' : 'is-clear'}`}
                  role="status"
                >
                  <div className="prototype-anomaly-heading">
                    <AlertTriangle size={15} />
                    <strong>异常提示</strong>
                    <span>
                      {matrixAnomalies.some((item) => item.level === 'warning')
                        ? '发现需要复核的情况'
                        : '当前数据未发现明显异常'}
                    </span>
                  </div>
                  <div className="prototype-anomaly-list">
                    {matrixAnomalies.map((item) => (
                      <div
                        className={`prototype-anomaly-item ${item.level}`}
                        key={item.key}
                      >
                        <b>{item.title}</b>
                        <span>{item.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="prototype-matrix-table-wrap">
                  {matrixRows.length === 0 ? (
                    <AnalysisEmpty
                      title="暂无可聚合的指标观测"
                      description="请返回搜索结果选择知识库或 Exa 来源，并等待指标提取完成。"
                    />
                  ) : (
                    <>
                      {matrixRows.every((row) =>
                        matrixPeriods.every((period) => row[period] == null),
                      ) ? (
                        <div className="prototype-matrix-skeleton-note">
                          已按研究问题填充「
                          {(analysisSession?.queryDimensions?.entities ?? []).join(
                            '、',
                          ) || '实体'}
                          ×
                          {(analysisSession?.queryDimensions?.periods ?? []).join(
                            '、',
                          ) || '年份'}
                          」维度骨架；数值待来源抽取完成后填入。
                        </div>
                      ) : null}
                    <table className="prototype-matrix-table">
                      <thead>
                        <tr>
                          <th>国家/地区</th>
                          {matrixPeriods
                            .filter(
                              (period) =>
                                selectedMatrixPeriods.length === 0 ||
                                selectedMatrixPeriods.includes(period),
                            )
                            .map((period) => (
                              <th
                                key={period}
                                onClick={() =>
                                  setMatrixSortPeriod((current) =>
                                    current === period ? undefined : period,
                                  )
                                }
                              >
                                {period}{' '}
                                {matrixSortPeriod === period ? '↓' : '↕'}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrixRows
                          .filter(
                            (row) =>
                              !tableSearch.trim() ||
                              String(row.entity)
                                .toLowerCase()
                                .includes(tableSearch.trim().toLowerCase()),
                          )
                          .flatMap((row) => {
                            const entity = String(row.entity);
                            const periods = matrixPeriods.filter(
                              (period) =>
                                selectedMatrixPeriods.length === 0 ||
                                selectedMatrixPeriods.includes(period),
                            );
                            const cells = periods.map((period) => {
                              const value = row[period];
                              return (
                                <td
                                  key={period}
                                  className={
                                    value == null
                                      ? 'na'
                                      : period === matrixSortPeriod
                                        ? 'selected-period'
                                        : undefined
                                  }
                                >
                                  {value == null ? '..' : formatCell(value)}
                                </td>
                              );
                            });
                            const main = (
                              <tr
                                key={entity}
                                onClick={() =>
                                  setExpandedMatrixEntity((current) =>
                                    current === entity ? undefined : entity,
                                  )
                                }
                                tabIndex={0}
                                onKeyDown={(event) => {
                                  if (
                                    event.key === 'Enter' ||
                                    event.key === ' '
                                  ) {
                                    event.preventDefault();
                                    setExpandedMatrixEntity((current) =>
                                      current === entity ? undefined : entity,
                                    );
                                  }
                                }}
                              >
                                <td className="sticky-col">
                                  <span className="matrix-entity">
                                    {expandedMatrixEntity === entity
                                      ? '▾'
                                      : '▸'}{' '}
                                    {entity}
                                  </span>
                                </td>
                                {cells}
                              </tr>
                            );
                            if (expandedMatrixEntity !== entity) return [main];
                            return [
                              main,
                              <tr
                                className="prototype-matrix-detail"
                                key={`${entity}-detail`}
                              >
                                <td className="sticky-col">数据口径</td>
                                <td colSpan={Math.max(1, periods.length)}>
                                  <div className="prototype-matrix-detail-body">
                                    <span>
                                      来源：
                                      {String(row.__source || '当前分析会话')}
                                    </span>
                                    <span>
                                      单位：
                                      {String(
                                        row.__unit ||
                                          activeMatrixIndicator?.unit ||
                                          '按指标统一口径',
                                      )}
                                    </span>
                                    <span>
                                      引用字段：
                                      {String(
                                        row.__citation || '指标提取结果',
                                      )}
                                    </span>
                                  </div>
                                </td>
                              </tr>,
                            ];
                          })}
                      </tbody>
                    </table>
                    </>
                  )}
                </div>
                <div className="prototype-matrix-source">
                  <b>数据来源：</b>
                  {selectedSources.map((source) => source.title).join('、') ||
                    '当前分析会话'}
                  <span>
                    {' '}
                    · 单位：{activeMatrixIndicator?.unit || '按指标统一口径'} ·
                    数据引用规范
                  </span>
                </div>
                <div className="prototype-matrix-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      downloadCsv(matrixRows as DataRow[], [
                        'entity',
                        ...matrixPeriods,
                      ])
                    }
                  >
                    <Download size={15} /> 下载
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      downloadCsv(matrixRows as DataRow[], [
                        'entity',
                        ...matrixPeriods,
                      ])
                    }
                  >
                    CSV
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!rows.length || excelExporting}
                    onClick={() => void exportExcel()}
                  >
                    {excelExporting ? '生成 Excel…' : 'EXCEL'}
                  </button>
                  <span className="action-spacer" />
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => navigateView('charts')}
                  >
                    <BarChart3 size={15} /> {analysisSession ? '查看数据图表' : '生成数据图表'}
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => {
                      navigateView('report');
                    }}
                  >
                    <Sparkles size={15} /> {analysisSession?.visualReport ? '查看分析结果' : '生成分析结果'}
                  </button>
                </div>
              </div>
            </section>
          )}

          {!savedSessionUnavailable && (activeTab === 'charts' || activeTab === 'report') && (
            <AnalysisResults
              session={analysisSession}
              result={savedSessionUnavailable ? null : result}
              sources={selectedSources}
              mode={activeTab}
              // The prototype keeps report generation as the final explicit
              // user action after extraction, cleaning, validation and chart
              // preparation have completed.
              autoGenerateReport={false}
              onSession={(next, view) => {
                setAnalysisSession(next);
                const params = new URLSearchParams(searchParams);
                params.set('sessionId', next.id);
                params.set('view', view);
                setActiveTab(view);
                setSearchParams(params, { replace: true });
              }}
              onNavigate={navigateView}
            />
          )}
          {activeRow && (
            <div
              className="data-preview-backdrop"
              role="presentation"
              onMouseDown={() => setActiveRow(undefined)}
            >
              <section
                className="data-record-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="data-record-title"
                onMouseDown={(event) => event.stopPropagation()}
              >
                <header>
                  <div>
                    <span>数据记录详情</span>
                    <h2 id="data-record-title">{activeRow.__source}</h2>
                    <p>完整字段内容</p>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    title="关闭记录详情"
                    onClick={() => setActiveRow(undefined)}
                  >
                    <X size={18} />
                  </button>
                </header>
                <dl className="data-record-fields">
                  {Object.entries(activeRow)
                    .filter(([field]) => !field.startsWith('__'))
                    .map(([field, value]) => (
                      <div key={field}>
                        <dt>{field}</dt>
                        <dd>{formatCell(value)}</dd>
                      </div>
                    ))}
                </dl>
                {selectedSources.find(
                  (source) => source.title === activeRow.__source,
                )?.sourceUrl && (
                  <a
                    className="record-source-link"
                    href={
                      selectedSources.find(
                        (source) => source.title === activeRow.__source,
                      )?.sourceUrl ?? undefined
                    }
                    rel="noreferrer"
                    target="_blank"
                  >
                    打开官方数据来源
                  </a>
                )}
              </section>
            </div>
          )}
        </main>
        </div>
      </div>
    </ResearchLayout>
  );
}

function AnalysisEmpty({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="analysis-empty">
      <Database size={24} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function extractRows(sources: ResearchSource[]): DataRow[] {
  return sources.flatMap((source) => {
    if (source.storageType !== 'structured' || source.structuredData == null)
      return [];
    const values = Array.isArray(source.structuredData)
      ? source.structuredData
      : [source.structuredData];
    return values
      .filter(isRecord)
      .map((value) => ({ ...value, __source: source.title }));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function collectColumns(rows: DataRow[]) {
  const columns = new Set<string>();
  rows.slice(0, 200).forEach((row) =>
    Object.keys(row)
      .filter((key) => !key.startsWith('__'))
      .forEach((key) => columns.add(key)),
  );
  return [...columns].slice(0, 16);
}

function detectMatrixAnomalies(
  session: AnalysisSession | undefined,
  indicatorId: string | undefined,
  indicatorName: string | undefined,
  periods: string[],
): MatrixAnomaly[] {
  const observations = (session?.observations ?? []).filter(
    (item) =>
      !indicatorId ||
      item.indicatorId === indicatorId ||
      item.indicatorName === indicatorName,
  );
  const notices: MatrixAnomaly[] = (session?.warnings ?? [])
    .filter((warning) => !warning.startsWith('开发调试：'))
    .slice(0, 3)
    .map((warning, index) => ({
      key: `session-warning-${index}`,
      level: 'warning',
      title: '提取过程提示',
      detail: warning,
    }));
  const values = observations
    .map((item) => item.normalizedValue ?? item.value)
    .filter(
      (value): value is number =>
        typeof value === 'number' && Number.isFinite(value),
    );

  const conflicts = (session?.summary ?? []).filter(
    (item) =>
      item.conflict &&
      (!indicatorId ||
        item.indicatorId === indicatorId ||
        item.indicatorName === indicatorName),
  );
  if (conflicts.length > 0) {
    notices.push({
      key: 'conflict',
      level: 'warning',
      title: '来源口径冲突',
      detail: `${conflicts.length} 个实体/年份存在多个来源数值不一致，已按统一口径汇总，请展开行复核来源。`,
    });
  }

  if (values.length >= 4) {
    const average =
      values.reduce((sum, value) => sum + value, 0) / values.length;
    const deviation = Math.sqrt(
      values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
        values.length,
    );
    const outlierCount =
      deviation > 0
        ? values.filter((value) => Math.abs(value - average) > deviation * 2.5)
            .length
        : 0;
    if (outlierCount > 0) {
      notices.push({
        key: 'outlier',
        level: 'warning',
        title: '数值离群',
        detail: `检测到 ${outlierCount} 个数值明显偏离当前指标的整体分布，建议结合原始文档和引用字段核验。`,
      });
    }
  }

  const byEntity = new Map<string, Array<{ period: string; value: number }>>();
  observations.forEach((item) => {
    const value = item.normalizedValue ?? item.value;
    if (!item.period || typeof value !== 'number' || !Number.isFinite(value))
      return;
    const entity = item.entity || item.source || '未标注实体';
    byEntity.set(entity, [
      ...(byEntity.get(entity) ?? []),
      { period: item.period, value },
    ]);
  });
  let volatileEntities = 0;
  byEntity.forEach((items) => {
    const ordered = [...items].sort((a, b) =>
      a.period.localeCompare(b.period, undefined, { numeric: true }),
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1].value;
      const current = ordered[index].value;
      if (previous !== 0 && Math.abs((current - previous) / previous) >= 1) {
        volatileEntities += 1;
        break;
      }
    }
  });
  if (volatileEntities > 0) {
    notices.push({
      key: 'volatility',
      level: 'warning',
      title: '年度波动较大',
      detail: `${volatileEntities} 个国家/地区出现相邻年份绝对变化达到 100% 以上的情况，可能与统计口径、单位或极端事件有关。`,
    });
  }

  if (periods.length >= 3 && observations.length > 0) {
    const entityCount = new Set(
      observations.map((item) => item.entity || item.source || '未标注实体'),
    ).size;
    const expected = entityCount * periods.length;
    const valid = observations.filter(
      (item) => item.period && (item.normalizedValue ?? item.value) != null,
    ).length;
    const missing = Math.max(0, expected - valid);
    if (expected > 0 && missing / expected >= 0.3) {
      notices.push({
        key: 'missing',
        level: 'warning',
        title: '数据缺失较多',
        detail: `矩阵约有 ${Math.round((missing / expected) * 100)}% 的实体-年份没有有效值，缺失值以“..”显示且未参与计算。`,
      });
    }
  }

  return notices.length > 0
    ? notices
    : [
        {
          key: 'clear',
          level: 'info',
          title: '数据质量检查通过',
          detail:
            '未发现明显离群值、异常波动、来源冲突或大面积缺失；仍建议结合原始来源进行最终复核。',
        },
      ];
}

function SelectableFilterGroup({
  title,
  items,
  selected,
  onChange,
  singleSelect = false,
}: {
  title: string;
  items: string[];
  selected: string[];
  onChange: (items: string[]) => void;
  singleSelect?: boolean;
}) {
  function toggle(item: string) {
    if (singleSelect) {
      onChange([item]);
      return;
    }
    if (selected.length === 0) {
      onChange(items.filter((value) => value !== item));
      return;
    }
    onChange(
      selected.includes(item)
        ? selected.filter((value) => value !== item)
        : [...selected, item],
    );
  }

  return (
    <details className="prototype-filter-group" open={items.length > 0}>
      <summary>
        <span>{title}</span>
        <small>
          {selected.length || items.length}/{items.length}
        </small>
      </summary>
      <div>
        {items.length === 0 ? (
          <em>暂无数据</em>
        ) : (
          items.map((item) => (
            <label
              key={item}
              className={
                (
                  singleSelect
                    ? selected.includes(item)
                    : selected.length === 0 || selected.includes(item)
                )
                  ? 'selected'
                  : ''
              }
            >
              <input
                type={singleSelect ? 'radio' : 'checkbox'}
                checked={
                  singleSelect
                    ? selected.includes(item)
                    : selected.length === 0 || selected.includes(item)
                }
                onChange={() => toggle(item)}
              />
              <span>{item}</span>
            </label>
          ))
        )}
      </div>
    </details>
  );
}

function formatCell(value: unknown) {
  if (value == null || value === '') return '-';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function downloadCsv(rows: DataRow[], columns: string[]) {
  const headers = ['数据源', ...columns];
  const lines = [
    headers,
    ...rows.map((row) => [
      row.__source,
      ...columns.map((column) => formatCell(row[column])),
    ]),
  ].map((line) =>
    line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','),
  );
  const blob = new Blob([`\ufeff${lines.join('\n')}`], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'research-data.csv';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function isRequestCancelled(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; name?: unknown };
  return (
    candidate.code === 'ERR_CANCELED' || candidate.name === 'CanceledError'
  );
}

function originLabel(origin: ResearchSource['origin']) {
  return origin === 'upload'
    ? '用户上传'
    : origin === 'exa'
      ? 'Exa Search'
      : '本地数据';
}
