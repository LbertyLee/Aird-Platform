import { useEffect, useMemo, useRef, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import { Download, Globe2, LineChart, TableProperties } from 'lucide-react';
import type {
  AnalysisPresentation,
  AnalysisVisualDataset,
  AnalysisVisualView,
} from '@agent/contracts';
import {
  buildVisualOption,
  downloadVisualBlob,
  formatVisualValue,
  selectVisualData,
  visualPalette,
  visualTableSvg,
  visualViews,
} from '../utils/analysis-visualization';
import './AnalysisVisual.css';

const icons = { line: LineChart, map: Globe2, table: TableProperties };
export function VisualViewTabs({
  value,
  onChange,
}: {
  value: AnalysisVisualView;
  onChange: (value: AnalysisVisualView) => void;
}) {
  return (
    <div className="visual-tabs" role="group" aria-label="图表视图">
      {visualViews.map((view) => {
        const Icon = icons[view.value];
        return (
          <button
            key={view.value}
            type="button"
            aria-pressed={view.value === value}
            onClick={() => onChange(view.value)}
          >
            <Icon size={14} />
            {view.label}
          </button>
        );
      })}
    </div>
  );
}

export default function AnalysisVisual({
  dataset,
  presentation,
  compact = false,
  exports = false,
}: {
  dataset: AnalysisVisualDataset;
  presentation: AnalysisPresentation;
  compact?: boolean;
  exports?: boolean;
}) {
  const chartRef = useRef<ReactECharts>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [narrow, setNarrow] = useState(false);
  const [exportError, setExportError] = useState('');
  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) =>
      setNarrow(entry.contentRect.width < 480),
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);
  const { periods, rows } = useMemo(
    () => selectVisualData(dataset, presentation),
    [dataset, presentation],
  );
  const option = useMemo(
    () => buildVisualOption(dataset, presentation, compact || narrow),
    [dataset, presentation, compact, narrow],
  );
  const tableSvg = useMemo(
    () => visualTableSvg(dataset, presentation),
    [dataset, presentation],
  );
  const height = compact
    ? 230
    : presentation.view === 'map'
      ? Math.max(380, Math.ceil(rows.length / (narrow ? 3 : 5)) * 80 + 100)
      : 420;
  function getSvg() {
    if (presentation.view === 'table') return tableSvg;
    return chartRef.current?.getEchartsInstance().renderToSVGString() ?? '';
  }
  async function exportImage(format: 'png' | 'svg') {
    setExportError('');
    const svg = getSvg();
    if (!svg) return;
    if (format === 'svg') {
      downloadVisualBlob(
        new Blob([svg], { type: 'image/svg+xml' }),
        `${dataset.name}.svg`,
      );
      return;
    }
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width * 2;
      canvas.height = image.height * 2;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (blob) downloadVisualBlob(blob, `${dataset.name}.png`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  function startExport(format: 'png' | 'svg') {
    void exportImage(format).catch(() =>
      setExportError('图表导出失败，请稍后重试。'),
    );
  }
  return (
    <div
      ref={containerRef}
      className={`analysis-visual${compact ? ' compact' : ''}`}
    >
      {exportError && (
        <p className="visual-message error" role="alert">
          {exportError}
        </p>
      )}
      {exports && (
        <div className="visual-export">
          <button
            type="button"
            onClick={() => startExport('png')}
            disabled={!rows.length}
          >
            <Download size={13} />
            导出 PNG
          </button>
          <button
            type="button"
            onClick={() => startExport('svg')}
            disabled={!rows.length}
          >
            <Download size={13} />
            导出 SVG
          </button>
        </div>
      )}
      {!rows.length || !periods.length ? (
        <div className="visual-empty">暂无数据，请选择国家/地区和时间范围</div>
      ) : presentation.view === 'table' ? (
        <div className="visual-table" style={{ maxHeight: height }}>
          <table>
            <thead>
              <tr>
                <th>国家/地区</th>
                {periods.map((period) => (
                  <th
                    className={
                      period === presentation.currentPeriod ? 'current' : ''
                    }
                    key={period}
                  >
                    {period}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.entity}>
                  <th>
                    <i
                      style={{
                        background:
                          visualPalette[
                            dataset.entities.indexOf(row.entity) %
                              visualPalette.length
                          ],
                      }}
                    />
                    {row.entity}
                  </th>
                  {row.values.map((value, index) => (
                    <td
                      className={
                        periods[index] === presentation.currentPeriod
                          ? 'current'
                          : ''
                      }
                      key={periods[index]}
                    >
                      {formatVisualValue(value)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <ReactECharts
          ref={chartRef}
          option={option}
          notMerge
          opts={{ renderer: 'svg' }}
          style={{ height, width: '100%' }}
        />
      )}
    </div>
  );
}
