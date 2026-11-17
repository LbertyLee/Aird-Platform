import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PageResultDto } from '../../common/dto/page.dto';
import { AuthUserContext } from '../../common/types/auth-user.context';
import { AnnouncementService } from './announcement.service';
import {
  AnnouncementListResultDto,
  AnnouncementViewDto,
  BusinessNotificationViewDto,
} from './dto/operation-response.dto';
import {
  AnnouncementPageQueryDto,
  CreateAnnouncementDto,
  NotificationPageQueryDto,
  UpsertAnnouncementDto,
} from './dto/operation.dto';

/**
 * 消息公告与业务通知 HTTP 入口。
 */
@ApiTags('管理端-运营管理-消息公告')
@ApiBearerAuth()
@Controller('admin/operation')
export class AnnouncementController {
  constructor(private readonly service: AnnouncementService) {}

  @Get('announcements')
  @RequirePermissions('menu:operation:announcement')
  @ApiOperation({ summary: '公告分页列表' })
  @ApiOkResponse({ type: AnnouncementListResultDto })
  pageAnnouncements(@Query() query: AnnouncementPageQueryDto) {
    return this.service.pageAnnouncements(query);
  }

  @Post('announcements')
  @RequirePermissions('button:operation:announcement:create')
  @ApiOperation({ summary: '新增公告' })
  @ApiCreatedResponse({ type: AnnouncementViewDto })
  create(
    @Body() dto: CreateAnnouncementDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.create(dto, user.userId);
  }

  @Put('announcements/:id')
  @RequirePermissions('button:operation:announcement:update')
  @ApiOperation({ summary: '编辑公告' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: AnnouncementViewDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpsertAnnouncementDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.update(id, dto, user.userId);
  }

  @Post('announcements/:id/publish')
  @RequirePermissions('button:operation:announcement:publish')
  @ApiOperation({ summary: '发布公告' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: AnnouncementViewDto })
  publish(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.publish(id, user.userId);
  }

  @Post('announcements/:id/recall')
  @RequirePermissions('button:operation:announcement:publish')
  @ApiOperation({ summary: '撤回公告' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: AnnouncementViewDto })
  recall(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.recall(id, user.userId);
  }

  @Post('announcements/:id/republish')
  @RequirePermissions('button:operation:announcement:publish')
  @ApiOperation({ summary: '重新发布公告' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: AnnouncementViewDto })
  republish(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.republish(id, user.userId);
  }

  @Get('notifications')
  @RequirePermissions('menu:operation:announcement')
  @ApiOperation({ summary: '业务通知分页' })
  @ApiOkResponse({ description: '业务通知分页结果' })
  pageNotifications(
    @Query() query: NotificationPageQueryDto,
  ): Promise<PageResultDto<BusinessNotificationViewDto>> {
    return this.service.pageNotifications(query);
  }


  @Post('notifications/:id/read')
  @RequirePermissions('menu:operation:announcement')
  @ApiOperation({ summary: '标记通知已读' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: BusinessNotificationViewDto })
  markRead(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.markRead(id, user.userId);
  }

  @Post('notifications/:id/resend')
  @RequirePermissions('menu:operation:announcement')
  @ApiOperation({ summary: '重发通知' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: BusinessNotificationViewDto })
  resend(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.resend(id, user.userId);
  }
}

/** 用户端消息中心，只返回当前用户有权看到的内容。 */
@ApiTags('用户端-消息中心')
@ApiBearerAuth()
@Controller('user/operation')
export class UserAnnouncementController {
  constructor(private readonly service: AnnouncementService) {}

  @Get('announcements')
  @ApiOperation({ summary: '用户端公告分页' })
  @ApiOkResponse({ type: AnnouncementListResultDto })
  pageAnnouncements(
    @Query() query: AnnouncementPageQueryDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.pageUserAnnouncements(query, user);
  }

  @Get('notifications')
  @ApiOperation({ summary: '当前用户通知分页' })
  @ApiOkResponse({ description: '当前用户通知分页结果' })
  pageNotifications(
    @Query() query: NotificationPageQueryDto,
    @CurrentUser() user: AuthUserContext,
  ): Promise<PageResultDto<BusinessNotificationViewDto>> {
    return this.service.pageUserNotifications(query, user.userId);
  }

  @Post('notifications/read-all')
  @ApiOperation({ summary: '用户端一键标记全部通知已读' })
  @ApiOkResponse({ description: '返回标记数量' })
  markAllRead(@CurrentUser() user: AuthUserContext) {
    return this.service.markAllRead(user.userId);
  }

  @Post('notifications/:id/read')
  @ApiOperation({ summary: '用户端标记通知已读' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: BusinessNotificationViewDto })
  markRead(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.markRead(id, user.userId, true);
  }
}
