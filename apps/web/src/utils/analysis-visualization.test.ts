import { describe, expect, it } from 'vitest';
import type { AnalysisVisualDataset } from '@agent/contracts';
import {
  buildVisualOption,
  defaultPresentation,
  selectVisualData,
  visualTableSvg,
} from './analysis-visualization';

const dataset: AnalysisVisualDataset = {
  id: 'gdp',
  name: 'GDP',
  unit: '%',
  definition: '',
  periods: ['2024', '2025'],
  entities: ['China', 'India'],
  sources: [],
  points: [
    {
      entity: 'China',
      period: '2024',
      value: 0,
      conflict: false,
      sourceIds: [],
    },
    {
      entity: 'China',
      period: '2025',
      value: -2,
      conflict: false,
      sourceIds: [],
    },
    {
      entity: 'India',
      period: '2025',
      value: 3,
      conflict: false,
      sourceIds: [],
    },
  ],
};
describe('shared visualization model', () => {
  it('defaults the marked year to the latest available year no later than today', () => {
    const periods = Array.from({ length: 151 }, (_, index) => String(1950 + index));
    const forecastDataset = { ...dataset, periods };
    const presentation = defaultPresentation(forecastDataset);
    const latestAvailableYear = periods
      .filter((period) => Number(period) <= new Date().getFullYear())
      .at(-1);

    expect(presentation.currentPeriod).toBe(latestAvailableYear);
    expect(presentation.endPeriod).toBe('2100');
  });

  it('uses the same selected rows for all views and never treats zero as missing', () => {
    const selection = { ...defaultPresentation(dataset), entities: ['China'] };
    expect(selectVisualData(dataset, selection).rows[0].values).toEqual([
      0, -2,
    ]);
    const line = buildVisualOption(dataset, selection);
    expect(line.series[0]).toMatchObject({
      type: 'line',
      data: [0, -2],
      connectNulls: false,
    });
    const map = buildVisualOption(dataset, {
      ...selection,
      view: 'map',
      currentPeriod: '2024',
    });
    expect(map.series[0]).toMatchObject({
      type: 'heatmap',
      data: [{ name: 'China', value: [0, 0, 0], missing: false }],
    });
    expect(
      selectVisualData(dataset, { ...selection, entities: [] }).rows,
    ).toEqual([]);
  });
  it('escapes source data in SVG exports', () => {
    const svg = visualTableSvg(
      { ...dataset, name: '<script>alert(1)</script>' },
      defaultPresentation(dataset),
    );
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });
});
