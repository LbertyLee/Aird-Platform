import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { OperLogController } from './oper-log.controller';
import { OperLogInterceptor } from './oper-log.interceptor';
import { OperLogService } from './oper-log.service';

/**
 * 操作日志模块：全局拦截写入 + 管理端查询。
 */
@Module({
  controllers: [OperLogController],
  providers: [
    OperLogService,
    {
      provide: APP_INTERCEPTOR,
      useClass: OperLogInterceptor,
    },
  ],
  exports: [OperLogService],
})
export class OperLogModule {}
