import ExcelJS from 'exceljs';
import * as mammoth from 'mammoth';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { extractLegacyWord, readLegacyExcel } from './legacy-office';
import { BusinessException } from '../../common/exceptions/business.exception';

export const MAX_DATASET_FILE_SIZE = 20 * 1024 * 1024;
const MAX_PREVIEW_ROWS = 200;
const MAX_PREVIEW_COLUMNS = 50;
const MAX_WORD_PREVIEW_CHARACTERS = 200_000;

/** Wrap mammoth / fragment HTML for iframe srcDoc previews (tables, typography). */
export function wrapDatasetPreviewHtml(body: string): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><style>
body{margin:0;padding:18px 22px;color:#263e61;font:13px/1.8 "Microsoft YaHei",system-ui,sans-serif}
table{border-collapse:collapse;width:max-content;min-width:100%;margin:0 0 12px;font-size:12px}
th,td{padding:8px 10px;border:1px solid #e1e9f2;text-align:left;vertical-align:top}
th{color:#183762;background:#edf5ff;font-weight:700}
p{margin:0 0 12px}
h1,h2,h3,h4,h5,h6{margin:0 0 12px;color:#19345c;line-height:1.4}
ul,ol{margin:0 0 12px;padding-left:24px}
img{max-width:100%;height:auto}
</style></head><body>${body}</body></html>`;
}

const CONTENT_TYPES: Record<string, string> = {
  '.csv': 'text/csv; charset=utf-8',
  '.doc': 'application/msword',
  '.xls': 'application/vnd.ms-excel',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export type DatasetFilePreview =
  | {
      kind: 'pdf';
      fileName: string;
      mimeType: 'application/pdf';
    }
  | {
      kind: 'document';
      fileName: string;
      text: string;
      truncated: boolean;
    }
  | {
      kind: 'html';
      fileName: string;
      html: string;
      truncated: boolean;
    }
  | {
      kind: 'spreadsheet';
      fileName: string;
      sheetName: string;
      rows: string[][];
      totalRows: number;
      totalColumns: number;
      truncated: boolean;
    };

export function getDatasetFileExtension(fileName: string): string {
  return extname(fileName).toLowerCase();
}

/**
 * 修复 Multer/busboy 默认按 latin1 解析 Content-Disposition 导致的中文文件名乱码。
 * 已是正常 UTF-8（含中文）时原样返回，避免二次损坏。
 */
export function normalizeUploadedFileName(fileName: string): string {
  if (!fileName || /[\u4e00-\u9fff]/.test(fileName)) {
    return fileName;
  }
  try {
    const repaired = Buffer.from(fileName, 'latin1').toString('utf8');
    if (
      repaired !== fileName &&
      !repaired.includes('\uFFFD') &&
      /[\u4e00-\u9fff]/.test(repaired)
    ) {
      return repaired;
    }
  } catch {
    // keep original
  }
  return fileName;
}

export function getDatasetContentType(fileName: string): string {
  const contentType = CONTENT_TYPES[getDatasetFileExtension(fileName)];
  if (!contentType) {
    throw new BusinessException(
      'DATASET_FILE_TYPE_UNSUPPORTED',
      '仅支持 PDF、CSV、XLS、XLSX、DOC、DOCX、TXT、MD、HTML 和 JSON 文件',
      400,
    );
  }
  return contentType;
}

export function validateDatasetFile(file: Express.Multer.File): void {
  if (!file?.buffer?.length) {
    throw new BusinessException('FILE_REQUIRED', '请上传文件', 400);
  }
  if (file.size > MAX_DATASET_FILE_SIZE) {
    throw new BusinessException(
      'DATASET_FILE_TOO_LARGE',
      '文件大小不能超过 20 MB',
      413,
    );
  }

  const extension = getDatasetFileExtension(file.originalname);
  getDatasetContentType(file.originalname);
  if (
    extension === '.pdf' &&
    !file.buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))
  ) {
    throw new BusinessException(
      'DATASET_FILE_INVALID',
      'PDF 文件内容无效',
      400,
    );
  }
  if ((extension === '.doc' || extension === '.xls') &&
      !file.buffer.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'))) {
    throw new BusinessException('DATASET_FILE_INVALID', 'Office 文件内容无效', 400);
  }
  if (
    (extension === '.docx' || extension === '.xlsx') &&
    !file.buffer.subarray(0, 2).equals(Buffer.from('PK'))
  ) {
    throw new BusinessException(
      'DATASET_FILE_INVALID',
      'Office 文件内容无效',
      400,
    );
  }
}

export async function buildDatasetFilePreview(
  buffer: Buffer,
  fileName: string,
): Promise<DatasetFilePreview> {
  const extension = getDatasetFileExtension(fileName);
  if (extension === '.pdf') {
    return { kind: 'pdf', fileName, mimeType: 'application/pdf' };
  }
  if (extension === '.doc') {
    const text = await extractLegacyWord(buffer);
    return { kind: 'document', fileName, text: text.slice(0, MAX_WORD_PREVIEW_CHARACTERS), truncated: text.length > MAX_WORD_PREVIEW_CHARACTERS };
  }
  if (extension === '.docx') {
    const result = await mammoth.convertToHtml({ buffer });
    const truncated = result.value.length > MAX_WORD_PREVIEW_CHARACTERS;
    const body = result.value.slice(0, MAX_WORD_PREVIEW_CHARACTERS);
    return {
      kind: 'html',
      fileName,
      html: wrapDatasetPreviewHtml(body),
      truncated,
    };
  }
  if (extension === '.html' || extension === '.htm') {
    const html = buffer.toString('utf-8');
    const truncated = html.length > MAX_WORD_PREVIEW_CHARACTERS;
    return {
      kind: 'html',
      fileName,
      html: html.slice(0, MAX_WORD_PREVIEW_CHARACTERS),
      truncated,
    };
  }
  if (extension === '.txt' || extension === '.md' || extension === '.markdown' || extension === '.json') {
    const text = buffer.toString('utf-8');
    const truncated = text.length > MAX_WORD_PREVIEW_CHARACTERS;
    return {
      kind: 'document',
      fileName,
      text: text.slice(0, MAX_WORD_PREVIEW_CHARACTERS),
      truncated,
    };
  }
  if (extension === '.csv' || extension === '.xlsx' || extension === '.xls') {
    return buildSpreadsheetPreview(buffer, fileName, extension);
  }
  getDatasetContentType(fileName);
  throw new BusinessException(
    'DATASET_FILE_TYPE_UNSUPPORTED',
    '文件类型不支持预览',
    400,
  );
}

async function buildSpreadsheetPreview(
  buffer: Buffer,
  fileName: string,
  extension: '.csv' | '.xlsx' | '.xls',
): Promise<DatasetFilePreview> {
  const workbook = extension === '.xls' ? readLegacyExcel(buffer) : new ExcelJS.Workbook();
  if (extension === '.csv') {
    await workbook.csv.read(Readable.from(buffer));
  } else if (extension === '.xlsx') {
    const excelBuffer = buffer as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0];
    await workbook.xlsx.load(excelBuffer);
  }
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return {
      kind: 'spreadsheet',
      fileName,
      sheetName: '',
      rows: [],
      totalRows: 0,
      totalColumns: 0,
      truncated: false,
    };
  }

  const totalRows = worksheet.actualRowCount;
  const totalColumns = worksheet.actualColumnCount;
  const rowCount = Math.min(totalRows, MAX_PREVIEW_ROWS);
  const columnCount = Math.min(totalColumns, MAX_PREVIEW_COLUMNS);
  const rows: string[][] = [];
  for (let rowNumber = 1; rowNumber <= rowCount; rowNumber += 1) {
    const row: string[] = [];
    for (let columnNumber = 1; columnNumber <= columnCount; columnNumber += 1) {
      row.push(
        formatCellValue(worksheet.getCell(rowNumber, columnNumber).value),
      );
    }
    rows.push(row);
  }
  return {
    kind: 'spreadsheet',
    fileName,
    sheetName: worksheet.name,
    rows,
    totalRows,
    totalColumns,
    truncated:
      totalRows > MAX_PREVIEW_ROWS || totalColumns > MAX_PREVIEW_COLUMNS,
  };
}

function formatCellValue(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return String(value);
  if ('result' in value && value.result !== undefined) {
    return formatCellValue(value.result);
  }
  if ('richText' in value) {
    return value.richText.map((item) => item.text).join('');
  }
  if ('text' in value) return value.text;
  if ('error' in value) return value.error;
  return JSON.stringify(value);
}
