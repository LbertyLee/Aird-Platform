import type { AnalysisVisualDataset } from './index.js';

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
  if (
    existing.candidates.every((value) =>
      valuesApproximatelyEqual(value, existing.candidates[0]!),
    )
  ) {
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
    const value =
      item.normalizationStatus === 'unknown'
        ? null
        : (item.normalizedValue ?? item.value);
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
