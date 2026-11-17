import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Download,
  FileText,
  LoaderCircle,
  Save,
} from 'lucide-react';
import type {
  AnalysisPresentation,
  AnalysisVisualDataset,
  AnalysisVisualView,
  ResearchSearchResponse,
  ResearchSource,
} from '@agent/contracts';
import {
  createAnalysisSession,
  saveAnalysisPresentation,
  type AnalysisSession,
} from '../api/data-analysis';
import { apiErrorMessage } from '../api/research';
import AnalysisVisual, { VisualViewTabs } from './AnalysisVisual';
import {
  datasetsFromSources,
  defaultPresentation,
  downloadVisualBlob,
  formatVisualValue,
  selectVisualData,
  visualPalette,
  visualViews,
} from '../utils/analysis-visualization';
import {
  analysisReportDocxFilename,
  buildAnalysisReportDocx,
  collectReportFigureImages,
  reportFigureRequests,
} from '../utils/analysis-report-docx';

export default function AnalysisResults({
  session,
  result,
  sources,
  mode,
  onSession,
  onNavigate,
  autoGenerateReport = true,
}: {
  session?: AnalysisSession;
  result: ResearchSearchResponse | null;
  sources: ResearchSource[];
  mode: 'charts' | 'report';
  onSession: (session: AnalysisSession, view: 'charts' | 'report') => void;
  onNavigate: (view: 'matrix' | 'charts' | 'report') => void;
  autoGenerateReport?: boolean;
}) {
  const datasets = useMemo(
    () => session?.visualDatasets ?? datasetsFromSources(sources),
    [session?.visualDatasets, sources],
  );
  const [selection, setSelection] = useState<AnalysisPresentation | undefined>(
    session?.presentation,
  );
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController>();
  const autoReportAttempt = useRef('');
  const reportElement = useRef<HTMLDivElement>(null);
  const dataset =
    datasets.find((entry) => entry.id === selection?.datasetId) ?? datasets[0];
  const presentation = useMemo(
    () =>
      dataset
        ? selection?.datasetId === dataset.id
          ? selection
          : defaultPresentation(dataset)
        : undefined,
    [dataset, selection],
  );
  useEffect(() => {
    setSelection(session?.presentation);
  }, [session?.id, session?.presentation]);
  useEffect(() => () => requestRef.current?.abort(), []);
  const report = session?.visualReport;
  const reportDataset = datasets.find(
    (entry) => entry.id === report?.presentation.datasetId,
  );
  function update(patch: Partial<AnalysisPresentation>) {
    if (presentation) {
      setSelection({ ...presentation, ...patch });
      setMessage('');
    }
  }

  const save = useCallback(
    async (generateReport: boolean) => {
      if (!presentation || busy) return;
      const controller = new AbortController();
      requestRef.current = controller;
      setBusy(true);
      setError('');
      setMessage('');
      try {
        let current = session;
        let nextPresentation = presentation;
        if (!current) {
          if (!result || !sources.length)
            throw new Error('缺少搜索结果，请返回搜索页面重新选择数据来源。');
          current = await createAnalysisSession(
            {
              runId: result.runId,
              query: result.query,
              sourceIds: sources.map((source) => source.id),
            },
            controller.signal,
          );
          const nextDataset =
            current.visualDatasets?.find(
              (entry) =>
                (entry.name === dataset?.name ||
                  dataset?.name.endsWith(` · ${entry.name}`)) &&
                entry.unit === dataset?.unit,
            ) ?? current.visualDatasets?.[0];
          if (!nextDataset) throw new Error('该搜索暂无可分析的指标数据。');
          nextPresentation = {
            ...defaultPresentation(nextDataset),
            view: presentation.view,
            reportViews: presentation.reportViews,
            entities: presentation.entities.filter((entity) =>
              nextDataset.entities.includes(entity),
            ),
            ...(nextDataset.periods.includes(presentation.startPeriod) &&
            nextDataset.periods.includes(presentation.endPeriod) &&
            nextDataset.periods.includes(presentation.currentPeriod)
              ? {
                  startPeriod: presentation.startPeriod,
                  endPeriod: presentation.endPeriod,
                  currentPeriod: presentation.currentPeriod,
                }
              : {}),
          };
        }
        const next = await saveAnalysisPresentation(
          current.id,
          nextPresentation,
          generateReport,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        onSession(next, generateReport ? 'report' : mode);
        setSelection(next.presentation);
        setMessage(
          generateReport
            ? '分析结果已保存，并同步到首页最近搜索。'
            : '图表配置已保存，并同步到首页最近搜索。',
        );
      } catch (error) {
        if (!controller.signal.aborted) setError(apiErrorMessage(error));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    },
    [presentation, busy, session, result, sources, dataset, onSession, mode],
  );

  useEffect(() => {
    const key = session?.id ?? result?.runId ?? '';
    if (
      autoGenerateReport && mode === 'report' &&
      !report &&
      presentation?.entities.length &&
      !busy &&
      key &&
      autoReportAttempt.current !== key
    ) {
      const timer = window.setTimeout(() => {
        autoReportAttempt.current = key;
        void save(true);
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [autoGenerateReport, mode, report, presentation, busy, session?.id, result?.runId, save]);

  async function downloadReport() {
    if (!report || !reportDataset || downloadingReport) return;
    setDownloadingReport(true);
    setError('');
    try {
      const figures = await collectReportFigureImages({
        reportRoot: reportElement.current,
        dataset: reportDataset,
        presentation: report.presentation,
        figures: reportFigureRequests(report.presentation),
      });
      const blob = await buildAnalysisReportDocx(report, figures);
      downloadVisualBlob(blob, analysisReportDocxFilename(report.title));
    } finally {
      setDownloadingReport(false);
    }
  }

  const toolbar = (
    <header className="visual-workspace-toolbar">
      <button
        type="button"
        className="secondary-button"
        onClick={() => onNavigate('matrix')}
      >
        <ArrowLeft size={14} />
        返回工作台
      </button>
      {mode === 'charts' && presentation && (
        <VisualViewTabs
          value={presentation.view}
          onChange={(view) => update({ view })}
        />
      )}
      <div className="visual-workspace-actions">
        {mode === 'report' && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => onNavigate('charts')}
          >
            调整图表
          </button>
        )}
        {mode === 'report' && report && (
          <button
            type="button"
            className="secondary-button"
            disabled={downloadingReport}
            onClick={() => {
              void downloadReport().catch((error) =>
                setError(apiErrorMessage(error)),
              );
            }}
          >
            {downloadingReport ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <Download size={14} />
            )}
            {downloadingReport ? '正在生成…' : '下载报告'}
          </button>
        )}
        {mode === 'charts' && (
          <button
            type="button"
            className="secondary-button"
            disabled={busy || !presentation}
            onClick={() => void save(false)}
          >
            <Save size={14} />
            保存图表
          </button>
        )}
        <button
          type="button"
          className="primary-button"
          disabled={busy || !presentation?.entities.length}
          onClick={() => void save(true)}
        >
          {busy ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <FileText size={14} />
          )}
          {busy ? '正在保存…' : report ? '更新分析结果' : '生成分析结果'}
        </button>
      </div>
    </header>
  );
  if (!dataset || !presentation)
    return (
      <section className="visual-workspace">
        {toolbar}
        <div className="visual-empty">暂无可视化指标数据</div>
        {error && (
          <div className="visual-message error" role="alert">
            {error}
          </div>
        )}
      </section>
    );
  const selected = selectVisualData(dataset, presentation);
  const ranking = dataset.entities
    .map((entity) => ({
      entity,
      value:
        dataset.points.find(
          (point) =>
            point.entity === entity &&
            point.period === presentation.currentPeriod,
        )?.value ?? null,
    }))
    .sort(
      (a, b) =>
        (b.value ?? -Infinity) - (a.value ?? -Infinity) ||
        a.entity.localeCompare(b.entity, 'zh-CN'),
    );
  const selectedRanking = ranking.filter(
    (row) => presentation.entities.includes(row.entity) && row.value !== null,
  );
  return (
    <section className="visual-workspace">
      {toolbar}
      {error && (
        <div className="visual-message error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="visual-message" role="status">
          {message}
        </div>
      )}
      {mode === 'charts' ? (
        <div className="visual-workspace-body">
          <div className="visual-workspace-main">
            <h2>
              {dataset.name}
              {dataset.unit && `（${dataset.unit}）`}
            </h2>
            {dataset.definition && (
              <p className="visual-definition">{dataset.definition}</p>
            )}
            <AnalysisVisual
              dataset={dataset}
              presentation={presentation}
              exports
            />
            <div className="visual-source">
              数据来源：
              {dataset.sources.map((source) => source.title).join('、')} ·
              单位：{dataset.unit || '未标注'} · 缺失及冲突值不参与排名与统计。
            </div>
            <TimeControls
              dataset={dataset}
              presentation={presentation}
              onChange={update}
            />
            <p className="visual-insight">
              <strong>数据洞察：</strong>
              {selectedRanking[0]
                ? `${presentation.currentPeriod} 年，${selectedRanking[0].entity} 在当前样本中数值最高，为 ${formatVisualValue(selectedRanking[0].value)} ${dataset.unit}。`
                : '当前年份暂无有效数据。'}
              当前时间窗口包含 {selected.periods.length} 个时期、
              {presentation.entities.length} 个国家/地区。
            </p>
          </div>
          <aside className="visual-sidebar">
            <h3>
              添加 / 删除国家和地区
              <span>
                {presentation.entities.length} / {dataset.entities.length}
              </span>
            </h3>
            <input
              type="search"
              aria-label="搜索国家或地区"
              placeholder="搜索国家或地区"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              aria-label="排名年份"
              value={presentation.currentPeriod}
              onChange={(event) =>
                update({ currentPeriod: event.target.value })
              }
            >
              {selected.periods.map((period) => (
                <option key={period} value={period}>
                  {period} · {dataset.name}
                </option>
              ))}
            </select>
            <div className="visual-entity-actions">
              <button
                type="button"
                onClick={() => update({ entities: [...dataset.entities] })}
              >
                全选
              </button>
              <button type="button" onClick={() => update({ entities: [] })}>
                清除
              </button>
            </div>
            <div className="visual-entity-list">
              {ranking
                .filter((row) =>
                  row.entity.toLowerCase().includes(search.toLowerCase()),
                )
                .map((row) => (
                  <label key={row.entity}>
                    <input
                      type="checkbox"
                      checked={presentation.entities.includes(row.entity)}
                      onChange={(event) =>
                        update({
                          entities: event.target.checked
                            ? [...presentation.entities, row.entity]
                            : presentation.entities.filter(
                                (entity) => entity !== row.entity,
                              ),
                        })
                      }
                    />
                    <i
                      style={{
                        background:
                          visualPalette[
                            dataset.entities.indexOf(row.entity) %
                              visualPalette.length
                          ],
                      }}
                    />
                    <span>{row.entity}</span>
                    <b>{formatVisualValue(row.value)}</b>
                  </label>
                ))}
            </div>
            <div className="visual-indicator-list">
              <h3>指标信息</h3>
              {datasets.map((entry) => (
                <label key={entry.id}>
                  <input
                    type="radio"
                    name="visual-indicator"
                    checked={entry.id === dataset.id}
                    onChange={() => {
                      setSelection({
                        ...defaultPresentation(entry),
                        view: presentation.view,
                        reportViews: presentation.reportViews,
                      });
                      setSearch('');
                    }}
                  />
                  <span>{entry.name}</span>
                  <small>{entry.unit}</small>
                </label>
              ))}
            </div>
          </aside>
        </div>
      ) : (
        <div className="visual-report" ref={reportElement}>
          {!report || !reportDataset ? (
            <>
              <h2>分析结果</h2>
              <p className="visual-definition">
                {dataset.name} · {presentation.startPeriod} -{' '}
                {presentation.endPeriod} · {presentation.entities.length}{' '}
                个国家/地区
              </p>
              <ReportViewSelection
                value={presentation.reportViews}
                onChange={(reportViews) => update({ reportViews })}
              />
              <AnalysisVisual dataset={dataset} presentation={presentation} />
              <div className="visual-empty">
                点击“生成分析结果”保存当前数据的分析与图表。
              </div>
            </>
          ) : (
            <>
              <h2>{report.title}</h2>
              <div className="visual-report-meta">
                生成时间：{new Date(report.createdAt).toLocaleString('zh-CN')} ·
                当前年份：{report.presentation.currentPeriod}
              </div>
              {JSON.stringify(report.presentation) !==
                JSON.stringify(presentation) && (
                <p className="visual-message">
                  图表选择已变更，更新分析结果后同步到已保存报告。
                </p>
              )}
              <div className="visual-report-stats">
                {report.metrics.map((metric) => (
                  <div key={metric.label}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                  </div>
                ))}
              </div>
              {report.sections.map((section) => (
                <section className="visual-report-section" key={section.title}>
                  <h3>{section.title}</h3>
                  {section.paragraphs.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </section>
              ))}
              <section className="visual-report-section">
                <h3>数据明细</h3>
                <AnalysisVisual
                  dataset={reportDataset}
                  presentation={{ ...report.presentation, view: 'table' }}
                />
              </section>
              <section className="visual-report-section">
                <h3>可视化图表</h3>
                <ReportViewSelection
                  value={presentation.reportViews}
                  onChange={(reportViews) => update({ reportViews })}
                />
                <div className="visual-report-meta">
                  时间区间：{report.presentation.startPeriod} -{' '}
                  {report.presentation.endPeriod} · 当前年份：
                  {report.presentation.currentPeriod}
                </div>
                {presentation.reportViews.map((view) => (
                  <figure
                    className="visual-report-figure"
                    data-visual-view={view}
                    key={view}
                  >
                    <figcaption>
                      {visualViews.find((entry) => entry.value === view)?.label}
                    </figcaption>
                    <AnalysisVisual
                      dataset={reportDataset}
                      presentation={{ ...presentation, view }}
                    />
                  </figure>
                ))}
              </section>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function ReportViewSelection({
  value,
  onChange,
}: {
  value: AnalysisVisualView[];
  onChange: (value: AnalysisVisualView[]) => void;
}) {
  return (
    <div
      className="visual-report-selection"
      role="group"
      aria-label="报告导出图表"
    >
      {visualViews.map((view) => (
        <label key={view.value}>
          <input
            type="checkbox"
            checked={value.includes(view.value)}
            disabled={value.length === 1 && value[0] === view.value}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...value, view.value]
                  : value.filter((item) => item !== view.value),
              )
            }
          />
          {view.label}
        </label>
      ))}
    </div>
  );
}

function TimeControls({
  dataset,
  presentation,
  onChange,
}: {
  dataset: AnalysisVisualDataset;
  presentation: AnalysisPresentation;
  onChange: (patch: Partial<AnalysisPresentation>) => void;
}) {
  const start = dataset.periods.indexOf(presentation.startPeriod);
  const end = dataset.periods.indexOf(presentation.endPeriod);
  const current = dataset.periods.indexOf(presentation.currentPeriod);
  return (
    <div className="visual-time-controls">
      <div className="visual-time-summary">
        <span>
          探索时间 {presentation.startPeriod} - {presentation.endPeriod}
        </span>
        <span>当前年份 {presentation.currentPeriod}</span>
      </div>
      <label>
        起始年份
        <input
          type="range"
          aria-label="起始年份"
          min={0}
          max={dataset.periods.length - 1}
          value={start}
          onChange={(event) => {
            const next = Math.min(Number(event.target.value), end);
            onChange({
              startPeriod: dataset.periods[next],
              currentPeriod: dataset.periods[Math.max(current, next)],
            });
          }}
        />
        <output>{presentation.startPeriod}</output>
      </label>
      <label>
        结束年份
        <input
          type="range"
          aria-label="结束年份"
          min={0}
          max={dataset.periods.length - 1}
          value={end}
          onChange={(event) => {
            const next = Math.max(Number(event.target.value), start);
            onChange({
              endPeriod: dataset.periods[next],
              currentPeriod: dataset.periods[Math.min(current, next)],
            });
          }}
        />
        <output>{presentation.endPeriod}</output>
      </label>
      <label>
        当前年份
        <input
          type="range"
          aria-label="当前年份"
          min={start}
          max={end}
          value={current}
          onChange={(event) =>
            onChange({
              currentPeriod: dataset.periods[Number(event.target.value)],
            })
          }
        />
        <output>{presentation.currentPeriod}</output>
      </label>
    </div>
  );
}
