import path from 'node:path';
import { BadRequestException, Injectable } from '@nestjs/common';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { extractLegacyWord, readLegacyExcel } from '../modules/dataset/legacy-office';
import { PdfTextExtractor } from './pdf-text.extractor';
import type { ParsedDocument } from './research.types';
import { countryCode, inferQueryCountries } from '../common/utils/query-countries';

@Injectable()
export class DocumentParserService {
  constructor(private readonly pdfText: PdfTextExtractor) {}

  async parseFile(file: Express.Multer.File): Promise<ParsedDocument> {
    return this.parseBuffer(file.originalname, file.mimetype, file.buffer);
  }

  async parseBuffer(
    filename: string,
    mimeType: string,
    buffer: Buffer,
    options: { query?: string } = {},
  ): Promise<ParsedDocument> {
    const extension = path.extname(filename).toLowerCase();

    if (extension === '.json' || mimeType.includes('json')) {
      return this.parseJson(buffer);
    }
    if (extension === '.csv' || mimeType.includes('csv')) {
      return this.parseCsv(buffer);
    }
    if (
      ['.xlsx', '.xls'].includes(extension) ||
      mimeType.includes('spreadsheet') ||
      mimeType.includes('excel')
    ) {
      return this.parseExcel(buffer, options.query, extension === '.xls');
    }
    if (extension === '.pdf' || mimeType === 'application/pdf') {
      const parsed = await this.pdfText.extract(buffer);
      return this.knowledge(parsed.text, {
        pages: parsed.pages,
        pdfExtractMethod: parsed.method,
      });
    }
    if (extension === '.doc') {
      try { return this.knowledge(await extractLegacyWord(buffer), { format: 'doc' }); }
      catch { throw new BadRequestException('DOC 文件无法解析。'); }
    }
    if (
      extension === '.docx' ||
      mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      const parsed = await mammoth.extractRawText({ buffer });
      return this.knowledge(parsed.value, {
        parserMessages: parsed.messages.length,
      });
    }
    if (
      ['.txt', '.md', '.markdown'].includes(extension) ||
      mimeType.startsWith('text/')
    ) {
      return this.knowledge(buffer.toString('utf8'), {});
    }

    throw new BadRequestException(
      '暂不支持该文件类型，请上传 TXT、Markdown、JSON、CSV、Excel、PDF、DOC 或 DOCX。',
    );
  }

  private parseJson(buffer: Buffer): ParsedDocument {
    try {
      const data = JSON.parse(buffer.toString('utf8')) as unknown;
      const records = Array.isArray(data) ? data.length : 1;
      return {
        storageType: 'structured',
        textContent: this.compact(JSON.stringify(data, null, 2)),
        structuredData: data,
        recordCount: records,
        metadata: { format: 'json' },
      };
    } catch {
      throw new BadRequestException('JSON 文件格式无效。');
    }
  }

  private parseCsv(buffer: Buffer): ParsedDocument {
    try {
      const records = parseCsv<Record<string, string>>(buffer, {
        bom: true,
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        trim: true,
      });
      return {
        storageType: 'structured',
        textContent: this.compact(
          records
            .slice(0, 200)
            .map((record) => Object.values(record).join(' '))
            .join('\n'),
        ),
        structuredData: records,
        recordCount: records.length,
        metadata: {
          format: 'csv',
          columns: records[0] ? Object.keys(records[0]) : [],
        },
      };
    } catch {
      throw new BadRequestException('CSV 文件无法解析。');
    }
  }

  private async parseExcel(buffer: Buffer, query?: string, legacy = false): Promise<ParsedDocument> {
    try {
      const workbook = legacy ? readLegacyExcel(buffer) : new ExcelJS.Workbook();
      if (!legacy) await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      if (!workbook.worksheets.length) throw new Error('没有工作表');
      const sheets: Array<{ name: string; headers: string[]; records: Record<string, string>[]; headerRow: number }> = [];
      for (const worksheet of workbook.worksheets) {
        const headerRow = findHeaderRow(worksheet);
        if (!headerRow) continue;
        const headerValues = worksheet.getRow(headerRow).values as unknown[];
        const allHeaders = headerValues.slice(1).map((value, index) => {
          const normalized = cellText(value).trim();
          return normalized || `column_${index + 1}`;
        });
        if (allHeaders.filter((header) => !/^column_\d+$/.test(header)).length < 2)
          continue;
        const selectedHeaders = query ? selectHeaders(allHeaders, query) : allHeaders;
        const headers = selectedHeaders.length ? selectedHeaders : allHeaders;
        const selectedIndexes = headers.map((header) => allHeaders.indexOf(header));
        const records: Record<string, string>[] = [];
        for (let rowNumber = headerRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
          const values = (worksheet.getRow(rowNumber).values as unknown[]).slice(1);
          if (values.every((value) => cellText(value).trim() === '')) continue;
          if (query && !matchesQueryScope(values, allHeaders, query)) continue;
          records.push(
            Object.fromEntries(
              headers.map((header, index) => [header, cellText(values[selectedIndexes[index]]).trim()]),
            ),
          );
        }
        if (records.length) sheets.push({ name: worksheet.name, headers, records, headerRow });
      }
      if (!sheets.length) throw new Error('没有可识别的数据表');
      const worksheet = sheets[0];
      const records = sheets.flatMap((sheet) =>
        sheet.records.map((record) =>
          sheets.length > 1 ? { __sheet: sheet.name, ...record } : record,
        ),
      );
      const headers = [...new Set(sheets.flatMap((sheet) => sheet.headers))];
      return {
        storageType: 'structured',
        textContent: this.compact(
          [
            `工作表: ${sheets.map((sheet) => sheet.name).join(' | ')}`,
            `字段: ${headers.join(' | ')}`,
            ...records.slice(0, 200).map((record) =>
              headers
                .map((header) => `${header}=${record[header] ?? ''}`)
                .join(' | '),
            ),
          ].join('\n'),
        ),
        structuredData: records,
        recordCount: records.length,
        metadata: {
          format: legacy ? 'xls' : 'xlsx',
          sheet: worksheet.name,
          sheets: sheets.map((sheet) => ({ name: sheet.name, headerRow: sheet.headerRow, recordCount: sheet.records.length })),
          columns: headers,
        },
      };
    } catch {
      throw new BadRequestException('Excel 文件无法解析。');
    }
  }

  private knowledge(
    content: string,
    metadata: Record<string, unknown>,
  ): ParsedDocument {
    const textContent = this.compact(content);
    if (!textContent) throw new BadRequestException('文档中没有可读取的文本。');
    return {
      storageType: 'knowledge',
      textContent,
      recordCount: 0,
      metadata: { ...metadata, knowledgeMode: 'research-source-text' },
    };
  }

  private compact(content: string): string {
    return content.split('\u0000').join('').trim().slice(0, 200_000);
  }
}

function selectHeaders(headers: string[], query: string): string[] {
  const normalized = query.toLowerCase();
  const selected = new Set<number>();
  headers.forEach((header, index) => {
    if (/\byear\b|年份|年度|\bdate\b|国家|country|area|region|location|iso.?3|variant|版本/i.test(header)) selected.add(index);
  });
  const groups: Array<{ asked: RegExp; column: RegExp; reject?: RegExp }> = [
    { asked: /人口|population/i, column: /total population.*july|population,? total|总人口/i, reject: /male|female|density|ratio|growth|sex/i },
    { asked: /出生|新生|birth/i, column: /^births?\b|出生人数|新生人口/i, reject: /infant|surviv|rate|aged|female|male/i },
    { asked: /生育|fertility|tfr/i, column: /fertility rate|生育率/i },
    { asked: /迁移|移民|migration|migrant/i, column: /net number of migrants|net migration|净迁移/i },
    { asked: /gdp|国内生产总值/i, column: /gross domestic product|\bgdp\b|国内生产总值/i },
    { asked: /失业|unemployment/i, column: /unemployment|失业/i },
  ];
  for (const group of groups) {
    if (!group.asked.test(normalized)) continue;
    const index = headers.findIndex((header) => group.column.test(header) && !group.reject?.test(header));
    if (index >= 0) selected.add(index);
  }
  return [...selected].sort((a, b) => a - b).map((index) => headers[index]);
}

function matchesQueryScope(values: unknown[], headers: string[], query: string): boolean {
  const years = [...query.matchAll(/((?:19|20|21)\d{2})\s*(?:年|[-–—到至])\s*((?:19|20|21)\d{2})/g)];
  const range = years.at(-1);
  if (range) {
    const yearIndex = headers.findIndex((header) => /\byear\b|年份|年度/i.test(header));
    if (yearIndex >= 0) {
      const year = Number(values[yearIndex]);
      if (Number.isFinite(year) && (year < Number(range[1]) || year > Number(range[2]))) return false;
    }
  }
  const countries = inferQueryCountries(query);
  if (!countries.length) return true;
  const isoIndex = headers.findIndex((header) => /iso.?3/i.test(header));
  const placeIndex = headers.findIndex((header) => /country|area|region|location|国家|地区/i.test(header));
  if (isoIndex < 0 && placeIndex < 0) return true;
  const iso = isoIndex >= 0 ? cellText(values[isoIndex]).trim().toUpperCase() : '';
  const place = placeIndex >= 0 ? cellText(values[placeIndex]).trim().toLowerCase() : '';
  return countries.some((country) => {
    const code = countryCode(country);
    return Boolean(code && iso === code) || country.toLowerCase() === place || place.includes(country.toLowerCase());
  });
}

function findHeaderRow(worksheet: ExcelJS.Worksheet): number | undefined {
  const limit = Math.min(worksheet.rowCount, 80);
  let best: { row: number; score: number; count: number } | undefined;
  for (let rowNumber = 1; rowNumber <= limit; rowNumber += 1) {
    const values = (worksheet.getRow(rowNumber).values as unknown[]).slice(1);
    const nonEmpty = values.filter((value) => cellText(value).trim()).length;
    if (nonEmpty < 2) continue;
    const text = values.map((value) => cellText(value).trim().toLowerCase()).join(' ');
    const semanticHits = [
      /year|年份|年度|date|日期/.test(text),
      /country|area|region|国家|地区/.test(text),
      /indicator|population|birth|fertility|migration|指标|人口|出生|生育|迁移/.test(text),
    ].filter(Boolean).length;
    const score = nonEmpty * 10 + semanticHits * 100;
    if (!best || score > best.score) best = { row: rowNumber, score, count: nonEmpty };
  }
  return best?.row;
}

function cellText(value: unknown): string {
  if (value == null) return '';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value);
}
