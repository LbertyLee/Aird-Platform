import * as XLSX from 'xlsx';
import { buildDatasetFilePreview, validateDatasetFile } from './dataset-file-preview';
import { DocumentParserService } from '../../research/document-parser.service';

function file(name: string, buffer: Buffer): Express.Multer.File {
  return { originalname: name, buffer, size: buffer.length } as Express.Multer.File;
}

describe('旧版 Office 文件', () => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Country', 'Year', 'GDP'], ['China', 2024, 100]]), 'Data');
  const xls = XLSX.write(book, { type: 'buffer', bookType: 'biff8' }) as Buffer;

  it('接受并预览真实 XLS，学习解析保留数据', async () => {
    validateDatasetFile(file('data.xls', xls));
    const preview = await buildDatasetFilePreview(xls, 'data.xls');
    expect(preview).toMatchObject({ kind: 'spreadsheet', rows: [['Country', 'Year', 'GDP'], ['China', '2024', '100']] });
    const parser = new DocumentParserService({} as never);
    const result = await parser.parseBuffer('data.xls', 'application/vnd.ms-excel', xls);
    expect(result.structuredData).toEqual([{ Country: 'China', Year: '2024', GDP: '100' }]);
  });

  it('拒绝扩展名伪装成旧版 Office 的文件', () => {
    expect(() => validateDatasetFile(file('fake.doc', Buffer.from('not a document')))).toThrow('Office 文件内容无效');
    expect(() => validateDatasetFile(file('fake.xls', Buffer.from('not a workbook')))).toThrow('Office 文件内容无效');
  });
});
