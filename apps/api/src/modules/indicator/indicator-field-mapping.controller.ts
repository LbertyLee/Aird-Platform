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
import { OkResponseDto } from '../../common/dto/swagger.dto';
import { AuthUserContext } from '../../common/types/auth-user.context';
import {
  BatchDeleteFieldMappingsDto,
  BatchReviewFieldMappingsDto,
  CreateIndicatorFieldMappingDto,
  DatasetFieldOptionsQueryDto,
  FieldMappingPageQueryDto,
  ReapplyFieldMappingsDto,
  UpdateIndicatorFieldMappingDto,
} from './dto/indicator-field-mapping.dto';
import {
  DatasetFieldOptionDto,
  IndicatorFieldMappingViewDto,
  KnowledgeStructuredDatasetOptionDto,
} from './dto/indicator-field-mapping-response.dto';
import { IndicatorFieldMappingService } from './indicator-field-mapping.service';

/**
 * 指标字段映射（Semantic Layer）HTTP 入口。
 */
@ApiTags('管理端-字段映射')
@ApiBearerAuth()
@Controller('admin/field-mappings')
export class IndicatorFieldMappingController {
  constructor(private readonly service: IndicatorFieldMappingService) {}

  @Get()
  @RequirePermissions('menu:data:field-mapping')
  @ApiOperation({ summary: '字段映射分页' })
  @ApiOkResponse({ description: '分页列表' })
  page(@Query() query: FieldMappingPageQueryDto) {
    return this.service.page(query);
  }

  @Get('dataset-options')
  @RequirePermissions('menu:data:field-mapping')
  @ApiOperation({
    summary: '可选知识库结构化文件（学习完成且 READY）',
  })
  @ApiOkResponse({ type: [KnowledgeStructuredDatasetOptionDto] })
  datasetOptions(@Query('keyword') keyword?: string) {
    return this.service.listDatasetOptions(keyword);
  }

  @Get('field-options')
  @RequirePermissions('menu:data:field-mapping')
  @ApiOperation({ summary: '可选知识库结构化字段（READY 版本）' })
  @ApiOkResponse({ type: [DatasetFieldOptionDto] })
  fieldOptions(@Query() query: DatasetFieldOptionsQueryDto) {
    return this.service.listFieldOptions(query);
  }

  @Post('batch-accept')
  @RequirePermissions('button:data:field-mapping:update')
  @ApiOperation({ summary: '批量采纳自动待确认映射（并反哺别名）' })
  @ApiOkResponse({ type: OkResponseDto })
  batchAccept(
    @Body() dto: BatchReviewFieldMappingsDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.acceptPending(dto.ids, user.userId);
  }

  @Post('batch-dismiss')
  @RequirePermissions('button:data:field-mapping:delete')
  @ApiOperation({ summary: '批量忽略自动映射建议' })
  @ApiOkResponse({ type: OkResponseDto })
  batchDismiss(
    @Body() dto: BatchReviewFieldMappingsDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.dismissPending(dto.ids, user.userId);
  }

  @Post('reapply-auto')
  @RequirePermissions('button:data:field-mapping:create')
  @ApiOperation({ summary: '重新跑自动字段映射' })
  @ApiOkResponse({ description: '重跑结果汇总' })
  reapplyAuto(
    @Body() dto: ReapplyFieldMappingsDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.reapplyAuto(dto.datasetId, user.userId);
  }

  @Get(':id')
  @RequirePermissions('menu:data:field-mapping')
  @ApiOperation({ summary: '字段映射详情' })
  @ApiParam({ name: 'id', description: '映射 ID' })
  @ApiOkResponse({ type: IndicatorFieldMappingViewDto })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Post()
  @RequirePermissions('button:data:field-mapping:create')
  @ApiOperation({ summary: '创建字段映射' })
  @ApiCreatedResponse({ type: IndicatorFieldMappingViewDto })
  create(
    @Body() dto: CreateIndicatorFieldMappingDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.create(dto, user.userId);
  }

  @Post('batch-delete')
  @RequirePermissions('button:data:field-mapping:delete')
  @ApiOperation({ summary: '批量删除字段映射' })
  @ApiOkResponse({ type: OkResponseDto })
  batchDelete(
    @Body() dto: BatchDeleteFieldMappingsDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.batchRemove(dto.ids, user.userId);
  }

  @Put(':id')
  @RequirePermissions('button:data:field-mapping:update')
  @ApiOperation({ summary: '更新字段映射' })
  @ApiParam({ name: 'id', description: '映射 ID' })
  @ApiOkResponse({ type: IndicatorFieldMappingViewDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateIndicatorFieldMappingDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.update(id, dto, user.userId);
  }

  @Delete(':id')
  @RequirePermissions('button:data:field-mapping:delete')
  @ApiOperation({ summary: '删除字段映射' })
  @ApiParam({ name: 'id', description: '映射 ID' })
  @ApiOkResponse({ type: OkResponseDto })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.batchRemove([id], user.userId);
  }
}
