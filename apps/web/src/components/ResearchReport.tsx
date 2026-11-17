import type { ResearchSearchResponse, ResearchSource } from '@agent/contracts';
import type { AnalysisSession } from '../api/data-analysis';
import { renderMarkdown } from '../utils/markdown';
import AnalysisVisual from './AnalysisVisual';
import { defaultPresentation } from '../utils/analysis-visualization';

/** Initial evidence report. The final, user-configured analysis is generated in the workbench. */
export default function ResearchReport({
  result,
  analysis,
  busy,
  onSource,
}: {
  result: ResearchSearchResponse;
  analysis?: AnalysisSession;
  busy: boolean;
  onSource: (source: ResearchSource) => void;
}) {
  const observations = analysis?.observations ?? [];
  const summary = analysis?.summary ?? [];
  const entities = new Set(observations.map((x) => x.entity).filter(Boolean));
  const periods = [
    ...new Set(observations.map((x) => x.period).filter(Boolean)),
  ].sort();
  const conflicts = summary.filter((x) => x.conflict);
  const local = result.sources.filter((x) => x.origin !== 'exa');
  const dataset = analysis?.visualDatasets?.[0];
  const answer = analysis?.llmSummary || result.answer;
  return (
    <article className="research-report" aria-label="研究报告">
      <header>
        <h1>{result.query}</h1>
        <div className="research-report-meta">
          任务 {result.runId} ·{' '}
          {analysis
            ? `生成时间：${new Date(analysis.createdAt).toLocaleString('zh-CN', { hour12: false })}`
            : '正在整理研究报告'}
          <br />
          检索范围：
          {result.mode === 'knowledge'
            ? '知识库'
            : result.mode === 'mixed'
              ? '知识库与互联网'
              : '互联网'}{' '}
          · {result.sources.length} 个来源 · 输入：{result.query}
        </div>
      </header>
      {local.length > 0 && (
        <div className="research-knowledge-match">
          知识库匹配：命中 {local.length}{' '}
          份相关文档，已与联网来源共同纳入本次研究。
        </div>
      )}
      <section>
        <h2>
          <b>1</b> 核心结论
        </h2>
        {answer ? (
          <div className="research-report-copy">{renderMarkdown(answer)}</div>
        ) : (
          <p>
            {busy
              ? '正在对全部检索文档提取数据，完成标准化、清洗和交叉验证后整理研究结论。'
              : '本次来源暂未提供可用的研究结论，请查看原始来源及数据处理提示。'}
          </p>
        )}
      </section>
      <section>
        <h2>
          <b>2</b> 关键数据解读
        </h2>
        {summary.length ? (
          <ul>
            {summary.slice(0, 8).map((item) => (
              <li key={item.key}>
                {item.entity || '研究对象'} · {item.period || '未注明时间'} ·{' '}
                {item.indicatorName}：
                {item.value == null
                  ? '暂无可比值'
                  : `${item.value.toLocaleString('zh-CN')} ${item.unit}`}
                。{item.sourceCount} 个来源、{item.observationCount} 条观测
                {item.conflict ? '，存在口径或数值差异，需核验' : ''}。
                {item.sourceIds.map((id) => {
                  const index = result.sources.findIndex((s) => s.id === id);
                  return index < 0 ? null : (
                    <button
                      className="research-citation"
                      key={id}
                      onClick={() => onSource(result.sources[index])}
                      title={result.sources[index].title}
                    >
                      [{index + 1}]
                    </button>
                  );
                })}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            {busy
              ? '正在提取各文档中的实体、时间、指标、数值和单位…'
              : '尚未提取到可比较的结构化数据，不以文档数量代替有效数据量。'}
          </p>
        )}
      </section>
      <section>
        <h2>
          <b>3</b> 趋势与差异分析
        </h2>
        <p>
          {analysis
            ? `已提取 ${observations.length} 条观测，覆盖 ${entities.size} 个实体、${periods.length} 个时间点和 ${analysis.availableIndicators.length} 个指标。${conflicts.length ? `其中 ${conflicts.length} 组存在来源冲突，请结合来源口径核验。` : '当前提取结果未标记数值冲突；单一来源的数值仍需补充独立证据。'}`
            : '数据处理完成后展示覆盖范围、差异与可视化。'}
        </p>
        {dataset && (
          <div className="research-inline-chart">
            <AnalysisVisual
              dataset={dataset}
              presentation={{ ...defaultPresentation(dataset), view: 'line' }}
            />
          </div>
        )}
      </section>
      <section>
        <h2>
          <b>4</b> 风险与展望
        </h2>
        <p>
          不同来源的统计时间、单位和指标定义可能存在差异；缺失数据保留为空，冲突数据保留来源以便追溯。最终分析以工作台中确认的指标、实体和时间范围为准。
        </p>
        {analysis?.warnings?.length ? (
          <ul>
            {analysis.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        ) : null}
        {analysis?.sources
          ?.filter((s) => s.message)
          .map((s) => (
            <p key={s.id} className="research-source-note">
              {s.title}：{s.message}
            </p>
          ))}
      </section>
      <div className="research-report-kpis">
        {[
          ['检索来源', result.sources.length],
          ['有效观测', observations.length],
          ['覆盖实体', entities.size],
          ['分析指标', analysis?.availableIndicators.length ?? 0],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="research-report-insights">
        <section>
          <h3>数据标准化与清洗</h3>
          <p>
            {analysis
              ? `已转换单位 ${observations.filter((x) => x.normalizationStatus === 'converted').length} 条，待核验单位 ${observations.filter((x) => x.normalizationStatus === 'unknown').length} 条。`
              : '等待数据处理结果。'}
          </p>
        </section>
        <section>
          <h3>智能分析与交叉验证</h3>
          <p>
            {analysis
              ? `多来源观测组 ${summary.filter((x) => x.sourceCount > 1).length} 组，标记冲突 ${conflicts.length} 组。`
              : '等待数据处理结果。'}
          </p>
        </section>
      </div>
    </article>
  );
}
