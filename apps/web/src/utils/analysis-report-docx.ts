import type {
  AnalysisPresentation,
  AnalysisVisualDataset,
  AnalysisVisualReport,
  AnalysisVisualView,
} from '@agent/contracts';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
} from 'docx';
import { formatVisualValue, selectVisualData, visualTableSvg, visualViews } from './analysis-visualization';

const REPORT_FONT = 'Microsoft YaHei';

export type ReportFigureRequest = {
  view: AnalysisVisualView;
  caption?: string;
  section?: string;
};

export type ReportFigureImage = ReportFigureRequest & {
  png: Uint8Array;
  width: number;
  height: number;
  caption: string;
};

function text(value: string, options?: { bold?: boolean; size?: number }) {
  return new TextRun({
    text: value,
    font: REPORT_FONT,
    ...(options?.bold ? { bold: true } : {}),
    ...(options?.size ? { size: options.size } : {}),
  });
}

function heading(value: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]) {
  return new Paragraph({
    heading: level,
    children: [text(value, { bold: true })],
    spacing: { before: 240, after: 120 },
  });
}

function bodyParagraph(value: string) {
  return new Paragraph({
    children: [text(value)],
    spacing: { after: 160 },
    alignment: AlignmentType.JUSTIFIED,
  });
}

function docxImage(figure: ReportFigureImage) {
  const maxWidth = 620;
  const scale = Math.min(1, maxWidth / Math.max(figure.width, 1));
  const width = Math.round(figure.width * scale);
  const height = Math.round(figure.height * scale);
  return new Paragraph({
    children: [
      new ImageRun({
        data: figure.png,
        type: 'png',
        transformation: { width, height },
      }),
    ],
    spacing: { after: 200 },
  });
}

export async function buildAnalysisReportDocx(
  report: AnalysisVisualReport,
  figures: ReportFigureImage[],
  datasets: AnalysisVisualDataset[] = [],
): Promise<Blob> {
  const children: (Paragraph | Table)[] = [
    heading(report.title, HeadingLevel.TITLE),
    bodyParagraph(
      `生成时间：${new Date(report.createdAt).toLocaleString('zh-CN')} · 当前年份：${report.presentation.currentPeriod}`,
    ),
  ];

  if (report.metrics.length) {
    children.push(
      bodyParagraph(
        report.metrics
          .map((metric) => `${metric.label}：${metric.value}`)
          .join(' · '),
      ),
    );
  }

  for (const section of report.sections) {
    children.push(heading(section.title, HeadingLevel.HEADING_2));
    for (const paragraph of section.paragraphs) {
      children.push(bodyParagraph(paragraph));
    }
  }

  const primary = datasets[0];
  for (const dataset of datasets) {
    const selection = selectVisualData(dataset, { ...report.presentation, periods: primary ? selectVisualData(primary, report.presentation).periods : report.presentation.periods });
    children.push(heading(`数据明细：${dataset.name}（${dataset.unit || '未注明单位'}）`, HeadingLevel.HEADING_2));
    // Split wide time series into manageable editable tables in Word.
    for (let start = 0; start < selection.periods.length; start += 8) {
      const periods = selection.periods.slice(start, start + 8);
      const row = (cells: string[]) => new TableRow({ children: cells.map((value) => new TableCell({ children: [new Paragraph(value)] })) });
      children.push(new Table({ rows: [row(['国家/地区', ...periods]), ...selection.rows.map((entry) => row([entry.entity, ...entry.values.slice(start, start + 8).map(formatVisualValue)]))] }));
    }
  }

  let activeSection = '';
  for (const figure of figures) {
    if (figure.section && figure.section !== activeSection) {
      activeSection = figure.section;
      children.push(heading(activeSection, HeadingLevel.HEADING_2));
      if (activeSection === '可视化图表') {
        children.push(
          bodyParagraph(
            `时间区间：${report.presentation.startPeriod} - ${report.presentation.endPeriod} · 当前年份：${report.presentation.currentPeriod}`,
          ),
        );
      }
    }
    if (figure.caption !== figure.section) {
      children.push(heading(figure.caption, HeadingLevel.HEADING_3));
    }
    children.push(docxImage(figure));
  }

  const document = new Document({
    sections: [{ properties: {}, children }],
  });
  return Packer.toBlob(document);
}

export async function svgMarkupToPngBytes(
  svg: string,
  scale = 2,
): Promise<{ png: Uint8Array; width: number; height: number }> {
  const url = URL.createObjectURL(
    new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
  );
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const width = Math.max(image.width || 800, 1);
    const height = Math.max(image.height || 400, 1);
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建导出画布');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    );
    if (!blob) throw new Error('图表 PNG 转换失败');
    const png = new Uint8Array(await blob.arrayBuffer());
    return { png, width: canvas.width, height: canvas.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function collectReportFigureImages(input: {
  reportRoot: HTMLElement | null;
  dataset: AnalysisVisualDataset;
  comparisonDataset?: AnalysisVisualDataset;
  presentation: AnalysisPresentation;
  figures: ReportFigureRequest[];
}): Promise<ReportFigureImage[]> {
  const rendered: ReportFigureImage[] = [];
  for (const request of input.figures) {
    const caption =
      request.caption ??
      visualViews.find((entry) => entry.value === request.view)?.label ??
      request.view;
    const svg =
      request.view === 'table'
        ? visualTableSvg(input.dataset, input.presentation)
        : input.reportRoot
            ?.querySelector(
              `[data-visual-view="${request.view}"] .echarts-for-react svg`,
            )
            ?.outerHTML ?? '';
    if (!svg?.trim()) {
      throw new Error(`「${caption}」图表仍在渲染，请稍后下载。`);
    }
    const { png, width, height } = await svgMarkupToPngBytes(svg);
    rendered.push({ ...request, caption, png, width, height });
    if (request.view === 'table' && input.comparisonDataset) {
      const { png: comparisonPng, width: comparisonWidth, height: comparisonHeight } = await svgMarkupToPngBytes(visualTableSvg(input.comparisonDataset, { ...input.presentation, periods: input.presentation.periods ?? input.dataset.periods.slice(input.dataset.periods.indexOf(input.presentation.startPeriod), input.dataset.periods.indexOf(input.presentation.endPeriod) + 1) }));
      rendered.push({ ...request, caption: `${input.comparisonDataset.name}（${input.comparisonDataset.unit || '未注明单位'}）`, png: comparisonPng, width: comparisonWidth, height: comparisonHeight });
    }
  }
  return rendered;
}

export function reportFigureRequests(
  presentation: AnalysisPresentation,
): ReportFigureRequest[] {
  const chartViews = presentation.reportViews.filter((view) => view !== 'table');
  return [
    { view: 'table', caption: '数据明细', section: '数据明细' },
    ...chartViews.map((view) => ({
      view,
      section: '可视化图表',
    })),
  ];
}

export function analysisReportDocxFilename(title: string) {
  return `${title.replace(/[\\/:*?"<>|]/g, '-')}.docx`;
}
