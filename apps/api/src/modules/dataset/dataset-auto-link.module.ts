import { Module } from '@nestjs/common';
import { DocumentParseModule } from '../../research/document-parse.module';
import { DatasetAutoLinkService } from './dataset-auto-link.service';

/**
 * 数据集自动关联（供 Dataset / Ingestion 共用）。
 */
@Module({
  imports: [DocumentParseModule],
  providers: [DatasetAutoLinkService],
  exports: [DatasetAutoLinkService],
})
export class DatasetAutoLinkModule {}
