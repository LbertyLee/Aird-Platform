import ExcelJS from 'exceljs';
import { BusinessException } from '../../common/exceptions/business.exception';
import * as mammoth from 'mammoth';
import {
  buildDatasetFilePreview,
  getDatasetContentType,
  normalizeUploadedFileName,
  validateDatasetFile,
  wrapDatasetPreviewHtml,
} from './dataset-file-preview';

jest.mock('mammoth', () => ({
  convertToHtml: jest.fn(),
  extractRawText: jest.fn(),
}));

function createUpload(
  originalname: string,
  buffer: Buffer,
): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: buffer.length,
    destination: '',
    filename: originalname,
    path: '',
    buffer,
    stream: undefined as never,
  };
}

describe('dataset file preview', () => {
  it('uses a canonical content type instead of the client MIME type', () => {
    expect(getDatasetContentType('report.PDF')).toBe('application/pdf');
  });

  it('repairs latin1-misdecoded Chinese filenames without double-decoding', () => {
    const original = '数据说明.txt';
    const mojibake = Buffer.from(original, 'utf8').toString('latin1');
    expect(normalizeUploadedFileName(mojibake)).toBe(original);
    expect(normalizeUploadedFileName(original)).toBe(original);
    expect(normalizeUploadedFileName('readme.txt')).toBe('readme.txt');
  });

  it('accepts HTML previews while rejecting unsupported and forged files', async () => {
    expect(() =>
      validateDatasetFile(createUpload('payload.html', Buffer.from('<html>'))),
    ).not.toThrow();
    await expect(
      buildDatasetFilePreview(Buffer.from('<h1>标题</h1>', 'utf8'), 'payload.html'),
    ).resolves.toMatchObject({ kind: 'html', html: '<h1>标题</h1>' });
    expect(() =>
      validateDatasetFile(createUpload('payload.exe', Buffer.from('MZ'))),
    ).toThrow(BusinessException);
    expect(() =>
      validateDatasetFile(createUpload('payload.pdf', Buffer.from('<html>'))),
    ).toThrow('PDF 文件内容无效');
  });

  it('parses quoted CSV cells into a bounded table preview', async () => {
    const preview = await buildDatasetFilePreview(
      Buffer.from('name,description\nA,"one,two"', 'utf-8'),
      'sample.csv',
    );

    expect(preview).toMatchObject({
      kind: 'spreadsheet',
      rows: [
        ['name', 'description'],
        ['A', 'one,two'],
      ],
      totalRows: 2,
      totalColumns: 2,
      truncated: false,
    });
  });

  it('preserves existing plain-text dataset formats', async () => {
    const preview = await buildDatasetFilePreview(
      Buffer.from('# 数据说明', 'utf-8'),
      'readme.md',
    );

    expect(preview).toMatchObject({
      kind: 'document',
      text: '# 数据说明',
      truncated: false,
    });
  });

  it('returns values from the first XLSX worksheet', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('数据');
    sheet.addRow(['月份', '金额']);
    sheet.addRow(['一月', 120]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const preview = await buildDatasetFilePreview(buffer, 'sample.xlsx');

    expect(preview).toMatchObject({
      kind: 'spreadsheet',
      sheetName: '数据',
      rows: [
        ['月份', '金额'],
        ['一月', '120'],
      ],
    });
  });

  it('returns pdf preview metadata without parsing bytes', async () => {
    const preview = await buildDatasetFilePreview(
      Buffer.from('%PDF-1.7\n%....'),
      'report.pdf',
    );

    expect(preview).toMatchObject({
      kind: 'pdf',
      fileName: 'report.pdf',
      mimeType: 'application/pdf',
    });
  });

  it('returns styled HTML for DOCX so tables keep structure', async () => {
    jest.mocked(mammoth.convertToHtml).mockResolvedValue({
      value:
        '<table><tr><th>指标</th><th>年末数 (万人)</th></tr><tr><td>全月人口</td><td>140828</td></tr></table>',
      messages: [],
    });

    const preview = await buildDatasetFilePreview(
      Buffer.from('PK'),
      'stats.docx',
    );

    expect(mammoth.convertToHtml).toHaveBeenCalled();
    expect(preview).toMatchObject({
      kind: 'html',
      fileName: 'stats.docx',
      truncated: false,
    });
    if (preview.kind !== 'html') throw new Error('expected html preview');
    expect(preview.html).toContain('<table>');
    expect(preview.html).toContain('指标');
    expect(wrapDatasetPreviewHtml('<p>x</p>')).toContain('<!DOCTYPE html>');
  });

  it('extracts plain text from TXT for document preview', async () => {
    const preview = await buildDatasetFilePreview(
      Buffer.from('hello dataset\nline2', 'utf-8'),
      'notes.txt',
    );

    expect(preview).toMatchObject({
      kind: 'document',
      text: 'hello dataset\nline2',
      truncated: false,
    });
  });
});
