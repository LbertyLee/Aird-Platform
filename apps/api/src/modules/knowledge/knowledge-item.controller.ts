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
  ApiTags,
} from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { OkResponseDto } from '../../common/dto/swagger.dto';
import { AuthUserContext } from '../../common/types/auth-user.context';
import { MAX_DATASET_FILE_SIZE } from '../dataset/dataset-file-preview';
import {
  CreateKnowledgeItemDto,
  KnowledgeItemPageQueryDto,
  UpdateKnowledgeItemDto,
} from './dto/knowledge.dto';
import { KnowledgeItemViewDto } from './dto/knowledge-response.dto';
import { KnowledgeItemService } from './knowledge-item.service';

@ApiTags('管理端-知识条目')
@ApiBearerAuth()
@Controller('admin/knowledge/items')
export class KnowledgeItemController {
  constructor(private readonly service: KnowledgeItemService) {}

  @Post()
  @RequirePermissions('button:knowledge:item:create')
  @ApiOperation({ summary: '创建知识条目（自动审核）' })
  @ApiCreatedResponse({ type: KnowledgeItemViewDto })
  create(
    @Body() dto: CreateKnowledgeItemDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.create(dto, user.userId);
  }

  @Get()
  @RequirePermissions(
    'menu:knowledge:library|menu:knowledge:public-review',
  )
  @ApiOperation({ summary: '知识条目分页' })
  page(@Query() query: KnowledgeItemPageQueryDto) {
    return this.service.page(query);
  }

  @Get('statistics')
  @RequirePermissions(
    'menu:knowledge:library|menu:knowledge:public-review',
  )
  @ApiOperation({ summary: '知识条目全量统计' })
  statistics(@Query() query: KnowledgeItemPageQueryDto) {
    return this.service.statistics(query);
  }

  @Get(':id')
  @RequirePermissions(
    'menu:knowledge:library|menu:knowledge:public-review',
  )
  @ApiOperation({ summary: '知识条目详情' })
  @ApiOkResponse({ type: KnowledgeItemViewDto })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Get(':id/chunks')
  @RequirePermissions(
    'menu:knowledge:library|menu:knowledge:public-review',
  )
  @ApiOperation({ summary: '知识条目分段详情' })
  chunks(@Param('id') id: string) {
    return this.service.chunks(id);
  }

  @Get(':id/preview')
  @RequirePermissions(
    'menu:knowledge:library|menu:knowledge:public-review',
  )
  @ApiOperation({ summary: '知识条目文件预览' })
  preview(@Param('id') id: string) {
    return this.service.preview(id);
  }

  @Get(':id/file')
  @RequirePermissions(
    'menu:knowledge:library|menu:knowledge:public-review',
  )
  @ApiOperation({ summary: '下载知识条目文件' })
  async file(@Param('id') id: string) {
    const { buffer, fileName, contentType } = await this.service.fileStream(id);
    return new StreamableFile(buffer, {
      type: contentType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }

  @Put(':id')
  @RequirePermissions('button:knowledge:item:update')
  @ApiOperation({ summary: '更新知识条目' })
  @ApiOkResponse({ type: KnowledgeItemViewDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeItemDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.update(id, dto, user.userId);
  }

  @Delete(':id')
  @RequirePermissions('button:knowledge:item:delete')
  @ApiOperation({ summary: '删除知识条目' })
  @ApiOkResponse({ type: OkResponseDto })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.remove(id, user.userId);
  }

  @Patch(':id/publish')
  @RequirePermissions('button:knowledge:item:publish')
  @ApiOperation({ summary: '发布知识条目（需已审核通过）' })
  @ApiOkResponse({ type: KnowledgeItemViewDto })
  publish(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.publish(id, user.userId);
  }

  @Post(':id/relearn')
  @RequirePermissions('button:knowledge:item:publish')
  @ApiOperation({ summary: '重新学习：重新跑接入流水线（分块/结构化/向量）' })
  @ApiOkResponse({ type: KnowledgeItemViewDto })
  relearn(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.relearn(id, user.userId);
  }

  @Patch(':id/unpublish')
  @RequirePermissions('button:knowledge:item:publish')
  @ApiOperation({ summary: '下架知识条目' })
  @ApiOkResponse({ type: KnowledgeItemViewDto })
  unpublish(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.unpublish(id, user.userId);
  }

  @Post(':id/upload')
  @RequirePermissions('button:knowledge:item:upload')
  @ApiOperation({ summary: '上传知识条目文件' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DATASET_FILE_SIZE },
    }),
  )
  upload(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.upload(id, file, user.userId);
  }
}
