import { Injectable } from '@nestjs/common';
import { CommonStatus, Prisma, RoleType } from '@prisma/client';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AssignUserRolesDto,
  CreateRoleDto,
  ReplacePermissionsDto,
  RolePageQueryDto,
  SavePermissionMatrixDto,
  SetDataScopeDto,
  UpdateRoleDto,
  UpdateRoleStatusDto,
} from './dto/rbac.dto';
import {
  BUILTIN_ROLE_CODES,
  DEFAULT_PERMISSION_MATRIX,
  PERMISSION_MATRIX_MODULES,
  ROLE_DISPLAY_TAGS,
  collectPermissionCodesForRole,
  type BuiltinRoleCode,
} from './permission-matrix.config';

/**
 * 角色权限应用服务。
 */
@Injectable()
export class RbacService {
  /**
   * @param prisma Prisma
   * @param auditLogWriter 审计
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogWriter: AuditLogWriter,
  ) {}

  /**
   * 创建自定义角色。
   */
  async createRole(dto: CreateRoleDto, actorId: string) {
    const exists = await this.prisma.role.findFirst({
      where: { code: dto.code, deletedAt: null },
    });
    if (exists) {
      throw new BusinessException('ROLE_EXISTS', '角色编码已存在');
    }
    const role = await this.prisma.role.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        type: RoleType.custom,
      },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'create',
      resourceType: 'role',
      resourceId: role.id,
    });
    return role;
  }

  /**
   * 更新角色。
   */
  async updateRole(id: string, dto: UpdateRoleDto, actorId: string) {
    await this.ensureRole(id);
    const updated = await this.prisma.role.update({
      where: { id },
      data: { name: dto.name, description: dto.description },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'update',
      resourceType: 'role',
      resourceId: id,
    });
    return updated;
  }

  /**
   * 删除角色。
   */
  async deleteRole(id: string, actorId: string) {
    const result = await this.batchDeleteRoles([id], actorId);
    return { ok: true, deleted: result.deleted };
  }

  /**
   * 批量删除角色。
   */
  async batchDeleteRoles(ids: string[], actorId: string) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      throw new BusinessException('ROLE_IDS_REQUIRED', '请选择要删除的角色');
    }

    const roles = await this.prisma.role.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
    });
    if (roles.length === 0) {
      throw new BusinessException('ROLE_NOT_FOUND', '角色不存在', 404);
    }

    const deletableIds = roles
      .filter((r) => !this.isBuiltinRole(r.code))
      .map((r) => r.id);
    if (deletableIds.length === 0) {
      throw new BusinessException(
        'ROLE_BUILTIN_PROTECTED',
        '系统内置角色不可删除',
      );
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { roleId: { in: deletableIds } } }),
      this.prisma.rolePermission.deleteMany({
        where: { roleId: { in: deletableIds } },
      }),
      this.prisma.dataScope.deleteMany({
        where: { roleId: { in: deletableIds } },
      }),
      this.prisma.role.updateMany({
        where: { id: { in: deletableIds } },
        data: { deletedAt: now, status: CommonStatus.disabled },
      }),
    ]);

    await this.auditLogWriter.write({
      actorId,
      action: 'delete',
      resourceType: 'role',
      detail: {
        deletedIds: deletableIds,
        count: deletableIds.length,
      },
    });

    return {
      ok: true,
      deleted: deletableIds.length,
    };
  }

  /**
   * 角色分页。
   */
  async pageRoles(query: RolePageQueryDto) {
    const where: Prisma.RoleWhereInput = {
      deletedAt: null,
      ...(query.keyword
        ? {
            OR: [
              { code: { contains: query.keyword, mode: 'insensitive' } },
              { name: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [total, items] = await this.prisma.$transaction([
      this.prisma.role.count({ where }),
      this.prisma.role.findMany({
        where,
        skip,
        take,
        include: {
          dataScope: true,
          _count: { select: { rolePermissions: true, userRoles: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return new PageResultDto(items, total, query.page, query.pageSize);
  }

  /**
   * 事务内重建角色权限绑定。
   */
  async replacePermissions(
    roleId: string,
    dto: ReplacePermissionsDto,
    actorId: string,
  ) {
    const role = await this.ensureRole(roleId);
    let permissionIds = dto.permissionIds;
    if (role.code === 'platform_admin') {
      const all = await this.prisma.permission.findMany({
        where: { deletedAt: null },
        select: { id: true },
      });
      permissionIds = all.map((row) => row.id);
    } else if (permissionIds.length > 0) {
      const count = await this.prisma.permission.count({
        where: { id: { in: permissionIds }, deletedAt: null },
      });
      if (count !== permissionIds.length) {
        throw new BusinessException('PERMISSION_NOT_FOUND', '存在无效权限 ID');
      }
    }
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId } }),
      this.prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      }),
    ]);
    await this.auditLogWriter.write({
      actorId,
      action: 'assign',
      resourceType: 'role_permission',
      resourceId: roleId,
      detail: {
        count: permissionIds.length,
        platformAdminFullAccess: role.code === 'platform_admin',
      },
    });
  }

  /**
   * 保存数据范围。
   */
  async setDataScope(roleId: string, dto: SetDataScopeDto, actorId: string) {
    await this.ensureRole(roleId);
    await this.prisma.dataScope.upsert({
      where: { roleId },
      update: { scopeType: dto.scopeType },
      create: {
        roleId,
        scopeType: dto.scopeType,
      },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'update',
      resourceType: 'data_scope',
      resourceId: roleId,
    });
  }

  /**
   * 查询用户当前角色绑定。
   */
  async getUserRoles(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) {
      throw new BusinessException('USER_NOT_FOUND', '用户不存在', 404);
    }
    const bindings = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
      orderBy: { createdAt: 'asc' },
    });
    return bindings.map((b) => ({
      id: b.id,
      roleId: b.roleId,
      role: {
        id: b.role.id,
        code: b.role.code,
        name: b.role.name,
        type: b.role.type,
      },
    }));
  }

  /**
   * 覆盖式分配用户角色。
   */
  async assignUserRoles(
    userId: string,
    dto: AssignUserRolesDto,
    actorId: string,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) {
      throw new BusinessException('USER_NOT_FOUND', '用户不存在', 404);
    }
    if (dto.bindings.length > 0) {
      const roleIds = [...new Set(dto.bindings.map((b) => b.roleId))];
      const roles = await this.prisma.role.findMany({
        where: { id: { in: roleIds }, deletedAt: null },
      });
      if (roles.length !== roleIds.length) {
        throw new BusinessException('ROLE_NOT_FOUND', '存在无效角色');
      }
      const invalid = roles.filter(
        (role) => !this.isBuiltinRole(role.code),
      );
      if (invalid.length > 0) {
        throw new BusinessException(
          'ROLE_NOT_ASSIGNABLE',
          '仅支持分配平台管理员或普通用户',
        );
      }
    }
    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      ...(dto.bindings.length
        ? [
            this.prisma.userRole.createMany({
              data: dto.bindings.map((b) => ({
                userId,
                roleId: b.roleId,
              })),
            }),
          ]
        : []),
    ]);
    await this.auditLogWriter.write({
      actorId,
      action: 'assign',
      resourceType: 'user_role',
      resourceId: userId,
      detail: { count: dto.bindings.length },
    });
  }

  /**
   * 角色详情（含权限与数据范围）。
   */
  async getRoleDetail(id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null },
      include: {
        dataScope: true,
        rolePermissions: { include: { permission: true } },
      },
    });
    if (!role) {
      throw new BusinessException('ROLE_NOT_FOUND', '角色不存在', 404);
    }
    return {
      ...role,
      permissionIds: role.rolePermissions.map((rp) => rp.permissionId),
      permissions: role.rolePermissions.map((rp) => rp.permission),
    };
  }

  /**
   * 角色权限总览。
   */
  async getRbacOverview() {
    const roles = await this.prisma.role.findMany({
      where: {
        deletedAt: null,
        code: { in: [...BUILTIN_ROLE_CODES] },
      },
      include: { _count: { select: { userRoles: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const roleMap = new Map(roles.map((r) => [r.code, r]));
    const matrixState = await this.buildMatrixFromRoles(roles);

    return {
      roles: BUILTIN_ROLE_CODES.map((code) => {
        const role = roleMap.get(code);
        const meta = ROLE_DISPLAY_TAGS[code];
        return {
          id: role?.id ?? '',
          code,
          name: role?.name ?? code,
          description: role?.description ?? '',
          status: role?.status ?? CommonStatus.disabled,
          userCount: role?._count.userRoles ?? 0,
          tags: meta.tags,
          tagColor: meta.tagColor,
          builtin: true,
        };
      }),
      matrix: PERMISSION_MATRIX_MODULES.map((mod) => ({
        key: mod.key,
        module: mod.title,
        virtual: !!mod.virtual,
        platform_admin: matrixState[mod.key]?.platform_admin ?? false,
        regular_user: matrixState[mod.key]?.regular_user ?? false,
      })),
    };
  }

  /**
   * 保存权限矩阵。
   */
  async savePermissionMatrix(dto: SavePermissionMatrixDto, actorId: string) {
    const matrix = this.rowsToMatrixMap(dto.rows);
    const roles = await this.prisma.role.findMany({
      where: {
        deletedAt: null,
        code: { in: [...BUILTIN_ROLE_CODES] },
      },
    });
    const roleByCode = new Map(roles.map((r) => [r.code, r]));
    const permissions = await this.prisma.permission.findMany({
      where: { deletedAt: null },
    });
    const permCodeToId = new Map(permissions.map((p) => [p.code, p.id]));

    await this.prisma.$transaction(async (tx) => {
      for (const code of BUILTIN_ROLE_CODES) {
        const role = roleByCode.get(code);
        if (!role) continue;
        const codes = collectPermissionCodesForRole(code, matrix);
        const permissionIds = codes
          .map((c) => permCodeToId.get(c))
          .filter((id): id is string => !!id);

        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        if (permissionIds.length) {
          await tx.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({
              roleId: role.id,
              permissionId,
            })),
          });
        }

        if (code === 'platform_admin') {
          await tx.dataScope.upsert({
            where: { roleId: role.id },
            update: { scopeType: 'all' },
            create: { roleId: role.id, scopeType: 'all' },
          });
        } else {
          await tx.dataScope.upsert({
            where: { roleId: role.id },
            update: { scopeType: 'self' },
            create: { roleId: role.id, scopeType: 'self' },
          });
        }
      }
    });

    await this.auditLogWriter.write({
      actorId,
      action: 'update',
      resourceType: 'permission_matrix',
      detail: { rows: dto.rows.length },
    });

    return this.getRbacOverview();
  }

  /**
   * 恢复默认权限矩阵。
   */
  async resetPermissionMatrix(actorId: string) {
    const rows = PERMISSION_MATRIX_MODULES.map((mod) => ({
      key: mod.key,
      platform_admin: DEFAULT_PERMISSION_MATRIX[mod.key].platform_admin,
      regular_user: DEFAULT_PERMISSION_MATRIX[mod.key].regular_user,
    }));
    return this.savePermissionMatrix({ rows }, actorId);
  }

  /**
   * 查询角色成员。
   */
  async getRoleMembers(roleId: string) {
    await this.ensureRole(roleId);
    const bindings = await this.prisma.userRole.findMany({
      where: { roleId },
      include: {
        user: { include: { profile: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return bindings.map((b) => ({
      id: b.user.id,
      username: b.user.username,
      displayName: b.user.profile?.displayName ?? null,
      status: b.user.status,
    }));
  }

  /**
   * 更新角色启用状态。
   */
  async updateRoleStatus(
    id: string,
    dto: UpdateRoleStatusDto,
    actorId: string,
  ) {
    const role = await this.ensureRole(id);
    if (this.isBuiltinRole(role.code) && role.code === 'platform_admin') {
      throw new BusinessException(
        'ROLE_ADMIN_REQUIRED',
        '平台管理员不可停用',
      );
    }
    const updated = await this.prisma.role.update({
      where: { id },
      data: { status: dto.status },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'update',
      resourceType: 'role_status',
      resourceId: id,
      detail: { status: dto.status },
    });
    return updated;
  }

  /**
   * 权限菜单树。
   */
  async permissionTree() {
    const rows = await this.prisma.permission.findMany({
      where: { deletedAt: null },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    type Node = (typeof rows)[number] & { children: Node[] };
    const map = new Map<string, Node>();
    rows.forEach((r) => map.set(r.id, { ...r, children: [] }));
    const roots: Node[] = [];
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  /**
   * 确保角色存在。
   */
  private async ensureRole(id: string) {
    const role = await this.prisma.role.findFirst({
      where: { id, deletedAt: null },
    });
    if (!role) {
      throw new BusinessException('ROLE_NOT_FOUND', '角色不存在', 404);
    }
    return role;
  }

  private isBuiltinRole(code: string) {
    return (BUILTIN_ROLE_CODES as readonly string[]).includes(code);
  }

  private rowsToMatrixMap(
    rows: SavePermissionMatrixDto['rows'],
  ): Record<string, Record<BuiltinRoleCode, boolean>> {
    const matrix: Record<string, Record<BuiltinRoleCode, boolean>> = {};
    for (const row of rows) {
      matrix[row.key] = {
        platform_admin: row.platform_admin,
        regular_user: row.regular_user,
      };
    }
    for (const mod of PERMISSION_MATRIX_MODULES) {
      if (!matrix[mod.key]) {
        matrix[mod.key] = { ...DEFAULT_PERMISSION_MATRIX[mod.key] };
      }
    }
    return matrix;
  }

  private async buildMatrixFromRoles(
    roles: Array<{
      code: string;
      rolePermissions?: Array<{ permission: { code: string } }>;
    }>,
  ) {
    const rolePermCodes = new Map<string, Set<string>>();
    for (const role of roles) {
      const detail = await this.prisma.role.findFirst({
        where: { code: role.code, deletedAt: null },
        include: { rolePermissions: { include: { permission: true } } },
      });
      rolePermCodes.set(
        role.code,
        new Set(
          detail?.rolePermissions.map((rp) => rp.permission.code) ?? [],
        ),
      );
    }

    const matrix: Record<string, Record<BuiltinRoleCode, boolean>> = {};
    for (const mod of PERMISSION_MATRIX_MODULES) {
      matrix[mod.key] = {
        platform_admin: false,
        regular_user: false,
      };
      if (mod.virtual) {
        for (const code of BUILTIN_ROLE_CODES) {
          matrix[mod.key][code] = true;
        }
        continue;
      }
      for (const code of BUILTIN_ROLE_CODES) {
        const codes = rolePermCodes.get(code) ?? new Set<string>();
        const required = mod.codes ?? [];
        matrix[mod.key][code] =
          required.length > 0 && required.every((c) => codes.has(c));
      }
    }
    return matrix;
  }
}
