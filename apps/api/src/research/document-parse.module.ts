import { Module } from '@nestjs/common';
import { DocumentParserService } from './document-parser.service';
import { PdfTextExtractor } from './pdf-text.extractor';

/**
 * PDF / Office 文档解析（接入学习与研究工作台共用）。
 */
@Module({
  providers: [PdfTextExtractor, DocumentParserService],
  exports: [PdfTextExtractor, DocumentParserService],
})
export class DocumentParseModule {}
