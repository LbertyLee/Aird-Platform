import type {
  AnalysisPresentation,
  AnalysisVisualDataset,
  ResearchSource,
} from '@agent/contracts';

export const visualPalette = [
  '#2563eb',
  '#0891b2',
  '#4f46e5',
  '#0f766e',
  '#7c3aed',
  '#0284c7',
  '#64748b',
  '#14b8a6',
];
export const visualViews = [
  { value: 'table', label: '表格' },
  { value: 'map', label: '地图' },
  { value: 'line', label: '线路' },
] as const;
export const formatVisualValue = (value: number | null | undefined) =>
  value == null
    ? '—'
    : value.toLocaleString('zh-CN', { maximumFractionDigits: 4 });

export function defaultPresentation(
  dataset: AnalysisVisualDataset,
): AnalysisPresentation {
  const currentYear = new Date().getFullYear();
  const currentPeriod =
    dataset.periods
      .filter((period) => {
        const year = Number(period.match(/\d{4}/)?.[0]);
        return Number.isFinite(year) && year <= currentYear;
      })
      .at(-1) ??
    dataset.periods[0] ??
    '';
  return {
    datasetId: dataset.id,
    entities: [...dataset.entities],
    startPeriod: dataset.periods[0] ?? '',
    endPeriod: dataset.periods.at(-1) ?? '',
    currentPeriod,
    view: 'line',
    reportViews: ['line'],
  };
}

export function selectVisualData(
  dataset: AnalysisVisualDataset,
  presentation: AnalysisPresentation,
) {
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
  const usablePoints = points.map((point) =>
    point.conflict ? { ...point, value: null } : point,
  );
  const rows = presentation.entities
    .map((entity) => ({
      entity,
      values: periods.map(
        (period) =>
          usablePoints.find(
            (point) => point.entity === entity && point.period === period,
          )?.value ?? null,
      ),
      current:
        usablePoints.find(
          (point) =>
            point.entity === entity &&
            point.period === presentation.currentPeriod,
        )?.value ?? null,
    }))
    .sort(
      (a, b) =>
        (b.current ?? -Infinity) - (a.current ?? -Infinity) ||
        a.entity.localeCompare(b.entity, 'zh-CN'),
    );
  return { periods, points: usablePoints, rows };
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const number = Number(value.replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

// Searches without an analysis session can still preview their structured sources.
export function datasetsFromSources(
  sources: ResearchSource[],
): AnalysisVisualDataset[] {
  const datasets = new Map<string, AnalysisVisualDataset>();
  for (const source of sources) {
    const rows = (
      Array.isArray(source.structuredData)
        ? source.structuredData
        : [source.structuredData]
    ).filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === 'object' && !Array.isArray(row),
    );
    const fields = [...new Set(rows.flatMap(Object.keys))];
    const periodField = fields.find((field) =>
      /^(year|date|time|period|month|年份|年度|日期|时间|月份)$/i.test(field),
    );
    const entityField = fields.find((field) =>
      /^(entity|entityName|country|countryName|region|实体|国家|国家\/地区|地区|公司|主体)$/i.test(
        field,
      ),
    );
    const indicatorField = fields.find((field) =>
      /^(indicator|indicatorName|指标)$/i.test(field),
    );
    const unitField = fields.find((field) => /^(unit|单位)$/i.test(field));
    const metrics = fields.filter(
      (field) =>
        field !== periodField &&
        field !== entityField &&
        field !== indicatorField &&
        field !== unitField &&
        !/(^id$|code$|编号$|代码$)/i.test(field) &&
        rows.some((row) => numeric(row[field]) !== null) &&
        rows.every(
          (row) =>
            row[field] == null ||
            row[field] === '' ||
            numeric(row[field]) !== null,
        ),
    );
    for (const metric of metrics)
      for (const row of rows) {
        const name = String(
          indicatorField ? (row[indicatorField] ?? metric) : metric,
        );
        const unit = String(unitField ? (row[unitField] ?? '') : '');
        const id = JSON.stringify([source.id, metric, name, unit]);
        if (!datasets.has(id))
          datasets.set(id, {
            id,
            name: `${source.title} · ${name}`,
            unit,
            definition: '',
            periods: [],
            entities: [],
            points: [],
            sources: [{ id: source.id, title: source.title }],
          });
        const dataset = datasets.get(id)!;
        const entity = String(
          entityField ? (row[entityField] ?? '未标注实体') : source.title,
        );
        const period = String(
          periodField ? (row[periodField] ?? '未标注时间') : '未标注时间',
        );
        const value = numeric(row[metric]);
        const existing = dataset.points.find(
          (point) => point.entity === entity && point.period === period,
        );
        if (existing) {
          if (
            existing.value !== null &&
            value !== null &&
            existing.value !== value
          )
            existing.conflict = true;
          existing.value = existing.conflict ? null : (existing.value ?? value);
        } else
          dataset.points.push({
            entity,
            period,
            value,
            conflict: false,
            sourceIds: [source.id],
          });
      }
  }
  return [...datasets.values()].map((dataset) => ({
    ...dataset,
    periods: [...new Set(dataset.points.map((point) => point.period))].sort(
      (a, b) => a.localeCompare(b, undefined, { numeric: true }),
    ),
    entities: [...new Set(dataset.points.map((point) => point.entity))],
  }));
}

export function buildComparisonOption(
  primary: AnalysisVisualDataset,
  comparison: AnalysisVisualDataset,
  presentation: AnalysisPresentation,
  compact = false,
) {
  const periods = selectVisualData(primary, presentation).periods;
  const datasets = [primary, comparison];
  const series = datasets.flatMap((dataset, axis) =>
    presentation.entities.map((entity, index) => ({
      name: `${entity} · ${dataset.name}（${dataset.unit || '未标注单位'}）`,
      type: 'line',
      yAxisIndex: axis,
      data: periods.map((period) => {
        const point = dataset.points.find((item) => item.entity === entity && item.period === period);
        return point && !point.conflict ? point.value : null;
      }),
      connectNulls: false,
      symbolSize: compact ? 4 : 6,
      lineStyle: { type: axis ? 'dashed' : 'solid' },
      itemStyle: { color: visualPalette[(index * 2 + axis) % visualPalette.length] },
    })),
  );
  return {
    animation: false,
    color: visualPalette,
    tooltip: { trigger: 'axis', confine: true },
    legend: { type: 'scroll', bottom: 0 },
    grid: { top: 55, left: compact ? 10 : 20, right: compact ? 10 : 20, bottom: 45, containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: periods, axisLabel: { hideOverlap: true } },
    yAxis: datasets.map((dataset, index) => ({
      type: 'value', scale: true, name: `${dataset.name}（${dataset.unit || '未标注单位'}）`,
      nameLocation: 'end', nameGap: 24, position: index ? 'right' : 'left',
      splitLine: { show: index === 0, lineStyle: { type: 'dashed' } },
    })),
    series,
  };
}

export function buildVisualOption(
  dataset: AnalysisVisualDataset,
  presentation: AnalysisPresentation,
  compact = false,
) {
  const { periods, rows } = selectVisualData(dataset, presentation);
  const color = (entity: string) =>
    visualPalette[dataset.entities.indexOf(entity) % visualPalette.length];
  if (presentation.view === 'map') {
    const columns = compact ? 3 : 5;
    const values = rows.flatMap((row) =>
      row.current === null ? [] : [row.current],
    );
    const minimum = values.length ? Math.min(...values) : 0;
    const maximum = values.length ? Math.max(...values) : 0;
    return {
      animation: false,
      tooltip: {
        confine: true,
        renderMode: 'richText',
        formatter: (params: {
          data: { name: string; value: number[]; missing?: boolean };
        }) =>
          `${params.data.name}\n${presentation.currentPeriod}: ${params.data.missing ? '暂无数据' : `${formatVisualValue(params.data.value[2])} ${dataset.unit}`}`,
      },
      grid: compact
        ? { top: 20, bottom: 66, left: 8, right: 8 }
        : {
            top: 40,
            height: Math.max(2, Math.ceil(rows.length / columns)) * 72,
            left: 8,
            right: 8,
          },
      xAxis: {
        type: 'category',
        data: Array.from({ length: columns }, (_, i) => i),
        show: false,
      },
      yAxis: {
        type: 'category',
        data: Array.from(
          { length: Math.max(2, Math.ceil(rows.length / columns)) },
          (_, i) => i,
        ),
        inverse: true,
        show: false,
      },
      visualMap: {
        min: minimum,
        max: maximum === minimum ? maximum + 1 : maximum,
        orient: 'horizontal',
        left: 'center',
        bottom: 8,
        itemWidth: 10,
        itemHeight: compact ? 90 : 150,
        calculable: false,
        inRange: { color: ['#e8f2f5', '#97c0cf', '#34768a'] },
        text: [formatVisualValue(maximum), formatVisualValue(minimum)],
        textStyle: { fontSize: 10 },
      },
      series: [
        {
          type: 'heatmap',
          data: rows.map((row, index) => ({
            name: row.entity,
            value: [
              index % columns,
              Math.floor(index / columns),
              row.current ?? 0,
            ],
            missing: row.current === null,
            ...(row.current === null
              ? { itemStyle: { color: '#f0f1f3' } }
              : {}),
          })),
          itemStyle: { borderColor: '#fff', borderWidth: 6 },
          label: {
            show: true,
            color: '#183456',
            fontSize: compact ? 10 : 12,
            formatter: (params: {
              data: { name: string; value: number[]; missing?: boolean };
            }) =>
              `${params.data.name.length > (compact ? 8 : 12) ? `${params.data.name.slice(0, compact ? 8 : 12)}…` : params.data.name}\n${params.data.missing ? '—' : formatVisualValue(params.data.value[2])}`,
          },
        },
      ],
    };
  }
  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      confine: true,
      renderMode: 'richText',
      valueFormatter: (value: number | null) =>
        `${formatVisualValue(value)} ${dataset.unit}`,
    },
    grid: {
      top: 30,
      left: compact ? 8 : 20,
      right: compact ? 70 : 110,
      bottom: 24,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: periods,
      axisLabel: { fontSize: 10, hideOverlap: true },
      axisLine: { lineStyle: { color: '#aaa' } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { fontSize: 10 },
      splitLine: { lineStyle: { color: '#dedbd7', type: 'dashed' } },
    },
    series: rows.map((row, index) => ({
      name: row.entity,
      type: 'line',
      data: row.values,
      connectNulls: false,
      smooth: false,
      symbol: 'circle',
      symbolSize: compact ? 4 : 6,
      lineStyle: { width: 2, color: color(row.entity) },
      itemStyle: { color: color(row.entity) },
      endLabel: {
        show: true,
        formatter: (params: { value: number | null }) =>
          `${row.entity.length > 8 ? `${row.entity.slice(0, 8)}…` : row.entity} ${formatVisualValue(params.value)}`,
        fontSize: compact ? 9 : 11,
        color: '#182938',
      },
      labelLayout: { moveOverlap: 'shiftY' },
      emphasis: { focus: 'series' },
      ...(index === 0
        ? {
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { color: '#a44545', type: 'dashed' },
              label: { formatter: presentation.currentPeriod, fontSize: 10 },
              data: [{ xAxis: presentation.currentPeriod }],
            },
          }
        : {}),
    })),
  };
}

export const escapeMarkup = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  );

export function visualTableSvg(
  dataset: AnalysisVisualDataset,
  presentation: AnalysisPresentation,
) {
  const { rows, periods } = selectVisualData(dataset, presentation);
  const width = Math.max(700, 170 + periods.length * 90);
  const height = 70 + rows.length * 30;
  const cell = (value: unknown, x: number, y: number) =>
    `<text x="${x}" y="${y}" fill="#243b50" font-family="Arial, sans-serif" font-size="12">${escapeMarkup(value)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${cell(dataset.name, 12, 20)}${cell('国家/地区', 12, 50)}${periods.map((period, index) => cell(period, 180 + index * 90, 50)).join('')}${rows.map((row, index) => `${cell(row.entity, 12, 80 + index * 30)}${row.values.map((value, column) => cell(formatVisualValue(value), 180 + column * 90, 80 + index * 30)).join('')}`).join('')}</svg>`;
}

export function downloadVisualBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name.replace(/[\\/:*?"<>|]/g, '-');
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
