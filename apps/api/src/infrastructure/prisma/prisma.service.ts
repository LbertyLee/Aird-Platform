import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/** 单实例 Prisma 连接池上限，避免 dev 热重载堆积连接 */
const DEFAULT_CONNECTION_LIMIT = 3;

/** dev 热重载时复用同一 PrismaClient，防止 watch 模式堆积连接 */
const globalForPrisma = globalThis as unknown as {
  prismaService?: PrismaService;
};

/**
 * Prisma 客户端封装，应用启动时连接、销毁时断开。
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private connected = false;
  constructor() {
    const existing = globalForPrisma.prismaService;
    if (existing) {
      return existing;
    }

    super({
      datasources: {
        db: {
          url: PrismaService.withConnectionLimit(process.env.DATABASE_URL),
        },
      },
    });

    if (process.env.NODE_ENV !== 'production') {
      globalForPrisma.prismaService = this;
    }
  }

  /**
   * 为 DATABASE_URL 追加 connection_limit（若尚未配置）。
   */
  private static withConnectionLimit(url?: string) {
    if (!url) return url;
    if (/connection_limit=\d+/i.test(url)) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}connection_limit=${DEFAULT_CONNECTION_LIMIT}&pool_timeout=20`;
  }

  /**
   * 模块初始化时连接数据库。
   */
  async onModuleInit(): Promise<void> {
    // Research development mode can operate from the repository's in-memory fallback
    // while PostgreSQL is unavailable. Do not make the whole API unbootable in that case.
    if (process.env.STORAGE_DRIVER === 'memory') return;
    try {
      await this.$connect();
      this.connected = true;
    } catch (error) {
      const allowFallback = process.env.STORAGE_FALLBACK_TO_MEMORY === 'true';
      if (!allowFallback) throw error;
      this.logger.warn(
        `PostgreSQL unavailable; API started with memory fallback: ${this.errorMessage(error)}`,
      );
    }
  }

  /**
   * 模块销毁时断开数据库。
   */
  async onModuleDestroy(): Promise<void> {
    if (this.connected) await this.$disconnect();
    if (globalForPrisma.prismaService === this) {
      globalForPrisma.prismaService = undefined;
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
