import { Global, Module } from '@nestjs/common';
import { REDIS_PORT } from '../../common/constants/injection-tokens';
import { RedisService } from './redis.service';

/**
 * 全局 Redis 模块。
 */
@Global()
@Module({
  providers: [
    RedisService,
    { provide: REDIS_PORT, useExisting: RedisService },
  ],
  exports: [RedisService, REDIS_PORT],
})
export class RedisModule {}
