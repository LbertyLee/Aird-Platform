import {
  buildVisualDatasets,
  buildVisualReport,
  validatePresentation,
} from './analysis-visualization';
import type { AnalysisPresentation } from '@agent/contracts';

const observation = (
  entity: string,
  period: string,
  value: number | null,
  sourceId = 's1',
  unit = '%',
) => ({
  indicatorId: 'gdp',
  indicatorName: 'GDP 年增长率',
  unit,
  entity,
  period,
  value,
  sourceId,
  source: sourceId,
});
const datasets = () =>
  buildVisualDatasets({
    observations: [
      observation('中国', '2024', 4),
      observation('中国', '2025', 5),
      observation('印度', '2024', null),
      observation('印度', '2025', 6),
    ],
  });
const selection = (): AnalysisPresentation => ({
  datasetId: datasets()[0].id,
  entities: ['中国', '印度'],
  startPeriod: '2024',
  endPeriod: '2025',
  currentPeriod: '2025',
  view: 'line',
  reportViews: ['line', 'map', 'table'],
});

describe('analysis visualization', () => {
  it('excludes unchecked intermediate periods and conflicting endpoints from statistics', () => {
    const dataset = buildVisualDatasets({
      observations: [
        observation('中国', '2023', 2),
        observation('中国', '2024', 100),
        observation('中国', '2025', 4),
        observation('中国', '2025', 9, 's2'),
      ],
    })[0];
    const presentation = {
      ...selection(),
      datasetId: dataset.id,
      entities: ['中国'],
      startPeriod: '2023',
      periods: ['2023', '2025'],
    };
    validatePresentation([dataset], presentation);
    const report = buildVisualReport(dataset, presentation);
    expect(
      report.metrics.find((item) => item.label === '样本均值')?.value,
    ).toBe('2 %');
    expect(
      report.sections.find((item) => item.title === '逐经济体解读')
        ?.paragraphs[0],
    ).toContain('无法计算变化');
    expect(() =>
      validatePresentation([dataset], { ...presentation, periods: ['2023'] }),
    ).toThrow();
  });
  it('separates units and keeps the most frequent conflicting value', () => {
    const result = buildVisualDatasets({
      observations: [
        observation('中国', '2025', 5),
        observation('中国', '2025', 6, 's2'),
        observation('中国', '2025', 5, 's3'),
        observation('中国', '2025', 7, 's4', 'USD'),
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[0].points[0]).toMatchObject({
      value: 5,
      conflict: true,
      sourceIds: ['s1', 's2', 's3'],
    });
    expect(result[1].points[0].value).toBe(7);
  });

  it('uses the mode when three sources disagree', () => {
    const result = buildVisualDatasets({
      observations: [
        observation('中国', '2022', 18, 's1', '万亿美元'),
        observation('中国', '2022', 20, 's2', '万亿美元'),
        observation('中国', '2022', 18, 's3', '万亿美元'),
      ],
    });
    expect(result[0].points[0]).toMatchObject({
      value: 18,
      conflict: true,
    });
  });

  it('prefers converted values over unknown raw units and tolerates near duplicates', () => {
    const result = buildVisualDatasets({
      observations: [
        {
          ...observation('中国', '2024', 18.75, 's1', '万亿美元'),
          normalizationStatus: 'converted' as const,
        },
        {
          ...observation('中国', '2024', 1_348_066, 's2', '万亿美元'),
          normalizationStatus: 'unknown' as const,
        },
        {
          ...observation('中国', '2021', 17.7, 's3', '万亿美元'),
          normalizationStatus: 'same' as const,
        },
        {
          ...observation('中国', '2021', 17.81, 's4', '万亿美元'),
          normalizationStatus: 'converted' as const,
        },
      ],
    });
    expect(result).toHaveLength(1);
    const byPeriod = Object.fromEntries(
      result[0].points.map((point) => [point.period, point]),
    );
    expect(byPeriod['2024']).toMatchObject({
      value: 18.75,
      conflict: false,
    });
    expect(byPeriod['2021'].conflict).toBe(false);
    expect(byPeriod['2021'].value).toBeCloseTo(17.7, 1);
  });

  it('rejects invalid indicator, entity, current period and reversed ranges', () => {
    for (const invalid of [
      { datasetId: 'missing' },
      { entities: ['missing'] },
      { startPeriod: '2025', endPeriod: '2024' },
      { startPeriod: '2025', currentPeriod: '2024' },
    ]) {
      expect(() =>
        validatePresentation(datasets(), { ...selection(), ...invalid }),
      ).toThrow();
    }
  });

  it('uses the selected entities and exact periods for rankings, mean and completeness', () => {
    const report = buildVisualReport(datasets()[0], selection());
    expect(
      report.metrics.find((item) => item.label === '样本均值')?.value,
    ).toBe('5 %');
    expect(
      report.sections.find((item) => item.title === '数据解读（Top 8）')
        ?.paragraphs[0],
    ).toContain('印度');
    expect(
      report.sections.find((item) => item.title === '方法与数据质量说明')
        ?.paragraphs[0],
    ).toContain('75%');
    const filtered = buildVisualReport(datasets()[0], {
      ...selection(),
      entities: ['中国'],
    });
    expect(
      filtered.metrics.find((item) => item.label === '样本均值')?.value,
    ).toBe('4.5 %');
    expect(
      filtered.sections.find((item) => item.title === '逐经济体解读')
        ?.paragraphs,
    ).toHaveLength(1);
    expect(
      filtered.sections.find((item) => item.title === '逐经济体解读')
        ?.paragraphs[0],
    ).toContain('1 个百分点');
    expect(() =>
      buildVisualReport(datasets()[0], { ...selection(), entities: [] }),
    ).toThrow();
  });
});
