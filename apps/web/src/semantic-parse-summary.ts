import type { ResearchQueryPlan, ResearchSearchResponse } from '@agent/contracts';
import { timeRangeLabelFromQuery } from './utils/recent-years';

export type SemanticParseSummary = {
  metrics: string[];
  entities: string[];
  dimensions: string[];
  explanation?: string;
};

function unique(values: string[]) {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

function pickLabeledSegment(detail: string, label: string): string[] {
  const match = detail.match(new RegExp(`${label}：([^；。]+)`));
  if (!match?.[1]) return [];
  return unique(match[1].split(/[、,，]/));
}

function planStageDetail(result: ResearchSearchResponse): string | undefined {
  const stages = result.stages.filter((stage) => stage.key === 'plan');
  const preferred =
    stages.find(
      (stage) =>
        stage.detail.includes('指标：') &&
        !stage.detail.startsWith('[Exa 分支]'),
    ) ?? stages[0];
  if (!preferred?.detail) return undefined;
  return preferred.detail.replace(/^\[(知识库|Exa) 分支\]\s*/, '');
}

function fromPlan(
  plan: ResearchQueryPlan,
  originalQuery: string,
): SemanticParseSummary {
  const anchoredTime = timeRangeLabelFromQuery(originalQuery);
  const timeDims = anchoredTime ? [anchoredTime] : unique(plan.timeRanges);
  let explanation = plan.explanation?.trim() || undefined;
  if (anchoredTime && explanation) {
    explanation = explanation.replace(
      /时间：[^；。]+/,
      `时间：${anchoredTime}`,
    );
  }
  return {
    metrics: unique(plan.indicators),
    entities: unique([...plan.entities, ...plan.countries]),
    dimensions: unique([...plan.regions, ...timeDims]),
    explanation,
  };
}

/** Merge API plan with Semantic Layer stage detail for the results page. */
export function buildSemanticParseSummary(
  result: ResearchSearchResponse | null | undefined,
): SemanticParseSummary | null {
  if (!result?.plan) return null;
  const query = result.query?.trim() ?? '';
  const anchoredTime = timeRangeLabelFromQuery(query);
  const base = fromPlan(result.plan, query);
  const detail = planStageDetail(result);
  if (!detail) return base;

  const timeFromDetail = anchoredTime
    ? anchoredTime
    : detail.match(/时间：([^；。]+)/)?.[1]?.trim();
  return {
    metrics: unique([
      ...base.metrics,
      ...pickLabeledSegment(detail, '指标'),
    ]),
    entities: unique([
      ...base.entities,
      ...pickLabeledSegment(detail, '实体'),
    ]),
    dimensions: unique([
      ...(anchoredTime ? [anchoredTime] : []),
      ...base.dimensions.filter(
        (item) => !/^\d{4}-\d{4}$/.test(item) || item === anchoredTime,
      ),
      ...pickLabeledSegment(detail, '维度'),
      ...pickLabeledSegment(detail, '概念'),
      ...(timeFromDetail && !anchoredTime ? [timeFromDetail] : []),
    ]),
    explanation: base.explanation,
  };
}

export function formatSemanticList(values: string[]): string {
  return values.length ? values.join('、') : '未识别';
}
