import { ConfigService } from '@nestjs/config';
import { DocumentParserService } from './document-parser.service';
import { PdfTextExtractor } from './pdf-text.extractor';
import ExcelJS from 'exceljs';

function createParser() {
  const extractor = new PdfTextExtractor({
    get: () => '',
  } as unknown as ConfigService);
  return new DocumentParserService(extractor);
}

describe('DocumentParserService', () => {
  const parser = createParser();

  it('parses CSV as structured records', async () => {
    const result = await parser.parseBuffer(
      'gdp.csv',
      'text/csv',
      Buffer.from('country,year,value\nChina,2024,100\nJapan,2024,80'),
    );

    expect(result.storageType).toBe('structured');
    expect(result.recordCount).toBe(2);
    expect(result.structuredData).toEqual([
      { country: 'China', year: '2024', value: '100' },
      { country: 'Japan', year: '2024', value: '80' },
    ]);
  });

  it('parses JSON as structured data', async () => {
    const result = await parser.parseBuffer(
      'indicators.json',
      'application/json',
      Buffer.from('[{"indicator":"GDP","value":100}]'),
    );

    expect(result.storageType).toBe('structured');
    expect(result.recordCount).toBe(1);
  });

  it('finds headers below title rows and combines data across workbook sheets', async () => {
    const workbook = new ExcelJS.Workbook();
    const estimates = workbook.addWorksheet('Estimates');
    estimates.addRow(['World Population Prospects']);
    estimates.addRow(['Downloaded from the UN']);
    estimates.addRow(['Country', 'Year', 'Population']);
    estimates.addRow(['China', 2023, 1422]);
    const projection = workbook.addWorksheet('Medium variant');
    projection.addRow(['Projection data']);
    projection.addRow(['Country', 'Year', 'Population']);
    projection.addRow(['China', 2024, 1419]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parser.parseBuffer(
      'wpp.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    );

    expect(result.recordCount).toBe(2);
    expect(result.structuredData).toEqual([
      { __sheet: 'Estimates', Country: 'China', Year: '2023', Population: '1422' },
      { __sheet: 'Medium variant', Country: 'China', Year: '2024', Population: '1419' },
    ]);
    expect(result.metadata.sheets).toEqual([
      { name: 'Estimates', headerRow: 3, recordCount: 1 },
      { name: 'Medium variant', headerRow: 2, recordCount: 1 },
    ]);
  });

  it('filters workbook rows by requested countries and year range and keeps requested metrics', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data');
    sheet.addRow(['Country', 'ISO3', 'Year', 'Total Population, as of 1 July (thousands)', 'Births (thousands)', 'GDP']);
    sheet.addRow(['China', 'CHN', 1949, 500, 10, 1]);
    sheet.addRow(['China', 'CHN', 1950, 550, 12, 2]);
    sheet.addRow(['United States of America', 'USA', 1950, 150, 4, 3]);
    sheet.addRow(['Japan', 'JPN', 1950, 80, 2, 4]);
    sheet.addRow(['China', 'CHN', 2101, 1000, 20, 5]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const result = await parser.parseBuffer(
      'population.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
      { query: '中国和美国 1950—2100 年每年总人口和新生人口' },
    );

    expect(result.structuredData).toEqual([
      { Country: 'China', ISO3: 'CHN', Year: '1950', 'Total Population, as of 1 July (thousands)': '550', 'Births (thousands)': '12' },
      { Country: 'United States of America', ISO3: 'USA', Year: '1950', 'Total Population, as of 1 July (thousands)': '150', 'Births (thousands)': '4' },
    ]);
    expect(result.metadata.columns).not.toContain('GDP');
  });

  it('stores text as searchable research content', async () => {
    const result = await parser.parseBuffer(
      'notes.txt',
      'text/plain',
      Buffer.from('China GDP research notes'),
    );

    expect(result.storageType).toBe('knowledge');
    expect(result.textContent).toBe('China GDP research notes');
    expect(result.metadata.knowledgeMode).toBe('research-source-text');
  });

  it('uses pdf extractor result for knowledge documents', async () => {
    const extractor = {
      extract: jest.fn().mockResolvedValue({
        text: '新能源汽车产销数据',
        pages: 2,
        method: 'vision-ocr',
      }),
    };
    const pdfParser = new DocumentParserService(
      extractor as unknown as PdfTextExtractor,
    );
    const result = await pdfParser.parseBuffer(
      'report.pdf',
      'application/pdf',
      Buffer.from('%PDF-1.7'),
    );
    expect(result.storageType).toBe('knowledge');
    expect(result.textContent).toBe('新能源汽车产销数据');
    expect(result.metadata.pages).toBe(2);
    expect(result.metadata.pdfExtractMethod).toBe('vision-ocr');
  });
});
