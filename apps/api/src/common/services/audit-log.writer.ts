import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * 审计日志条目值对象。
 */
export class AuditEntry {
  /** 操作人 ID */
  actorId!: string | null;
  /** 动作码 */
  action!: string;
  /** 资源类型 */
  resourceType!: string;
  /** 资源 ID */
  resourceId?: string | null;
  /** 变更详情 */
  detail?: Record<string, unknown> | null;
  /** 来源 IP */
  ip?: string | null;
}

/**
 * 写入管理操作审计。
 */
@Injectable()
export class AuditLogWriter {
  /**
   * @param prisma Prisma 客户端
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 记录操作人、动作、资源与脱敏详情。
   */
  async write(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        detail: (entry.detail ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: entry.ip ?? null,
      },
    });
  }
}
