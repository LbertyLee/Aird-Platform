import { Global, Module } from '@nestjs/common';
import { MinioService } from './minio.service';

/**
 * MinIO 全局模块。
 */
@Global()
@Module({
  providers: [MinioService],
  exports: [MinioService],
})
export class MinioModule {}
