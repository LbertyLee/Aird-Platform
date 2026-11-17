import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis 端口抽象（Adapter）。
 * 使用抽象类以便 Nest emitDecoratorMetadata 可反射类型。
 */
export abstract class IRedisPort {
  /** 读取 */
  abstract get(key: string): Promise<string | null>;
  /** 写入 */
  abstract set(key: string, value: string, ttlSec?: number): Promise<void>;
  /** 删除 */
  abstract del(key: string): Promise<void>;
  /** 前缀批量删除 */
  abstract delByPrefix(prefix: string): Promise<void>;
}

/**
 * Redis 适配实现（Infrastructure Adapter）。
 */
@Injectable()
export class RedisService implements IRedisPort, OnModuleDestroy {
  /** ioredis 客户端 */
  private readonly client: Redis;
  private readonly memory = new Map<string, string>();
  private readonly memoryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly fallbackEnabled: boolean;
  private useMemory = false;

  /**
   * @param config 环境配置
   */
  constructor(private readonly config: ConfigService) {
    this.fallbackEnabled =
      config.get<string>('REDIS_FALLBACK_TO_MEMORY') === 'true' ||
      config.get<string>('STORAGE_FALLBACK_TO_MEMORY') === 'true';
    // In fallback mode start with the in-memory adapter. This avoids an
    // asynchronous connection attempt during Nest module initialization.
    this.useMemory = this.fallbackEnabled;
    this.client = new Redis({
      host: this.config.getOrThrow<string>('REDIS_HOST'),
      port: this.config.getOrThrow<number>('REDIS_PORT'),
      password: this.config.get<string>('REDIS_PASSWORD') || undefined,
      db: this.config.getOrThrow<number>('REDIS_DB'),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    // ioredis emits connection failures asynchronously; always handle the
    // event so an unavailable optional dependency cannot crash the process.
    this.client.on('error', (error) => {
      if (this.fallbackEnabled) {
        this.useMemory = true;
        return;
      }
      console.warn(
        `[redis] ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  /**
   * 确保连接可用。
   */
  async connect(): Promise<void> {
    if (this.useMemory) return;
    if (this.client.status === 'wait') {
      try {
        await this.client.connect();
      } catch (error) {
        if (!this.fallbackEnabled) throw error;
        this.useMemory = true;
      }
    }
  }

  /**
   * 读取键值。
   */
  async get(key: string): Promise<string | null> {
    await this.connect();
    if (this.useMemory) return this.memory.get(key) ?? null;
    return this.client.get(key);
  }

  /**
   * 写入键值，可选 TTL。
   */
  async set(key: string, value: string, ttlSec?: number): Promise<void> {
    await this.connect();
    if (this.useMemory) {
      this.setMemory(key, value, ttlSec);
      return;
    }
    if (ttlSec && ttlSec > 0) {
      await this.client.set(key, value, 'EX', ttlSec);
      return;
    }
    await this.client.set(key, value);
  }

  /** Atomically reserve a task so a retried submission cannot execute twice. */
  async setIfAbsent(
    key: string,
    value: string,
    ttlSec: number,
  ): Promise<boolean> {
    await this.connect();
    if (this.useMemory) {
      if (this.memory.has(key)) return false;
      this.setMemory(key, value, ttlSec);
      return true;
    }
    return (await this.client.set(key, value, 'EX', ttlSec, 'NX')) === 'OK';
  }

  private setMemory(key: string, value: string, ttlSec?: number) {
    clearTimeout(this.memoryTimers.get(key));
    this.memoryTimers.delete(key);
    this.memory.set(key, value);
    if (ttlSec && ttlSec > 0) {
      this.memoryTimers.set(
        key,
        setTimeout(() => {
          this.memory.delete(key);
          this.memoryTimers.delete(key);
        }, ttlSec * 1000).unref(),
      );
    }
  }

  /**
   * 删除键。
   */
  async del(key: string): Promise<void> {
    await this.connect();
    if (this.useMemory) {
      clearTimeout(this.memoryTimers.get(key));
      this.memoryTimers.delete(key);
      this.memory.delete(key);
      return;
    }
    await this.client.del(key);
  }

  /**
   * 按前缀删除（SCAN）。
   */
  async delByPrefix(prefix: string): Promise<void> {
    await this.connect();
    if (this.useMemory) {
      for (const key of this.memory.keys()) {
        if (key.startsWith(prefix)) await this.del(key);
      }
      return;
    }
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        'MATCH',
        `${prefix}*`,
        'COUNT',
        100,
      );
      cursor = next;
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } while (cursor !== '0');
  }

  /**
   * 模块销毁时断开连接。
   */
  async onModuleDestroy(): Promise<void> {
    for (const timer of this.memoryTimers.values()) clearTimeout(timer);
    this.memoryTimers.clear();
    if (this.client.status !== 'end') {
      await this.client.quit();
    }
  }
}
