import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PageResultDto } from '../../common/dto/page.dto';
import { OperLogPageQueryDto } from './dto/oper-log.dto';
import { OperLogService, type OperLogView } from './oper-log.service';

/**
 * 操作日志查询 HTTP 入口。
 */
@ApiTags('管理端-操作日志')
@ApiBearerAuth()
@Controller('admin/oper-logs')
export class OperLogController {
  /**
   * @param operLogService 操作日志服务
   */
  constructor(private readonly operLogService: OperLogService) {}

  /**
   * 分页查询操作日志。
   */
  @Get()
  @RequirePermissions('menu:oper:log')
  @ApiOperation({ summary: '分页查询操作日志' })
  @ApiOkResponse({ description: '操作日志分页结果' })
  page(@Query() query: OperLogPageQueryDto): Promise<PageResultDto<OperLogView>> {
    return this.operLogService.page(query);
  }

  /**
   * 查询单条操作日志详情。
   */
  @Get(':id')
  @RequirePermissions('menu:oper:log')
  @ApiOperation({ summary: '操作日志详情' })
  @ApiParam({ name: 'id', description: '日志 ID' })
  @ApiOkResponse({ description: '操作日志详情' })
  async detail(@Param('id') id: string): Promise<OperLogView> {
    const row = await this.operLogService.detail(id);
    if (!row) {
      throw new NotFoundException('操作日志不存在');
    }
    return row;
  }
}
