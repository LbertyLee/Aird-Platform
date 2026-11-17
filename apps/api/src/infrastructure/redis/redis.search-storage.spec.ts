import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

const redisClient = {
  status: 'ready',
  on: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  quit: jest.fn(),
};
jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => redisClient),
}));

describe('search state storage with remote Redis', () => {
  beforeEach(() => jest.clearAllMocks());
  it('reserves tasks atomically in remote Redis', async () => {
    const service = new RedisService(
      new ConfigService({ REDIS_HOST: 'redis', REDIS_PORT: 6379, REDIS_DB: 0 }),
    );
    redisClient.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    expect(await service.setIfAbsent('job', 'running', 7200)).toBe(true);
    expect(await service.setIfAbsent('job', 'running', 7200)).toBe(false);
    expect(redisClient.set).toHaveBeenCalledWith(
      'job',
      'running',
      'EX',
      7200,
      'NX',
    );
  });

  it('refreshes memory expiry when a long task writes its result', async () => {
    jest.useFakeTimers();
    const service = new RedisService(
      new ConfigService({
        REDIS_HOST: 'redis',
        REDIS_PORT: 6379,
        REDIS_DB: 0,
        STORAGE_FALLBACK_TO_MEMORY: 'true',
      }),
    );
    try {
      expect(await service.setIfAbsent('job', 'running', 10)).toBe(true);
      expect(await service.setIfAbsent('job', 'duplicate', 10)).toBe(false);
      await jest.advanceTimersByTimeAsync(9000);
      await service.set('job', 'completed', 10);
      await jest.advanceTimersByTimeAsync(2000);
      expect(await service.get('job')).toBe('completed');
      await jest.advanceTimersByTimeAsync(8000);
      expect(await service.get('job')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
  it('uses the shared remote store unless memory fallback is explicit', async () => {
    const service = new RedisService(
      new ConfigService({
        REDIS_HOST: 'redis.internal',
        REDIS_PORT: 6379,
        REDIS_DB: 0,
      }),
    );
    redisClient.get.mockResolvedValue('shared-state');
    await service.set('search:job:test', 'shared-state', 7200);
    expect(redisClient.set).toHaveBeenCalledWith(
      'search:job:test',
      'shared-state',
      'EX',
      7200,
    );
    expect(await service.get('search:job:test')).toBe('shared-state');
    expect(redisClient.get).toHaveBeenCalledWith('search:job:test');
  });

  it('retains explicit local memory operation', async () => {
    const service = new RedisService(
      new ConfigService({
        REDIS_HOST: 'redis.internal',
        REDIS_PORT: 6379,
        REDIS_DB: 0,
        STORAGE_FALLBACK_TO_MEMORY: 'true',
      }),
    );
    await service.set('search:job:test', 'local-state');
    expect(await service.get('search:job:test')).toBe('local-state');
    expect(redisClient.set).not.toHaveBeenCalled();
    expect(redisClient.get).not.toHaveBeenCalled();
  });
});
