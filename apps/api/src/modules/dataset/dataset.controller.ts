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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuthUserContext } from '../../common/types/auth-user.context';
import { OkResponseDto } from '../../common/dto/swagger.dto';
import {
  CreateDatasetDto,
  BatchDeleteDatasetsDto,
  DatasetPageQueryDto,
  UpdateDatasetDto,
} from './dto/dataset.dto';
import {
  DatasetFilePreviewDto,
  DatasetPageResultDto,
  DatasetStatsDto,
  DatasetViewDto,
} from './dto/dataset-response.dto';
import { DatasetService } from './dataset.service';
import { MAX_DATASET_FILE_SIZE } from './dataset-file-preview';

/**
 * 数据集 / 来源管理 HTTP 入口。
 */
@ApiTags('管理端-来源')
@ApiBearerAuth()
@Controller('admin/datasets')
export class DatasetController {
  /**
   * @param service 数据集服务
   */
  constructor(private readonly service: DatasetService) {}

  @Post()
  @RequirePermissions('button:data:dataset:create')
  @ApiOperation({ summary: '创建来源' })
  @ApiCreatedResponse({ type: DatasetViewDto, description: '创建成功的来源' })
  create(@Body() dto: CreateDatasetDto, @CurrentUser() user: AuthUserContext) {
    return this.service.create(dto, user.userId);
  }

  @Get('stats')
  @RequirePermissions('menu:data:dataset')
  @ApiOperation({ summary: '来源统计' })
  @ApiOkResponse({ type: DatasetStatsDto, description: '分类与启用统计' })
  stats() {
    return this.service.stats();
  }

  @Get()
  @RequirePermissions('menu:data:dataset')
  @ApiOperation({ summary: '来源分页' })
  @ApiOkResponse({ type: DatasetPageResultDto, description: '分页列表' })
  page(@Query() query: DatasetPageQueryDto) {
    return this.service.page(query);
  }

  @Post('batch-delete')
  @RequirePermissions('button:data:dataset:delete')
  @ApiOperation({ summary: '批量删除来源' })
  @ApiOkResponse({ type: OkResponseDto, description: '批量删除结果' })
  batchDelete(
    @Body() dto: BatchDeleteDatasetsDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.batchRemove(dto.ids, user.userId);
  }

  @Get(':id')
  @RequirePermissions('menu:data:dataset')
  @ApiOperation({ summary: '数据集详情' })
  @ApiParam({ name: 'id', description: '数据集 ID' })
  @ApiOkResponse({ type: DatasetViewDto, description: '数据集详情' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Get(':id/preview')
  @RequirePermissions('menu:data:dataset')
  @ApiOperation({ summary: '预览数据集文件' })
  @ApiParam({ name: 'id', description: '数据集 ID' })
  @ApiOkResponse({ type: DatasetFilePreviewDto, description: '文件预览内容' })
  preview(@Param('id') id: string) {
    return this.service.preview(id);
  }

  @Get(':id/file')
  @RequirePermissions('menu:data:dataset')
  @ApiOperation({ summary: '读取数据集原始文件' })
  @ApiParam({ name: 'id', description: '数据集 ID' })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({ description: '文件二进制流' })
  async file(@Param('id') id: string): Promise<StreamableFile> {
    const file = await this.service.file(id);
    const encodedName = encodeURIComponent(file.fileName).replace(/'/g, '%27');
    return new StreamableFile(file.buffer, {
      type: file.mimeType,
      disposition: `inline; filename*=UTF-8''${encodedName}`,
      length: file.buffer.length,
    });
  }

  @Put(':id')
  @RequirePermissions('button:data:dataset:update')
  @ApiOperation({ summary: '更新数据集' })
  @ApiParam({ name: 'id', description: '数据集 ID' })
  @ApiOkResponse({ type: DatasetViewDto, description: '更新后的数据集' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDatasetDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.update(id, dto, user.userId);
  }

  @Delete(':id')
  @RequirePermissions('button:data:dataset:delete')
  @ApiOperation({ summary: '删除来源' })
  @ApiParam({ name: 'id', description: '来源 ID' })
  @ApiOkResponse({ type: OkResponseDto, description: '已删除' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.batchRemove([id], user.userId);
  }

  @Patch(':id/publish')
  @RequirePermissions('button:data:dataset:publish')
  @ApiOperation({ summary: '上架数据集' })
  @ApiParam({ name: 'id', description: '数据集 ID' })
  @ApiOkResponse({ type: DatasetViewDto, description: '上架后的数据集' })
  publish(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.publish(id, user.userId);
  }

  @Patch(':id/unpublish')
  @RequirePermissions('button:data:dataset:publish')
  @ApiOperation({ summary: '下架数据集' })
  @ApiParam({ name: 'id', description: '数据集 ID' })
  @ApiOkResponse({ type: DatasetViewDto, description: '下架后的数据集' })
  unpublish(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.unpublish(id, user.userId);
  }

  @Post(':id/upload')
  @RequirePermissions('button:data:dataset:upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DATASET_FILE_SIZE },
      // multer@2.1+：按 UTF-8 解析上传文件名，避免中文乱码
      defParamCharset: 'utf8',
    } as Parameters<typeof FileInterceptor>[1]),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: '上传数据集文件（支持 PDF/CSV/XLSX/DOCX/TXT/MD/JSON）',
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: '数据集文件',
        },
      },
    },
  })
  @ApiOperation({ summary: '上传数据集文件到 MinIO' })
  @ApiParam({ name: 'id', description: '数据集 ID' })
  @ApiOkResponse({ type: DatasetViewDto, description: '上传后的数据集' })
  upload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.upload(id, file, user.userId);
  }

  @Post(':id/auto-link')
  @RequirePermissions('button:data:dataset:update')
  @ApiOperation({
    summary: '根据文档内容自动识别并关联指标/字典（保留手动关联）',
  })
  @ApiParam({ name: 'id', description: '数据集 ID' })
  @ApiOkResponse({ type: DatasetViewDto, description: '更新后的数据集' })
  autoLink(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.autoLinkFromContent(id, user.userId);
  }
}
