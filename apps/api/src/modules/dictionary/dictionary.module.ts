import { Module } from '@nestjs/common';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { VectorSyncModule } from '../vector-sync/vector-sync.module';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';

/**
 * 字典管理模块。
 */
@Module({
  imports: [VectorSyncModule],
  controllers: [DictionaryController],
  providers: [DictionaryService, AuditLogWriter],
  exports: [DictionaryService],
})
export class DictionaryModule {}
