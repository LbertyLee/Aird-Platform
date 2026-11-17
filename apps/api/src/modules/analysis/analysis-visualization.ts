import { BadRequestException } from '@nestjs/common';
import type {
  AnalysisPresentation,
  AnalysisVisualDataset,
  AnalysisVisualReport,
} from '@agent/contracts';

interface VisualObservation {
  indicatorId: string;
  indicatorName: string;
  unit: string;
  entity?: string;
  period?: string;
  sourceId: string;
  source: string;
  value: number | null;
  normalizedValue?: number | null;
  normalizationStatus?: 'same' | 'converted' | 'unknown';
}

interface VisualInput {
  availableIndicators?: Array<{
    id: string;
    name: string;
    unit: string;
    definition: string;
  }>;
  sources?: Array<{ id: string; title: string }>;
  observations?: VisualObservation[];
}

type GroupedPoint = AnalysisVisualDataset['points'][number] & {
  /** Higher wins when merging multi-source cells. */
  quality: number;
  /** Same-quality candidate values used to resolve mild multi-source noise. */
  candidates: number[];
};

function observationQuality(
  status: VisualObservation['normalizationStatus'],
): number {
  if (status === 'converted' || status === 'same') return 2;
  if (status === 'unknown') return 0;
  return 1;
}

/** Relative tolerance for near-duplicate GDP figures from different sources. */
function valuesApproximatelyEqual(left: number, right: number): boolean {
  const scale = Math.max(Math.abs(left), Math.abs(right), 1e-9);
  return Math.abs(left - right) / scale <= 0.02;
}

/** Pick the value that appears most often; ties keep the earliest candidate. */
function mostFrequent(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best = values[0]!;
  let bestCount = 0;
  for (const value of values) {
    const count = counts.get(value) ?? 0;
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function mergePointValue(
  existing: GroupedPoint,
  nextValue: number | null,
  nextQuality: number,
): void {
  if (nextValue == null) return;
  if (nextQuality > existing.quality) {
    existing.value = nextValue;
    existing.quality = nextQuality;
    existing.candidates = [nextValue];
    existing.conflict = false;
    return;
  }
  if (nextQuality < existing.quality) {
    // Keep the better-normalized value (e.g. drop raw 億元 that failed FX).
    return;
  }
  existing.candidates.push(nextValue);
  if (existing.candidates.every((value) => valuesApproximatelyEqual(value, existing.candidates[0]!))) {
    existing.value = existing.candidates[0]!;
    existing.conflict = false;
    return;
  }
  // Real multi-source disagreement: keep the most frequent value for charting
  // while flagging conflict for quality warnings.
  existing.conflict = true;
  existing.value = mostFrequent(existing.candidates);
}

export function buildVisualDatasets(
  input: VisualInput,
): AnalysisVisualDataset[] {
  const datasets = new Map<string, AnalysisVisualDataset>();
  const grouped = new Map<string, Map<string, GroupedPoint>>();
  for (const item of input.observations ?? []) {
    const id = JSON.stringify([item.indicatorId, item.unit]);
    if (!datasets.has(id)) {
      const indicator = input.availableIndicators?.find(
        (entry) => entry.id === item.indicatorId,
      );
      datasets.set(id, {
        id,
        name: item.indicatorName,
        unit: item.unit,
        definition: indicator?.definition ?? '',
        periods: [],
        entities: [],
        sources: [],
        points: [],
      });
      grouped.set(id, new Map());
    }
    const dataset = datasets.get(id)!;
    const entity = item.entity || item.source || '未标注实体';
    const period = item.period || '未标注时间';
    const key = JSON.stringify([entity, period]);
    const value = item.normalizationStatus === 'unknown' ? null : item.normalizedValue ?? item.value;
    const valid =
      typeof value === 'number' && Number.isFinite(value) ? value : null;
    const quality = observationQuality(item.normalizationStatus);
    const existing = grouped.get(id)!.get(key);
    if (existing) {
      if (!existing.sourceIds.includes(item.sourceId))
        existing.sourceIds.push(item.sourceId);
      mergePointValue(existing, valid, quality);
    } else {
      grouped.get(id)!.set(key, {
        entity,
        period,
        value: valid,
        conflict: false,
        sourceIds: [item.sourceId],
        quality,
        candidates: valid == null ? [] : [valid],
      });
    }
    if (!dataset.sources.some((source) => source.id === item.sourceId))
      dataset.sources.push({
        id: item.sourceId,
        title:
          input.sources?.find((source) => source.id === item.sourceId)?.title ??
          item.source,
      });
  }
  for (const dataset of datasets.values()) {
    dataset.points = [...grouped.get(dataset.id)!.values()].map(
      ({ quality: _quality, candidates: _candidates, ...point }) => point,
    );
    dataset.periods = [
      ...new Set(dataset.points.map((point) => point.period)),
    ].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    dataset.entities = [
      ...new Set(dataset.points.map((point) => point.entity)),
    ].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }
  return [...datasets.values()];
}

export function validatePresentation(
  datasets: AnalysisVisualDataset[],
  input: AnalysisPresentation,
): AnalysisVisualDataset {
  const dataset = datasets.find((item) => item.id === input.datasetId);
  if (!dataset) throw new BadRequestException('所选指标不存在。');
  if (input.entities.some((entity) => !dataset.entities.includes(entity)))
    throw new BadRequestException('所选国家/地区不存在。');
  const start = dataset.periods.indexOf(input.startPeriod);
  const end = dataset.periods.indexOf(input.endPeriod);
  const current = dataset.periods.indexOf(input.currentPeriod);
  if (start < 0 || end < start || current < start || current > end)
    throw new BadRequestException('时间范围或当前年份无效。');
  return dataset;
}

const number = (value: number) =>
  value.toLocaleString('zh-CN', { maximumFractionDigits: 4 });

export function buildVisualReport(
  dataset: AnalysisVisualDataset,
  presentation: AnalysisPresentation,
  warnings: string[] = [],
): AnalysisVisualReport {
  const periods = dataset.periods.slice(
    dataset.periods.indexOf(presentation.startPeriod),
    dataset.periods.indexOf(presentation.endPeriod) + 1,
  );
  const points = dataset.points.filter(
    (point) =>
      presentation.entities.includes(point.entity) &&
      periods.includes(point.period),
  );
  const values = points.filter(
    (point): point is typeof point & { value: number } =>
      point.value !== null && !point.conflict,
  );
  if (!values.length)
    throw new BadRequestException(
      '当前筛选没有可分析的数值，请选择国家/地区或调整时间范围。',
    );
  const ranked = values
    .filter((point) => point.period === presentation.currentPeriod)
    .sort((a, b) => b.value - a.value);
  const average =
    values.reduce((sum, point) => sum + point.value, 0) / values.length;
  const min = Math.min(...values.map((point) => point.value));
  const max = Math.max(...values.map((point) => point.value));
  const unit = dataset.unit ? ` ${dataset.unit}` : '';
  const changes = presentation.entities.flatMap((entity) => {
    const first = points.find(
      (point) => point.entity === entity && point.period === periods[0],
    );
    const last = points.find(
      (point) =>
        point.entity === entity && point.period === periods[periods.length - 1],
    );
    if (first?.value == null || last?.value == null || periods.length < 2)
      return [];
    return [
      `${entity}：${periods[0]} 年 ${number(first.value)}${unit}，${periods[periods.length - 1]} 年 ${number(last.value)}${unit}，变化 ${number(last.value - first.value)}${dataset.unit === '%' ? ' 个百分点' : unit}。`,
    ];
  });
  const total = presentation.entities.length * periods.length;
  const conflictCount = points.filter((point) => point.conflict).length;
  const usedSources = new Set(points.flatMap((point) => point.sourceIds));
  return {
    title: `${dataset.name}${dataset.unit ? `（${dataset.unit}）` : ''} 分析结果`,
    createdAt: new Date().toISOString(),
    presentation,
    metrics: [
      { label: '国家/地区', value: String(presentation.entities.length) },
      {
        label: '时间范围',
        value: `${presentation.startPeriod} - ${presentation.endPeriod}`,
      },
      { label: '样本均值', value: `${number(average)}${unit}` },
      { label: '最小值', value: `${number(min)}${unit}` },
      { label: '最大值', value: `${number(max)}${unit}` },
    ],
    sections: [
      {
        title: '结果概述',
        paragraphs: [
          `本次分析覆盖 ${presentation.entities.length} 个国家/地区、${periods.length} 个时期，包含 ${values.length} 个有效观测值。样本均值为 ${number(average)}${unit}，为有效观测的算术平均值，未按人口或经济规模加权。`,
          dataset.definition,
        ].filter(Boolean),
      },
      {
        title: '当前排名',
        paragraphs: ranked.length
          ? ranked.map(
              (point, index) =>
                `${index + 1}. ${point.entity}：${number(point.value)}${unit}（${presentation.currentPeriod}）。`,
            )
          : [`${presentation.currentPeriod} 暂无有效观测值。`],
      },
      {
        title: '趋势与变化',
        paragraphs: changes.length
          ? changes
          : ['当前时间窗口不足两个时期，或起止时期数值缺失，无法计算变化。'],
      },
      {
        title: '分布与差异',
        paragraphs: [
          `有效样本的最大值与最小值相差 ${number(max - min)}${dataset.unit === '%' ? ' 个百分点' : unit}。`,
          ranked.length > 1
            ? `${presentation.currentPeriod} 年，${ranked[0].entity} 与 ${ranked[ranked.length - 1].entity} 的差值为 ${number(ranked[0].value - ranked[ranked.length - 1].value)}${dataset.unit === '%' ? ' 个百分点' : unit}。`
            : '当前年份的有效样本不足，无法比较地区差异。',
        ],
      },
      {
        title: '数据质量与口径',
        paragraphs: [
          `完整度 ${number((values.length / total) * 100)}%；缺失或冲突 ${total - values.length} 个观测，其中 ${conflictCount} 个存在来源数值冲突（图表可显示中位数示意，排名与统计仍排除冲突值）。缺失值不插值。`,
          ...warnings,
        ],
      },
      {
        title: '数据来源',
        paragraphs: dataset.sources
          .filter((source) => usedSources.has(source.id))
          .map((source) => source.title),
      },
      {
        title: '结论与研究边界',
        paragraphs: [
          '以上结论来自当前筛选的数据，反映样本间的数值差异与时间变化，不构成因果解释。跨地区比较需核对指标定义、单位及统计口径；缺失或冲突数据需回查原始来源。',
        ],
      },
    ],
  };
}
