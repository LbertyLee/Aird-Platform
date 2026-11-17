import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  DashboardAggregateResultDto,
  DashboardService,
  DashboardTrendsDto,
  PlatformOverviewDto,
} from './dashboard.service';
import {
  DashboardAggregateBodyDto,
  DashboardRangeQueryDto,
} from './dto/dashboard.dto';

/**
 * 运营看板 HTTP 入口。
 */
@ApiTags('管理端-运营看板')
@ApiBearerAuth()
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /**
   * 平台总览（支持时间范围与时区）。
   */
  @Get('overview')
  @RequirePermissions('menu:dashboard')
  @ApiOperation({ summary: '平台运营总览' })
  @ApiOkResponse({ type: PlatformOverviewDto, description: '平台运营总览指标' })
  overview(@Query() query: DashboardRangeQueryDto) {
    return this.dashboardService.getPlatformOverview(query);
  }

  /**
   * 用户量 / 检索量日趋势。
   */
  @Get('trends')
  @RequirePermissions('menu:dashboard')
  @ApiOperation({ summary: '运营看板日趋势' })
  @ApiOkResponse({ type: DashboardTrendsDto, description: '日趋势序列' })
  trends(@Query() query: DashboardRangeQueryDto) {
    return this.dashboardService.getTrends(query);
  }

  /**
   * 手动触发区间聚合（刷新快照并清缓存）。
   */
  @Post('aggregate')
  @RequirePermissions('menu:dashboard')
  @ApiOperation({ summary: '刷新运营看板日聚合' })
  @ApiOkResponse({
    type: DashboardAggregateResultDto,
    description: '聚合写入结果',
  })
  aggregate(@Body() body: DashboardAggregateBodyDto) {
    return this.dashboardService.refreshAggregate(body);
  }
}
