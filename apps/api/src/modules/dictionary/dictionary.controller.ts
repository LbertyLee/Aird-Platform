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
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuthUserContext } from '../../common/types/auth-user.context';
import { OkResponseDto } from '../../common/dto/swagger.dto';
import {
  BatchDeleteDictionariesDto,
  CreateDictionaryDto,
  CreateDictionaryTypeDto,
  DictionaryPageQueryDto,
  DictionarySearchDto,
  DictionaryTypeQueryDto,
  UpdateDictionaryDto,
  UpdateDictionaryTypeDto,
} from './dto/dictionary.dto';
import {
  DictionaryPageResultDto,
  DictionarySearchHitDto,
  DictionaryTypeViewDto,
  DictionaryViewDto,
} from './dto/dictionary-response.dto';
import { DictionaryService } from './dictionary.service';

/**
 * 基础字典库 HTTP 入口。
 */
@ApiTags('管理端-字典')
@ApiBearerAuth()
@Controller('admin/dictionaries')
export class DictionaryController {
  /**
   * @param service 字典服务
   */
  constructor(private readonly service: DictionaryService) {}

  @Public()
  @Get('public/legal-documents')
  @ApiOperation({ summary: '用户端注册协议及版本信息' })
  @ApiOkResponse({ description: '公开的用户协议与隐私政策内容' })
  publicLegalDocuments() {
    return this.service.publicLegalDocuments();
  }

  @Get('types')
  @RequirePermissions('menu:data:dict')
  @ApiOperation({ summary: '字典类型列表' })
  @ApiOkResponse({
    type: [DictionaryTypeViewDto],
    description: '字典类型列表',
  })
  listTypes(@Query() query: DictionaryTypeQueryDto) {
    return this.service.listTypes(query);
  }

  @Post('types')
  @RequirePermissions('button:data:dict:create')
  @ApiOperation({ summary: '创建字典类型' })
  @ApiCreatedResponse({
    type: DictionaryTypeViewDto,
    description: '创建成功的字典类型',
  })
  createType(
    @Body() dto: CreateDictionaryTypeDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.createType(dto, user.userId);
  }

  @Put('types/:id')
  @RequirePermissions('button:data:dict:update')
  @ApiOperation({ summary: '更新字典类型' })
  @ApiParam({ name: 'id', description: '字典类型 ID' })
  @ApiOkResponse({ type: DictionaryTypeViewDto, description: '更新后的类型' })
  updateType(
    @Param('id') id: string,
    @Body() dto: UpdateDictionaryTypeDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.updateType(id, dto, user.userId);
  }

  @Delete('types/:id')
  @RequirePermissions('button:data:dict:delete')
  @ApiOperation({ summary: '删除字典类型' })
  @ApiParam({ name: 'id', description: '字典类型 ID' })
  @ApiOkResponse({ type: OkResponseDto, description: '已删除' })
  removeType(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.removeType(id, user.userId);
  }

  @Post()
  @RequirePermissions('button:data:dict:create')
  @ApiOperation({ summary: '创建字典项' })
  @ApiCreatedResponse({
    type: DictionaryViewDto,
    description: '创建成功的字典项',
  })
  create(
    @Body() dto: CreateDictionaryDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.create(dto, user.userId);
  }

  @Post('batch-delete')
  @RequirePermissions('button:data:dict:delete')
  @ApiOperation({ summary: '批量删除字典项' })
  @ApiOkResponse({ type: OkResponseDto, description: '批量删除结果' })
  batchDelete(
    @Body() dto: BatchDeleteDictionariesDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.batchRemove(dto.ids, user.userId);
  }

  @Get()
  @RequirePermissions('menu:data:dict')
  @ApiOperation({ summary: '字典分页' })
  @ApiOkResponse({ type: DictionaryPageResultDto, description: '分页列表' })
  page(@Query() query: DictionaryPageQueryDto) {
    return this.service.page(query);
  }

  @Post('search')
  @RequirePermissions('menu:data:dict')
  @ApiOperation({ summary: '字典语义检索' })
  @ApiOkResponse({
    type: [DictionarySearchHitDto],
    description: '按相似度排序的命中列表',
  })
  search(@Body() dto: DictionarySearchDto) {
    return this.service.search(dto);
  }

  @Get(':id')
  @RequirePermissions('menu:data:dict')
  @ApiOperation({ summary: '字典详情' })
  @ApiParam({ name: 'id', description: '字典项 ID' })
  @ApiOkResponse({ type: DictionaryViewDto, description: '字典项详情' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Put(':id')
  @RequirePermissions('button:data:dict:update')
  @ApiOperation({ summary: '更新字典项' })
  @ApiParam({ name: 'id', description: '字典项 ID' })
  @ApiOkResponse({ type: DictionaryViewDto, description: '更新后的字典项' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDictionaryDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.update(id, dto, user.userId);
  }

  @Delete(':id')
  @RequirePermissions('button:data:dict:delete')
  @ApiOperation({ summary: '删除字典项' })
  @ApiParam({ name: 'id', description: '字典项 ID' })
  @ApiOkResponse({ type: OkResponseDto, description: '已删除' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.batchRemove([id], user.userId);
  }

  @Post(':id/reindex')
  @RequirePermissions('button:data:dict:update')
  @ApiOperation({ summary: '重新向量化字典项' })
  @ApiParam({ name: 'id', description: '字典项 ID' })
  @ApiOkResponse({ type: OkResponseDto, description: '已入队向量化' })
  reindex(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.reindex(id, user.userId);
  }
}
