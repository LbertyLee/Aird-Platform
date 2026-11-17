import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Delete,
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
  ApiTags,
} from '@nestjs/swagger';
import { KnowledgeVisibility } from '@prisma/client';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { BusinessException } from '../common/exceptions/business.exception';
import { AuthUserContext } from '../common/types/auth-user.context';
import { MAX_DATASET_FILE_SIZE } from '../modules/dataset/dataset-file-preview';
import {
  KnowledgeItemPageQueryDto,
  UserCreateKnowledgeLibraryDto,
  UserCreateTextKnowledgeDto,
  UserDepositKnowledgeDto,
  UserRecallTestDto,
  UserKnowledgeGroupDto,
  UserUpdateKnowledgeItemDto,
  UserUpdateKnowledgeLibraryDto,
  UserUploadKnowledgeDto,
} from '../modules/knowledge/dto/knowledge.dto';
import {
  KnowledgeItemViewDto,
  KnowledgeLibraryViewDto,
  KnowledgeRecallHitDto,
} from '../modules/knowledge/dto/knowledge-response.dto';
import { KnowledgeItemService } from '../modules/knowledge/knowledge-item.service';
import { KnowledgeLibraryService } from '../modules/knowledge/knowledge-library.service';
import { RagQueryService } from '../modules/ai-query/rag-query.service';
import { EmbeddingService } from '../infrastructure/ai/embedding.service';
import { ResearchService } from './research.service';

/**
 * 用户端知识库：首页概览、新建、上传/存入、文档管理。
 * 文档处理统一复用 KnowledgeItemService.ingestUserUpload。
 */
@ApiTags('用户端-知识库')
@ApiBearerAuth()
@Controller('user/knowledge')
export class UserKnowledgeController {
  constructor(
    private readonly research: ResearchService,
    private readonly items: KnowledgeItemService,
    private readonly libraries: KnowledgeLibraryService,
    private readonly rag: RagQueryService,
    private readonly embedding: EmbeddingService,
  ) {}

  /** 向量模型始终取系统配置，不允许前端覆盖 */
  private withSystemEmbeddingModel<T extends { embeddingModel?: string }>(
    view: T,
  ): T {
    return {
      ...view,
      embeddingModel: this.embedding.getModelName(),
    };
  }

  @Get('overview')
  @ApiOperation({ summary: '用户端知识库首页概览（统计 + 本人知识库列表）' })
  @ApiOkResponse({ description: '概览数据' })
  overview(@CurrentUser() user: AuthUserContext) {
    return this.libraries.overviewForUser(user.userId);
  }

  @Get('groups')
  @ApiOperation({ summary: '用户端知识分组选项' })
  @ApiOkResponse({ description: '分组列表' })
  async listGroups(@Query('libraryId') libraryId: string | undefined, @CurrentUser() user: AuthUserContext) {
    if (libraryId) await this.libraries.assertUserCanDeposit(libraryId, user.userId);
    return this.libraries.listGroupsForUser(libraryId);
  }

  @Post('libraries/:id/groups')
  @ApiOperation({ summary: '新增本人知识库的文档分组' })
  createGroup(@Param('id') id: string, @Body() dto: UserKnowledgeGroupDto, @CurrentUser() user: AuthUserContext) {
    return this.libraries.saveDocumentGroup(id, user.userId, dto.name);
  }

  @Put('libraries/:id/groups/:code')
  @ApiOperation({ summary: '重命名本人知识库的文档分组（保留文档归属）' })
  renameGroup(@Param('id') id: string, @Param('code') code: string, @Body() dto: UserKnowledgeGroupDto, @CurrentUser() user: AuthUserContext) {
    return this.libraries.saveDocumentGroup(id, user.userId, dto.name, code);
  }

  @Delete('libraries/:id/groups/:code')
  @ApiOperation({ summary: '删除本人知识库的文档分组，文档移到未分组' })
  deleteGroup(@Param('id') id: string, @Param('code') code: string, @CurrentUser() user: AuthUserContext) {
    return this.libraries.deleteDocumentGroup(id, user.userId, code);
  }

  @Get('libraries')
  @ApiOperation({ summary: '用户端可选知识库列表（存入弹窗下拉）' })
  @ApiOkResponse({ description: '知识库列表' })
  listLibraries(@CurrentUser() user: AuthUserContext) {
    return this.libraries.listForUser(user.userId);
  }

  @Post('libraries')
  @ApiOperation({ summary: '用户端新建知识库' })
  @ApiCreatedResponse({ type: KnowledgeLibraryViewDto })
  async createLibrary(
    @Body() dto: UserCreateKnowledgeLibraryDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    const view = await this.libraries.createForUser(dto, user.userId);
    return this.withSystemEmbeddingModel(view);
  }

  @Get('libraries/:id')
  @ApiOperation({ summary: '用户端知识库详情' })
  @ApiParam({ name: 'id', description: '知识库 ID' })
  @ApiOkResponse({ type: KnowledgeLibraryViewDto })
  async libraryDetail(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    const view = await this.libraries.detailForUser(id, user.userId);
    return this.withSystemEmbeddingModel(view);
  }

  @Put('libraries/:id')
  @ApiOperation({ summary: '用户端更新知识库配置' })
  @ApiParam({ name: 'id', description: '知识库 ID' })
  @ApiOkResponse({ type: KnowledgeLibraryViewDto })
  async updateLibrary(
    @Param('id') id: string,
    @Body() dto: UserUpdateKnowledgeLibraryDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    // 向量模型由系统配置决定，忽略客户端传入
    const { embeddingModel: _ignored, ...rest } = dto;
    const view = await this.libraries.updateForUser(id, rest, user.userId);
    return this.withSystemEmbeddingModel(view);
  }

  @Post('libraries/:id/recall-test')
  @ApiOperation({ summary: '用户端知识库召回测试' })
  @ApiParam({ name: 'id', description: '知识库 ID' })
  @ApiOkResponse({ type: KnowledgeRecallHitDto, isArray: true })
  async recallTest(
    @Param('id') id: string,
    @Body() dto: UserRecallTestDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    const lib = await this.libraries.detailForUser(id, user.userId);
    const topK = dto.topK ?? lib.recallTopK ?? 5;
    const hits = await this.rag.searchInLibrary(id, dto.query.trim(), {
      topK,
      similarityThreshold: lib.similarityThreshold ?? 0,
    });
    return hits.map((hit) => ({
      chunkId: hit.chunkId,
      knowledgeItemId: hit.sourceId,
      title: hit.title,
      content: hit.content,
      score: Number(hit.score.toFixed(4)),
      chunkIndex: hit.chunkIndex,
      pageNumber:
        typeof hit.metadata?.pageNumber === 'number'
          ? hit.metadata.pageNumber
          : null,
      section:
        typeof hit.metadata?.section === 'string' ? hit.metadata.section : null,
    }));
  }

  @Get('libraries/:id/items')
  @ApiOperation({ summary: '用户端知识库文档分页' })
  @ApiParam({ name: 'id', description: '知识库 ID' })
  async libraryItems(
    @Param('id') id: string,
    @Query() query: KnowledgeItemPageQueryDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    await this.libraries.detailForUser(id, user.userId);
    query.libraryId = id;
    return this.items.page(query);
  }

  @Get('items/:id')
  @ApiOperation({ summary: '用户端文档详情' })
  @ApiOkResponse({ type: KnowledgeItemViewDto })
  async itemDetail(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    await this.assertOwnedItem(id, user.userId);
    return this.items.detail(id);
  }

  @Get('items/:id/preview')
  @ApiOperation({ summary: '用户端文档预览（文本/表格；PDF 需再拉文件流）' })
  async itemPreview(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    await this.assertOwnedItem(id, user.userId);
    return this.items.preview(id);
  }

  @Put('items/:id')
  @ApiOperation({ summary: '用户端编辑文档（名称/标签/分组）' })
  @ApiOkResponse({ type: KnowledgeItemViewDto })
  async updateItem(
    @Param('id') id: string,
    @Body() dto: UserUpdateKnowledgeItemDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    await this.assertOwnedItem(id, user.userId);
    return this.items.updateForUser(id, dto, user.userId);
  }

  @Get('items/:id/file')
  @ApiOperation({ summary: '下载文档源文件' })
  async downloadItem(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    await this.assertOwnedItem(id, user.userId);
    const { buffer, fileName, contentType } = await this.items.fileStream(id);
    return new StreamableFile(buffer, {
      type: contentType,
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }

  @Delete('items/:id')
  @ApiOperation({ summary: '归档文档（软删除，并从检索索引移除）' })
  @ApiOkResponse({ description: '删除成功' })
  async archiveItem(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    await this.assertOwnedItem(id, user.userId);
    return this.items.remove(id, user.userId);
  }

  /** @deprecated 兼容旧前端：归档即删除 */
  @Patch('items/:id/archive')
  @ApiOperation({ summary: '归档文档（兼容：等同删除）' })
  @ApiOkResponse({ description: '删除成功' })
  async archiveItemCompat(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    await this.assertOwnedItem(id, user.userId);
    return this.items.remove(id, user.userId);
  }

  @Post('text')
  @ApiOperation({ summary: '用户端创建自定义文本文档' })
  @ApiCreatedResponse({ type: KnowledgeItemViewDto })
  async createText(
    @Body() dto: UserCreateTextKnowledgeDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    await this.libraries.detailForUser(dto.libraryId, user.userId);
    return this.items.ingestFromTextContent(
      { title: dto.title, text: dto.content },
      user.userId,
      {
        libraryId: dto.libraryId,
        groupCode: dto.groupCode,
        tagNames: dto.tags,
        summary: dto.summary,
        sourceMeta: { uploadChannel: 'user_custom_text' },
      },
    );
  }

  @Post('upload')
  @ApiOperation({
    summary: '用户端上传文件存入知识库（与管理端/研究上传同一处理链路）',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        libraryId: { type: 'string' },
        groupCode: { type: 'string' },
        visibility: {
          type: 'string',
          enum: Object.values(KnowledgeVisibility),
        },
        tags: {
          type: 'string',
          description: '逗号分隔标签，如 GDP,中美对比,宏观',
        },
        title: { type: 'string' },
        code: { type: 'string' },
        summary: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ type: KnowledgeItemViewDto })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_DATASET_FILE_SIZE },
    }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UserUploadKnowledgeDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    if (!file) {
      throw new BadRequestException('请选择要上传的文件');
    }
    const tagNames = (dto.tags ?? '')
      .split(/[,，]/)
      .map((t) => t.trim())
      .filter(Boolean);
    return this.items.ingestUserUpload(file, user.userId, {
      libraryId: dto.libraryId,
      groupCode: dto.groupCode,
      visibility: dto.visibility,
      tagNames,
      title: dto.title,
      code: dto.code,
      summary: dto.summary,
      sourceMeta: { uploadChannel: 'user_upload' },
    });
  }

  @Post('deposit')
  @ApiOperation({
    summary: '勾选研究来源批量存入知识库（每个来源独立入库并切片）',
  })
  @ApiOkResponse({ description: '入库结果' })
  deposit(
    @Body() dto: UserDepositKnowledgeDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.research.depositToKnowledge(dto, user.userId);
  }

  private async assertOwnedItem(itemId: string, userId: string) {
    const item = await this.items.requireOne(itemId);
    if (!item.libraryId) {
      throw new BusinessException(
        'KNOWLEDGE_LIBRARY_FORBIDDEN',
        '无权操作该文档',
        403,
      );
    }
    await this.libraries.detailForUser(item.libraryId, userId);
    return item;
  }
}
