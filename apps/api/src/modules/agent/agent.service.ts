import { Injectable } from '@nestjs/common';
import { Agent, CommonStatus, Prisma } from '@prisma/client';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SYSTEM_DICT_CODES } from '../dictionary/dictionary-type.constants';
import { EntitlementResolver } from '../membership/entitlement.resolver';
import {
  CreatePlatformAgentDto,
  CreateUserAgentDto,
  UpdateUserAgentDto,
  UpdatePlatformAgentDto,
} from './dto/agent.dto';

type AgentView = Agent & {
  categoryName: string;
  isPersonal: boolean;
  owner?: {
    id: string;
    username: string;
    displayName: string | null;
  } | null;
};

/**
 * 智能体目录与用户个人智能体。
 */
@Injectable()
export class AgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlementResolver: EntitlementResolver,
  ) {}

  /** 用户端可选的启用分类。 */
  async listCategories() {
    return this.prisma.dictionaryItem.findMany({
      where: {
        type: SYSTEM_DICT_CODES.agent_category,
        status: CommonStatus.active,
        deletedAt: null,
      },
      select: { code: true, name: true, sort: true },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * 匿名用户仅看平台公开智能体；登录用户额外看自己创建的个人智能体。
   */
  async listForUser(userId?: string, query?: string, categoryCode?: string) {
    const filters: Prisma.AgentWhereInput[] = [
      {
        OR: userId
          ? [{ ownerId: null }, { ownerId: userId }]
          : [{ ownerId: null }],
      },
    ];
    if (query?.trim()) {
      const keyword = query.trim();
      filters.push({
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { description: { contains: keyword, mode: 'insensitive' } },
          { author: { contains: keyword, mode: 'insensitive' } },
        ],
      });
    }
    if (categoryCode) {
      filters.push({ categoryCode });
    }

    const rows = await this.prisma.agent.findMany({
      where: {
        status: CommonStatus.active,
        AND: filters,
      },
      orderBy: [{ ownerId: 'asc' }, { sort: 'asc' }, { usageCount: 'desc' }],
    });
    return this.withCategoryNames(rows);
  }

  /** 管理端可以查看平台与个人智能体，并识别归属用户。 */
  async listAdmin(query?: string) {
    const keyword = query?.trim();
    const rows = await this.prisma.agent.findMany({
      where: keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { author: { contains: keyword, mode: 'insensitive' } },
              { categoryCode: { contains: keyword, mode: 'insensitive' } },
              {
                owner: {
                  OR: [
                    { username: { contains: keyword, mode: 'insensitive' } },
                    {
                      profile: {
                        displayName: {
                          contains: keyword,
                          mode: 'insensitive',
                        },
                      },
                    },
                  ],
                },
              },
            ],
          }
        : undefined,
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            profile: { select: { displayName: true } },
          },
        },
      },
      orderBy: [{ ownerId: 'asc' }, { sort: 'asc' }, { createdAt: 'desc' }],
    });
    const names = await this.categoryNameMap(
      rows.map((row) => row.categoryCode),
    );
    return rows.map((row) => ({
      ...row,
      categoryName: names.get(row.categoryCode) ?? row.categoryCode,
      isPersonal: Boolean(row.ownerId),
      owner: row.owner
        ? {
            id: row.owner.id,
            username: row.owner.username,
            displayName: row.owner.profile?.displayName ?? null,
          }
        : null,
    }));
  }

  /** 管理端创建平台公开智能体。 */
  async createPlatform(dto: CreatePlatformAgentDto, userId: string) {
    await this.requireCategory(dto.categoryCode);
    const author = await this.resolveUserName(userId);
    const row = await this.prisma.agent.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || '',
        categoryCode: dto.categoryCode,
        author,
        icon: dto.icon?.trim() || null,
        iconColor: dto.iconColor?.trim() || null,
        status: dto.status ?? CommonStatus.active,
        sort: dto.sort ?? 0,
      },
    });
    return this.withCategoryNames([row]).then(([item]) => item);
  }

  private async resolveUserName(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { username: true, profile: { select: { displayName: true } } },
    });
    if (!user) {
      throw new BusinessException('USER_NOT_FOUND', '用户不存在', 404);
    }
    return user.profile?.displayName?.trim() || user.username;
  }

  /** 用户创建的智能体一律归属于当前用户，不能从请求体指定所有者或状态。 */
  async createForUser(dto: CreateUserAgentDto, userId: string) {
    await this.requireCategory(dto.categoryCode);
    const maxAgents = await this.resolveAgentLimit(userId);
    const currentCount = await this.prisma.agent.count({
      where: { ownerId: userId },
    });
    if (currentCount >= maxAgents) {
      throw new BusinessException(
        'AGENT_LIMIT_REACHED',
        `当前会员权益最多可创建 ${maxAgents} 个个人智能体`,
        409,
      );
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        username: true,
        profile: { select: { displayName: true } },
      },
    });
    if (!user) {
      throw new BusinessException('USER_NOT_FOUND', '用户不存在', 404);
    }

    const row = await this.prisma.agent.create({
      data: {
        name: dto.name.trim(),
        description: dto.description?.trim() || '',
        categoryCode: dto.categoryCode,
        author: user.profile?.displayName?.trim() || user.username,
        ownerId: userId,
        icon: dto.icon?.trim() || null,
        iconColor: dto.iconColor?.trim() || null,
        status: CommonStatus.active,
      },
    });
    return this.withCategoryNames([row]).then(([item]) => item);
  }

  async updateForUser(id: string, dto: UpdateUserAgentDto, userId: string) {
    const existing = await this.prisma.agent.findUnique({ where: { id } });
    if (!existing || existing.ownerId !== userId) {
      throw new BusinessException('AGENT_NOT_FOUND', '智能体不存在或无权操作', 404);
    }
    if (dto.categoryCode !== undefined) await this.requireCategory(dto.categoryCode);
    const row = await this.prisma.agent.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(dto.categoryCode !== undefined ? { categoryCode: dto.categoryCode } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon.trim() || null } : {}),
        ...(dto.iconColor !== undefined ? { iconColor: dto.iconColor.trim() || null } : {}),
      },
    });
    return this.withCategoryNames([row]).then(([item]) => item);
  }

  async removeForUser(id: string, userId: string) {
    const existing = await this.prisma.agent.findUnique({ where: { id } });
    if (!existing || existing.ownerId !== userId) {
      throw new BusinessException('AGENT_NOT_FOUND', '智能体不存在或无权操作', 404);
    }
    await this.prisma.agent.delete({ where: { id } });
    return { ok: true };
  }

  /** 管理端可调整平台或个人记录的可见状态与内容；归属不可变更。 */
  async updatePlatform(id: string, dto: UpdatePlatformAgentDto) {
    const existing = await this.prisma.agent.findUnique({ where: { id } });
    if (!existing) {
      throw new BusinessException('AGENT_NOT_FOUND', '智能体不存在', 404);
    }
    if (dto.categoryCode !== undefined) {
      await this.requireCategory(dto.categoryCode);
    }
    const row = await this.prisma.agent.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description.trim() }
          : {}),
        ...(dto.categoryCode !== undefined
          ? { categoryCode: dto.categoryCode }
          : {}),
        ...(dto.author !== undefined ? { author: dto.author.trim() } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon.trim() || null } : {}),
        ...(dto.iconColor !== undefined
          ? { iconColor: dto.iconColor.trim() || null }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.sort !== undefined ? { sort: dto.sort } : {}),
      },
    });
    return this.withCategoryNames([row]).then(([item]) => item);
  }

  async remove(id: string) {
    const existing = await this.prisma.agent.findUnique({ where: { id } });
    if (!existing) {
      throw new BusinessException('AGENT_NOT_FOUND', '智能体不存在', 404);
    }
    await this.prisma.agent.delete({ where: { id } });
    return { ok: true };
  }

  private async requireCategory(categoryCode: string) {
    const category = await this.prisma.dictionaryItem.findFirst({
      where: {
        type: SYSTEM_DICT_CODES.agent_category,
        code: categoryCode,
        status: CommonStatus.active,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!category) {
      throw new BusinessException(
        'AGENT_CATEGORY_INVALID',
        '智能体分类不存在或已停用，请选择后台启用的分类',
        400,
      );
    }
  }

  private async withCategoryNames(rows: Agent[]): Promise<AgentView[]> {
    const names = await this.categoryNameMap(
      rows.map((row) => row.categoryCode),
    );
    return rows.map((row) => ({
      ...row,
      categoryName: names.get(row.categoryCode) ?? row.categoryCode,
      isPersonal: Boolean(row.ownerId),
    }));
  }

  private async categoryNameMap(codes: string[]) {
    const uniqueCodes = [...new Set(codes)];
    if (uniqueCodes.length === 0) {
      return new Map<string, string>();
    }
    const rows = await this.prisma.dictionaryItem.findMany({
      where: {
        type: SYSTEM_DICT_CODES.agent_category,
        code: { in: uniqueCodes },
        deletedAt: null,
      },
      select: { code: true, name: true },
    });
    return new Map(rows.map((row) => [row.code, row.name]));
  }

  private async resolveAgentLimit(userId: string) {
    const entitlements = await this.entitlementResolver.resolveForUser(userId);
    const raw = entitlements.values.max_agents;
    const value =
      typeof raw === 'object' && raw !== null && 'n' in raw
        ? Number((raw as { n?: unknown }).n)
        : Number(raw);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  }
}
