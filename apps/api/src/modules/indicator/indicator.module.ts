import { Module } from '@nestjs/common';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { FieldMappingAutoService } from './field-mapping-auto.service';
import { IndicatorFieldMappingController } from './indicator-field-mapping.controller';
import { IndicatorFieldMappingService } from './indicator-field-mapping.service';
import { IndicatorController } from './indicator.controller';
import { IndicatorService } from './indicator.service';

/**
 * 指标管理模块。
 */
@Module({
  controllers: [IndicatorController, IndicatorFieldMappingController],
  providers: [
    IndicatorService,
    IndicatorFieldMappingService,
    FieldMappingAutoService,
    AuditLogWriter,
  ],
  exports: [
    IndicatorService,
    IndicatorFieldMappingService,
    FieldMappingAutoService,
  ],
})
export class IndicatorModule {}
