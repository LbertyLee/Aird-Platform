import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
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
import { AuthUserContext } from '../../common/types/auth-user.context';
import { OkResponseDto } from '../../common/dto/swagger.dto';
import {
  CreateIndicatorSourceMappingDto,
  UpdateIndicatorSourceMappingDto,
} from './dto/indicator-source-mapping.dto';
import { IndicatorSourceMappingViewDto } from './dto/indicator-source-mapping-response.dto';
import {
  CreateIndicatorDto,
  BatchDeleteIndicatorsDto,
  IndicatorPageQueryDto,
  UpdateIndicatorDto,
} from './dto/indicator.dto';
import {
  IndicatorPageResultDto,
  IndicatorViewDto,
} from './dto/indicator-response.dto';
import { IndicatorService } from './indicator.service';

/**
 * 标准指标库 HTTP 入口。
 */
@ApiTags('管理端-指标库')
@ApiBearerAuth()
@Controller('admin/indicators')
export class IndicatorController {
  /**
   * @param service 指标服务
   */
  constructor(private readonly service: IndicatorService) {}

  @Post()
  @RequirePermissions('button:data:indicator:create')
  @ApiOperation({ summary: '创建指标' })
  @ApiCreatedResponse({ type: IndicatorViewDto, description: '创建成功的指标' })
  create(
    @Body() dto: CreateIndicatorDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.create(dto, user.userId);
  }

  @Post('batch-delete')
  @RequirePermissions('button:data:indicator:delete')
  @ApiOperation({ summary: '批量删除指标' })
  @ApiOkResponse({ type: OkResponseDto, description: '批量删除结果' })
  batchDelete(
    @Body() dto: BatchDeleteIndicatorsDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.batchRemove(dto.ids, user.userId);
  }

  @Get()
  @RequirePermissions('menu:data:indicator')
  @ApiOperation({ summary: '指标分页' })
  @ApiOkResponse({ type: IndicatorPageResultDto, description: '分页列表' })
  page(@Query() query: IndicatorPageQueryDto) {
    return this.service.page(query);
  }

  @Get(':id/source-mappings')
  @RequirePermissions('menu:data:indicator')
  @ApiOperation({ summary: '指标来源映射列表' })
  @ApiParam({ name: 'id', description: '指标 ID' })
  @ApiOkResponse({
    type: [IndicatorSourceMappingViewDto],
    description: '来源映射列表',
  })
  listSourceMappings(@Param('id') id: string) {
    return this.service.listSourceMappings(id);
  }

  @Post(':id/source-mappings')
  @RequirePermissions('button:data:indicator:update')
  @ApiOperation({ summary: '新增指标来源映射' })
  @ApiParam({ name: 'id', description: '指标 ID' })
  @ApiCreatedResponse({
    type: IndicatorSourceMappingViewDto,
    description: '新建的来源映射',
  })
  createSourceMapping(
    @Param('id') id: string,
    @Body() dto: CreateIndicatorSourceMappingDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.createSourceMapping(id, dto, user.userId);
  }

  @Put(':id/source-mappings/:mappingId')
  @RequirePermissions('button:data:indicator:update')
  @ApiOperation({ summary: '更新指标来源映射' })
  @ApiParam({ name: 'id', description: '指标 ID' })
  @ApiParam({ name: 'mappingId', description: '映射 ID' })
  @ApiOkResponse({
    type: IndicatorSourceMappingViewDto,
    description: '更新后的来源映射',
  })
  updateSourceMapping(
    @Param('id') id: string,
    @Param('mappingId') mappingId: string,
    @Body() dto: UpdateIndicatorSourceMappingDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.updateSourceMapping(id, mappingId, dto, user.userId);
  }

  @Delete(':id/source-mappings/:mappingId')
  @RequirePermissions('button:data:indicator:update')
  @ApiOperation({ summary: '移除指标来源映射' })
  @ApiParam({ name: 'id', description: '指标 ID' })
  @ApiParam({ name: 'mappingId', description: '映射 ID' })
  @ApiOkResponse({ type: OkResponseDto, description: '已移除' })
  removeSourceMapping(
    @Param('id') id: string,
    @Param('mappingId') mappingId: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.removeSourceMapping(id, mappingId, user.userId);
  }

  @Get(':id')
  @RequirePermissions('menu:data:indicator')
  @ApiOperation({ summary: '指标详情' })
  @ApiParam({ name: 'id', description: '指标 ID' })
  @ApiOkResponse({ type: IndicatorViewDto, description: '指标详情' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Put(':id')
  @RequirePermissions('button:data:indicator:update')
  @ApiOperation({ summary: '更新指标' })
  @ApiParam({ name: 'id', description: '指标 ID' })
  @ApiOkResponse({ type: IndicatorViewDto, description: '更新后的指标' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIndicatorDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.update(id, dto, user.userId);
  }

  @Delete(':id')
  @RequirePermissions('button:data:indicator:delete')
  @ApiOperation({ summary: '删除指标' })
  @ApiParam({ name: 'id', description: '指标 ID' })
  @ApiOkResponse({ type: OkResponseDto, description: '已删除' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.batchRemove([id], user.userId);
  }
}
