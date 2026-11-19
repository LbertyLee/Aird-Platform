import { BadRequestException } from '@nestjs/common';
import type {
  AnalysisPresentation,
  AnalysisVisualDataset,
  AnalysisVisualReport,
} from '@agent/contracts';

export { buildVisualDatasets } from '@agent/contracts';

export function validatePresentation(
  datasets: AnalysisVisualDataset[],
  input: AnalysisPresentation,
): AnalysisVisualDataset {
  const dataset = datasets.find((item) => item.id === input.datasetId);
  if (!dataset) throw new BadRequestException('所选指标不存在。');
  if (input.comparisonDatasetIds?.some((id) => id === input.datasetId || !datasets.some((item) => item.id === id)))
    throw new BadRequestException('对比指标不存在。');
  if (input.entities.some((entity) => !dataset.entities.includes(entity)))
    throw new BadRequestException('所选国家/地区不存在。');
  const start = dataset.periods.indexOf(input.startPeriod);
  const end = dataset.periods.indexOf(input.endPeriod);
  const current = dataset.periods.indexOf(input.currentPeriod);
  if (start < 0 || end < start || current < start || current > end)
    throw new BadRequestException('时间范围或当前年份无效。');
  if (
    input.periods &&
    (!input.periods.length ||
      input.periods.some((period) => {
        const index = dataset.periods.indexOf(period);
        return index < start || index > end;
      }) ||
      !input.periods.includes(input.currentPeriod))
  )
    throw new BadRequestException('所选时期无效。');
  return dataset;
}

const number = (value: number) =>
  value.toLocaleString('zh-CN', { maximumFractionDigits: 4 });

export function buildVisualReport(
  dataset: AnalysisVisualDataset,
  presentation: AnalysisPresentation,
  warnings: string[] = [],
): AnalysisVisualReport {
  const periods =
    presentation.periods ??
    dataset.periods.slice(
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
    if (
      first?.value == null ||
      last?.value == null ||
      first.conflict ||
      last.conflict ||
      periods.length < 2
    )
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
        title: '报告摘要',
        paragraphs: [
          `本次分析覆盖 ${presentation.entities.length} 个国家/地区、${periods.length} 个时期，包含 ${values.length} 个有效观测值。样本均值为 ${number(average)}${unit}，为有效观测的算术平均值，未按人口或经济规模加权。`,
          dataset.definition,
        ].filter(Boolean),
      },
      {
        title: '分析背景',
        paragraphs: [
          `按当前工作台确认的指标、国家/地区、时期与来源进行比较。研究对象为 ${dataset.name}，单位为 ${dataset.unit || '未注明'}；仅使用实际提取且通过数值校验的观测。`,
        ],
      },
      {
        title: '核心结论',
        paragraphs: [
          ranked.length
            ? `${presentation.currentPeriod} 年有效样本中，${ranked[0].entity} 数值最高（${number(ranked[0].value)}${unit}）；共 ${ranked.length} 个国家/地区可比。`
            : '当前年份没有可比较的有效数据。',
          `当前时间窗口有效样本范围为 ${number(min)} 至 ${number(max)}${unit}。`,
        ],
      },
      {
        title: '数据解读（Top 8）',
        paragraphs: ranked.length
          ? ranked
              .slice(0, 8)
              .map(
                (point, index) =>
                  `${index + 1}. ${point.entity}：${number(point.value)}${unit}（${presentation.currentPeriod}）。`,
              )
          : [`${presentation.currentPeriod} 暂无有效观测值。`],
      },
      {
        title: '逐经济体解读',
        paragraphs: changes.length
          ? changes
          : ['当前时间窗口不足两个时期，或起止时期数值缺失，无法计算变化。'],
      },
      {
        title: '分年度趋势解读',
        paragraphs: periods.map((period) => {
          const sample = values.filter((point) => point.period === period);
          return sample.length
            ? `${period}：${sample.length} 个有效观测，算术均值 ${number(sample.reduce((sum, point) => sum + point.value, 0) / sample.length)}${unit}。各年样本覆盖可能不同，均值变化需结合样本构成判断。`
            : `${period}：暂无有效观测。`;
        }),
      },
      {
        title: '经济体分组对比',
        paragraphs: [
          '当前文档未提供经过核验的经济体分组定义，暂不生成分组统计。可先在工作台选定国家/地区进行对比。',
        ],
      },
      {
        title: '指标口径说明',
        paragraphs: [
          dataset.definition ||
            `${dataset.name}，单位：${dataset.unit || '未注明'}。请结合原始来源确认统计口径。`,
        ],
      },
      {
        title: '趋势与差异分析',
        paragraphs: [
          `有效样本的最大值与最小值相差 ${number(max - min)}${dataset.unit === '%' ? ' 个百分点' : unit}。`,
          ranked.length > 1
            ? `${presentation.currentPeriod} 年，${ranked[0].entity} 与 ${ranked[ranked.length - 1].entity} 的差值为 ${number(ranked[0].value - ranked[ranked.length - 1].value)}${dataset.unit === '%' ? ' 个百分点' : unit}。`
            : '当前年份的有效样本不足，无法比较地区差异。',
        ],
      },
      {
        title: '方法与数据质量说明',
        paragraphs: [
          `完整度 ${number((values.length / total) * 100)}%；缺失或冲突 ${total - values.length} 个观测，其中 ${conflictCount} 个存在来源数值冲突（图表、排名与统计均排除冲突值）。缺失值不插值。`,
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
        title: '风险与展望',
        paragraphs: [
          '以上结论来自当前筛选的数据，反映样本间的数值差异与时间变化，不构成因果解释。跨地区比较需核对指标定义、单位及统计口径；缺失或冲突数据需回查原始来源。',
        ],
      },
    ],
  };
}
