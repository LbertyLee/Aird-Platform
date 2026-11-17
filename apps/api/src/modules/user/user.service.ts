import { Inject, Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PASSWORD_HASHER } from '../../common/constants/injection-tokens';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { IPasswordHasher } from '../../domain/strategies/password-hasher';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TokenService } from '../auth/token.service';
import { activeUserSubscriptionWhere } from '../membership/active-subscription.util';
import { CreateUserDto, UpdateUserDto, UserPageQueryDto } from './dto/user.dto';

/**
 * 用户账号应用服务。
 */
@Injectable()
export class UserService {
  /**
   * @param prisma Prisma
   * @param passwordHasher 密码哈希
   * @param tokenService 会话吊销
   * @param auditLogWriter 审计
   */
  constructor(
    private readonly prisma: PrismaService,
    @Inject(PASSWORD_HASHER) private readonly passwordHasher: IPasswordHasher,
    private readonly tokenService: TokenService,
    private readonly auditLogWriter: AuditLogWriter,
  ) {}

  /**
   * 创建用户并写入 profile 与角色。
   */
  async create(dto: CreateUserDto, actorId: string) {
    const exists = await this.prisma.user.findFirst({
      where: { username: dto.username, deletedAt: null },
    });
    if (exists) {
      throw new BusinessException('USER_EXISTS', '用户名已存在');
    }

    const roleIds = [...new Set(dto.roleIds ?? [])].filter(Boolean);
    if (!roleIds.length) {
      throw new BusinessException('ROLE_REQUIRED', '请至少选择一个角色', 400);
    }
    const roles = await this.prisma.role.findMany({
      where: { id: { in: roleIds }, deletedAt: null },
    });
    if (roles.length !== roleIds.length) {
      throw new BusinessException('ROLE_NOT_FOUND', '存在无效角色', 400);
    }

    const plain = dto.password ?? this.buildDefaultPassword(dto.username);
    const passwordHash = await this.passwordHasher.hash(plain);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          username: dto.username,
          email: dto.email,
          phone: dto.phone,
          passwordHash,
          status: UserStatus.active,
          profile: {
            create: {
              displayName: dto.displayName ?? dto.username,
            },
          },
          userRoles: {
            create: roleIds.map((roleId) => ({ roleId })),
          },
        },
        include: { profile: true },
      });
      return created;
    });

    await this.auditLogWriter.write({
      actorId,
      action: 'create',
      resourceType: 'user',
      resourceId: user.id,
      detail: {
        username: user.username,
        roleIds,
      },
    });

    return {
      ...this.toDto(user),
      tempPassword: dto.password ? undefined : plain,
    };
  }

  /**
   * 更新可编辑字段。
   */
  async update(id: string, dto: UpdateUserDto, actorId: string) {
    await this.ensureExists(id);
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        email: dto.email,
        phone: dto.phone,
        profile: {
          upsert: {
            create: {
              displayName: dto.displayName,
              remark: dto.remark,
            },
            update: {
              displayName: dto.displayName,
              remark: dto.remark,
            },
          },
        },
      },
      include: { profile: true },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'update',
      resourceType: 'user',
      resourceId: id,
    });
    return this.toDto(user);
  }

  /**
   * 带条件的分页查询。
   */
  async page(query: UserPageQueryDto) {
    const where = this.buildWhere(query);
    const { skip, take } = query.toSkipTake();
    const now = new Date();
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take,
        include: this.userListInclude(now),
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return new PageResultDto(
      rows.map((u) => this.toDto(u)),
      total,
      query.page,
      query.pageSize,
    );
  }

  /** 用户筛选使用的全部有效角色，不受角色列表分页影响。 */
  roleOptions() {
    return this.prisma.role.findMany({
      where: { deletedAt: null },
      select: { id: true, code: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * 按筛选条件导出用户 CSV（不含密码）。
   */
  async exportToCsv(query: UserPageQueryDto, actorId: string) {
    const where = this.buildWhere(query);
    const now = new Date();
    const rows = await this.prisma.user.findMany({
      where,
      take: 5000,
      include: this.userListInclude(now),
      orderBy: { createdAt: 'desc' },
    });

    const statusLabel: Record<string, string> = {
      active: '启用',
      disabled: '禁用',
      pending: '待激活',
    };
    const header = [
      'username',
      'displayName',
      'email',
      'phone',
      'status',
      'roles',
      'membership',
      'lastLoginAt',
    ];
    const lines = rows.map((u) => {
      const dto = this.toDto(u);
      return [
        this.csvCell(dto.username),
        this.csvCell(dto.displayName ?? ''),
        this.csvCell(dto.email ?? ''),
        this.csvCell(dto.phone ?? ''),
        this.csvCell(statusLabel[dto.status] ?? dto.status),
        this.csvCell((dto.roles ?? []).map((r) => r.name).join('|')),
        this.csvCell(dto.membership?.levelName ?? ''),
        this.csvCell(
          dto.lastLoginAt ? new Date(dto.lastLoginAt).toISOString() : '',
        ),
      ].join(',');
    });

    await this.auditLogWriter.write({
      actorId,
      action: 'export',
      resourceType: 'user',
      detail: {
        count: rows.length,
        keyword: query.keyword,
        status: query.status,
        ids: query.ids?.length ? query.ids : undefined,
        selectedOnly: Boolean(query.ids?.length),
      },
    });

    return [header.join(','), ...lines].join('\n');
  }

  /**
   * 禁用并吊销会话。
   */
  async disable(id: string, actorId: string) {
    await this.ensureExists(id);
    await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.disabled },
    });
    await this.tokenService.revokeUserSessions(id);
    await this.auditLogWriter.write({
      actorId,
      action: 'disable',
      resourceType: 'user',
      resourceId: id,
    });
  }

  /**
   * 启用账号。
   */
  async enable(id: string, actorId: string) {
    await this.ensureExists(id);
    await this.prisma.user.update({
      where: { id },
      data: { status: UserStatus.active },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'enable',
      resourceType: 'user',
      resourceId: id,
    });
  }

  /**
   * 生成临时密码、哈希落库、返回明文（由管理员告知用户）。
   */
  async resetPassword(id: string, actorId: string) {
    const user = await this.ensureExists(id);
    const tempPassword = this.buildDefaultPassword(user.username);
    const passwordHash = await this.passwordHasher.hash(tempPassword);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
    await this.tokenService.revokeUserSessions(id);
    await this.auditLogWriter.write({
      actorId,
      action: 'reset_password',
      resourceType: 'user',
      resourceId: id,
    });
    return { tempPassword };
  }

  /**
   * 批量软删除用户并吊销会话。
   */
  async batchDeleteUsers(ids: string[], actorId: string) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      throw new BusinessException('USER_IDS_REQUIRED', '请选择要删除的用户');
    }
    if (uniqueIds.includes(actorId)) {
      throw new BusinessException('USER_DELETE_SELF', '不能删除当前登录账号');
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      include: {
        userRoles: { include: { role: { select: { code: true } } } },
      },
    });
    if (users.length === 0) {
      throw new BusinessException('USER_NOT_FOUND', '用户不存在', 404);
    }

    const deletableIds = users.map((user) => user.id);
    await this.ensurePlatformAdminsRemain(deletableIds);

    const now = new Date();
    await this.prisma.user.updateMany({
      where: { id: { in: deletableIds } },
      data: { deletedAt: now, status: UserStatus.disabled },
    });

    for (const id of deletableIds) {
      await this.tokenService.revokeUserSessions(id);
    }

    await this.auditLogWriter.write({
      actorId,
      action: 'delete',
      resourceType: 'user',
      detail: {
        deletedIds: deletableIds,
        count: deletableIds.length,
      },
    });

    return {
      ok: true,
      deleted: deletableIds.length,
      skipped: uniqueIds.length - deletableIds.length,
    };
  }

  /**
   * 确保删除后仍至少保留一名平台管理员。
   */
  private async ensurePlatformAdminsRemain(deletingIds: string[]) {
    const adminBindings = await this.prisma.userRole.findMany({
      where: {
        role: { code: 'platform_admin', deletedAt: null },
        user: { deletedAt: null },
      },
      select: { userId: true },
    });
    const adminIds = [...new Set(adminBindings.map((binding) => binding.userId))];
    if (adminIds.length === 0) return;

    const remaining = adminIds.filter((id) => !deletingIds.includes(id));
    if (remaining.length === 0) {
      throw new BusinessException(
        'USER_LAST_ADMIN',
        '不能删除最后一个平台管理员',
      );
    }
  }

  /**
   * 确保用户存在。
   */
  private async ensureExists(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
    });
    if (!user) {
      throw new BusinessException('USER_NOT_FOUND', '用户不存在', 404);
    }
    return user;
  }

  /**
   * 构造列表/导出共用筛选条件。
   */
  private buildWhere(query: UserPageQueryDto): Prisma.UserWhereInput {
    return {
      deletedAt: null,
      status: query.status,
      ...(query.roleId
        ? {
            userRoles: {
              some: { roleId: query.roleId, role: { deletedAt: null } },
            },
          }
        : {}),
      ...(query.ids?.length ? { id: { in: query.ids } } : {}),
      ...(query.keyword
        ? {
            OR: [
              { username: { contains: query.keyword, mode: 'insensitive' } },
              { email: { contains: query.keyword, mode: 'insensitive' } },
              {
                profile: {
                  displayName: { contains: query.keyword, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
  }

  /**
   * CSV 单元格转义。
   */
  private csvCell(value: string): string {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /**
   * 默认口令：账号 + @123。
   */
  private buildDefaultPassword(username: string): string {
    return `${username}@123`;
  }

  /**
   * 列表/导出共用的关联加载：个人会员。
   */
  private userListInclude(now: Date) {
    return {
      profile: true,
      userRoles: {
        include: { role: { select: { id: true, code: true, name: true } } },
      },
      subscriptions: {
        where: activeUserSubscriptionWhere(now),
        include: {
          level: { select: { id: true, code: true, name: true } },
        },
        orderBy: { endAt: 'desc' as const },
        take: 1,
      },
    };
  }

  /**
   * 转为对外 DTO。
   */
  private toDto(user: {
    id: string;
    username: string;
    email: string | null;
    phone: string | null;
    status: UserStatus;
    lastLoginAt: Date | null;
    createdAt: Date;
    profile?: { displayName: string | null } | null;
    userRoles?: Array<{
      roleId: string;
      role: { id: string; code: string; name: string };
    }>;
    subscriptions?: Array<{
      id: string;
      levelId: string;
      endAt: Date;
      level: { id: string; code: string; name: string };
    }>;
  }) {
    const activeSub = user.subscriptions?.[0];

    return {
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone,
      status: user.status,
      displayName: user.profile?.displayName ?? null,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      roles: (user.userRoles ?? []).map((ur) => ({
        id: ur.role.id,
        code: ur.role.code,
        name: ur.role.name,
      })),
      membership: activeSub
        ? {
            subscriptionId: activeSub.id,
            levelId: activeSub.levelId,
            levelCode: activeSub.level.code,
            levelName: activeSub.level.name,
            endAt: activeSub.endAt,
          }
        : null,
    };
  }
}
