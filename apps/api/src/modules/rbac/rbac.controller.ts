import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuthUserContext } from '../../common/types/auth-user.context';
import {
  AssignUserRolesDto,
  BatchDeleteRolesDto,
  CreateRoleDto,
  ReplacePermissionsDto,
  RolePageQueryDto,
  SavePermissionMatrixDto,
  SetDataScopeDto,
  UpdateRoleDto,
  UpdateRoleStatusDto,
} from './dto/rbac.dto';
import { RbacService } from './rbac.service';

/**
 * 角色权限 HTTP 入口。
 */
@ApiTags('管理端-权限')
@ApiBearerAuth()
@Controller('admin')
export class RbacController {
  /**
   * @param rbacService RBAC 服务
   */
  constructor(private readonly rbacService: RbacService) {}

  /**
   * 角色权限总览（内置角色卡片 + 权限矩阵）。
   */
  @Get('rbac/overview')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '角色权限总览' })
  rbacOverview() {
    return this.rbacService.getRbacOverview();
  }

  /**
   * 保存权限矩阵。
   */
  @Put('rbac/permission-matrix')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '保存权限矩阵' })
  savePermissionMatrix(
    @Body() dto: SavePermissionMatrixDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.rbacService.savePermissionMatrix(dto, user.userId);
  }

  /**
   * 恢复默认权限矩阵。
   */
  @Post('rbac/permission-matrix/reset')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '恢复默认权限矩阵' })
  resetPermissionMatrix(@CurrentUser() user: AuthUserContext) {
    return this.rbacService.resetPermissionMatrix(user.userId);
  }

  /**
   * 查询角色成员。
   */
  @Get('roles/:id/members')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '角色成员列表' })
  roleMembers(@Param('id') id: string) {
    return this.rbacService.getRoleMembers(id);
  }

  /**
   * 更新角色启用状态。
   */
  @Patch('roles/:id/status')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '更新角色状态' })
  updateRoleStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRoleStatusDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.rbacService.updateRoleStatus(id, dto, user.userId);
  }

  /**
   * 创建自定义角色。
   */
  @Post('roles')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '创建角色' })
  createRole(@Body() dto: CreateRoleDto, @CurrentUser() user: AuthUserContext) {
    return this.rbacService.createRole(dto, user.userId);
  }

  /**
   * 角色分页。
   */
  @Get('roles')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '角色分页' })
  pageRoles(@Query() query: RolePageQueryDto) {
    return this.rbacService.pageRoles(query);
  }

  /**
   * 角色详情。
   */
  @Get('roles/:id')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '角色详情' })
  roleDetail(@Param('id') id: string) {
    return this.rbacService.getRoleDetail(id);
  }

  /**
   * 更新角色。
   */
  @Put('roles/:id')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '更新角色' })
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.rbacService.updateRole(id, dto, user.userId);
  }

  /**
   * 批量删除自定义角色。
   */
  @Post('roles/batch-delete')
  @RequirePermissions('button:rbac:role:delete')
  @ApiOperation({ summary: '批量删除角色' })
  batchDeleteRoles(
    @Body() dto: BatchDeleteRolesDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.rbacService.batchDeleteRoles(dto.ids, user.userId);
  }

  /**
   * 删除角色。
   */
  @Delete('roles/:id')
  @RequirePermissions('button:rbac:role:delete')
  @ApiOperation({ summary: '删除角色' })
  deleteRole(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.rbacService.deleteRole(id, user.userId);
  }

  /**
   * 覆盖式绑定权限。
   */
  @Put('roles/:id/permissions')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '配置角色权限' })
  replacePermissions(
    @Param('id') id: string,
    @Body() dto: ReplacePermissionsDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.rbacService.replacePermissions(id, dto, user.userId);
  }

  /**
   * 配置数据范围。
   */
  @Put('roles/:id/data-scope')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '配置数据范围' })
  setDataScope(
    @Param('id') id: string,
    @Body() dto: SetDataScopeDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.rbacService.setDataScope(id, dto, user.userId);
  }

  /**
   * 查询用户角色绑定。
   */
  @Get('users/:userId/roles')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '查询用户角色' })
  getUserRoles(@Param('userId') userId: string) {
    return this.rbacService.getUserRoles(userId);
  }

  /**
   * 给用户分配角色。
   */
  @Put('users/:userId/roles')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '分配用户角色' })
  assignUserRoles(
    @Param('userId') userId: string,
    @Body() dto: AssignUserRolesDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.rbacService.assignUserRoles(userId, dto, user.userId);
  }

  /**
   * 权限树。
   */
  @Get('permissions/tree')
  @RequirePermissions('menu:rbac:role')
  @ApiOperation({ summary: '权限树' })
  permissionTree() {
    return this.rbacService.permissionTree();
  }
}
