import { Global, Module } from '@nestjs/common';
import { MilvusService } from './milvus.service';

/**
 * Milvus 全局模块。
 */
@Global()
@Module({
  providers: [MilvusService],
  exports: [MilvusService],
})
export class MilvusModule {}
