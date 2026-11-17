import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';

// word-extractor does not publish TypeScript declarations.
const WordExtractor = require('word-extractor') as new () => {
  extract(buffer: Buffer): Promise<{ getBody(): string }>;
};

export async function extractLegacyWord(buffer: Buffer): Promise<string> {
  const document = await new WordExtractor().extract(buffer);
  return document.getBody();
}

export function readLegacyExcel(buffer: Buffer): ExcelJS.Workbook {
  const source = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const workbook = new ExcelJS.Workbook();
  for (const name of source.SheetNames) {
    const sheet = workbook.addWorksheet(name);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(source.Sheets[name], {
      header: 1, defval: '', raw: false, blankrows: true,
    });
    for (const row of rows) sheet.addRow(row);
  }
  return workbook;
}
