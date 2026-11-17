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
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuthUserContext } from '../../common/types/auth-user.context';
import { CreateUserDto, BatchDeleteUsersDto, UpdateUserDto, UserPageQueryDto } from './dto/user.dto';
import {
  CreateUserResponseDto,
  ResetPasswordResponseDto,
  UserPageResultDto,
  UserViewDto,
} from './dto/user-response.dto';
import { UserService } from './user.service';

/**
 * 用户管理 HTTP 入口。
 */
@ApiTags('管理端-用户')
@ApiBearerAuth()
@Controller('admin/users')
export class UserController {
  /**
   * @param userService 用户服务
   */
  constructor(private readonly userService: UserService) {}

  /**
   * 新增用户。
   */
  @Post()
  @RequirePermissions('button:user:create')
  @ApiOperation({ summary: '创建用户' })
  @ApiCreatedResponse({
    type: CreateUserResponseDto,
    description: '创建成功；未传密码时返回 tempPassword',
  })
  create(@Body() dto: CreateUserDto, @CurrentUser() user: AuthUserContext) {
    return this.userService.create(dto, user.userId);
  }

  /**
   * 批量删除用户（软删除）。
   */
  @Post('batch-delete')
  @RequirePermissions('button:user:delete')
  @ApiOperation({ summary: '批量删除用户' })
  batchDeleteUsers(
    @Body() dto: BatchDeleteUsersDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.userService.batchDeleteUsers(dto.ids, user.userId);
  }

  /**
   * 导出用户 CSV（按当前筛选条件）。须放在 :id 路由之前。
   */
  @Get('export')
  @RequirePermissions('export:user')
  @ApiOperation({ summary: '导出用户 CSV' })
  @ApiProduces('text/csv')
  @ApiOkResponse({ description: 'CSV 文件流（带 BOM）' })
  async exportUsers(
    @Query() query: UserPageQueryDto,
    @CurrentUser() user: AuthUserContext,
  ): Promise<StreamableFile> {
    const csv = await this.userService.exportToCsv(query, user.userId);
    const filename = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    return new StreamableFile(Buffer.from(`\uFEFF${csv}`, 'utf-8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  /**
   * 分页查询。
   */
  @Get()
  @RequirePermissions('menu:user')
  @ApiOperation({ summary: '用户分页' })
  @ApiOkResponse({ type: UserPageResultDto, description: '用户分页列表' })
  page(@Query() query: UserPageQueryDto) {
    return this.userService.page(query);
  }

  @Get('role-options')
  @RequirePermissions('menu:user')
  @ApiOperation({ summary: '用户筛选可用角色' })
  roleOptions() {
    return this.userService.roleOptions();
  }

  /**
   * 编辑资料。
   */
  @Put(':id')
  @RequirePermissions('button:user:update')
  @ApiOperation({ summary: '更新用户' })
  @ApiParam({ name: 'id', description: '用户 ID' })
  @ApiOkResponse({ type: UserViewDto, description: '更新后的用户' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.userService.update(id, dto, user.userId);
  }

  /**
   * 禁用账号。
   */
  @Patch(':id/disable')
  @RequirePermissions('button:user:disable')
  @ApiOperation({ summary: '禁用用户' })
  @ApiParam({ name: 'id', description: '用户 ID' })
  @ApiOkResponse({ type: UserViewDto, description: '禁用后的用户' })
  disable(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.userService.disable(id, user.userId);
  }

  /**
   * 启用账号。
   */
  @Patch(':id/enable')
  @RequirePermissions('button:user:disable')
  @ApiOperation({ summary: '启用用户' })
  @ApiParam({ name: 'id', description: '用户 ID' })
  @ApiOkResponse({ type: UserViewDto, description: '启用后的用户' })
  enable(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.userService.enable(id, user.userId);
  }

  /**
   * 重置密码。
   */
  @Post(':id/reset-password')
  @RequirePermissions('button:user:reset_password')
  @ApiOperation({ summary: '重置密码' })
  @ApiParam({ name: 'id', description: '用户 ID' })
  @ApiOkResponse({
    type: ResetPasswordResponseDto,
    description: '新的临时密码',
  })
  resetPassword(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.userService.resetPassword(id, user.userId);
  }

  /**
   * 删除用户（软删除）。
   */
  @Delete(':id')
  @RequirePermissions('button:user:delete')
  @ApiOperation({ summary: '删除用户' })
  @ApiParam({ name: 'id', description: '用户 ID' })
  deleteUser(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.userService.batchDeleteUsers([id], user.userId);
  }
}
