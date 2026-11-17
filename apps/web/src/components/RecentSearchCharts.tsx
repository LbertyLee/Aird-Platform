import { useMemo, useState } from 'react';
import { ArrowRight, History, LineChart, LoaderCircle } from 'lucide-react';
import type {
  AnalysisPresentation,
  ResearchSearchResponse,
} from '@agent/contracts';
import type { ResearchHistoryItem } from '../api/data-analysis';
import AnalysisVisual, { VisualViewTabs } from './AnalysisVisual';
import {
  datasetsFromSources,
  defaultPresentation,
} from '../utils/analysis-visualization';
import './RecentSearchCharts.css';

export default function RecentSearchCharts({
  history,
  loading,
  error,
  analysisError,
  signedIn,
  onOpen,
  onOpenAnalysis,
}: {
  history: ResearchHistoryItem[];
  loading: boolean;
  error: boolean;
  analysisError?: boolean;
  signedIn: boolean;
  onOpen: (result: ResearchSearchResponse) => void;
  onOpenAnalysis?: (id: string) => void;
}) {
  const recent = [...history]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 4);
  return (
    <section className="recent-searches" aria-label="最近搜索结果">
      {analysisError && (
        <p className="visual-message error" role="alert">
          分析结果加载失败，当前展示搜索数据预览，请刷新重试。
        </p>
      )}
      {loading ? (
        <div className="recent-searches-state" role="status">
          <LoaderCircle size={22} className="spin" />
          正在加载搜索记录…
        </div>
      ) : !signedIn || error || !recent.length ? (
        <div className="recent-searches-state" role="status">
          <History size={24} />
          {!signedIn
            ? '登录后查看最近搜索结果'
            : error
              ? '历史记录加载失败，请刷新重试'
              : '暂无搜索记录'}
        </div>
      ) : (
        <div className="recent-searches-grid">
          {recent.map((item) => (
            <SearchChart
              key={item.id + ':' + (item.analysis?.id ?? '')}
              item={item}
              onOpen={onOpen}
              onOpenAnalysis={onOpenAnalysis}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function SearchChart({
  item,
  onOpen,
  onOpenAnalysis,
}: {
  item: ResearchHistoryItem;
  onOpen: (result: ResearchSearchResponse) => void;
  onOpenAnalysis?: (id: string) => void;
}) {
  const datasets = useMemo(
    () =>
      item.analysis?.visualDatasets ?? datasetsFromSources(item.result.sources),
    [item],
  );
  const [selection, setSelection] = useState<AnalysisPresentation | undefined>(
    item.analysis?.presentation,
  );
  const dataset =
    datasets.find((entry) => entry.id === selection?.datasetId) ?? datasets[0];
  const presentation = dataset
    ? selection?.datasetId === dataset.id
      ? selection
      : defaultPresentation(dataset)
    : undefined;
  return (
    <article className="recent-search-card">
      <header>
        <span className="recent-search-icon">
          <LineChart size={19} />
        </span>
        <div>
          <h3>{item.query}</h3>
          <time dateTime={item.createdAt}>
            {new Date(item.createdAt).toLocaleString('zh-CN')}
          </time>
        </div>
      </header>
      {dataset && presentation ? (
        <>
          <select
            className="recent-indicator-select"
            aria-label={item.query + ' 指标'}
            value={dataset.id}
            onChange={(event) => {
              const next = datasets.find(
                (entry) => entry.id === event.target.value,
              );
              if (next) setSelection(defaultPresentation(next));
            }}
          >
            {datasets.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
                {entry.unit && '（' + entry.unit + '）'}
              </option>
            ))}
          </select>
          <div className="recent-visual-toolbar">
            <VisualViewTabs
              value={presentation.view}
              onChange={(view) => setSelection({ ...presentation, view })}
            />
            <select
              aria-label={item.query + ' 当前年份'}
              value={presentation.currentPeriod}
              onChange={(event) =>
                setSelection({
                  ...presentation,
                  currentPeriod: event.target.value,
                })
              }
            >
              {dataset.periods
                .slice(
                  dataset.periods.indexOf(presentation.startPeriod),
                  dataset.periods.indexOf(presentation.endPeriod) + 1,
                )
                .map((period) => (
                  <option key={period}>{period}</option>
                ))}
            </select>
          </div>
          <AnalysisVisual
            dataset={dataset}
            presentation={presentation}
            compact
          />
          <p className="recent-search-source">
            {item.analysis ? '分析结果' : '搜索数据预览'} ·{' '}
            {presentation.startPeriod} - {presentation.endPeriod}
            <br />
            数据来源：{dataset.sources.map((source) => source.title).join('、')}
          </p>
        </>
      ) : (
        <div className="recent-search-no-data">
          <LineChart size={26} />
          <span>该搜索暂无可绘图的结构化数据</span>
          <small>{item.result.sources.length} 条搜索结果</small>
        </div>
      )}
      <div className="recent-search-links">
        {item.analysis && onOpenAnalysis && (
          <button
            type="button"
            className="recent-search-open"
            onClick={() => onOpenAnalysis(item.analysis!.id)}
          >
            查看分析结果
            <ArrowRight size={14} />
          </button>
        )}
        <button
          type="button"
          className="recent-search-open"
          onClick={() => onOpen(item.result)}
        >
          查看完整搜索结果
          <ArrowRight size={14} />
        </button>
      </div>
    </article>
  );
}
