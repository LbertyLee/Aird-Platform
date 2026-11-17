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
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { OkResponseDto } from '../../common/dto/swagger.dto';
import { AuthUserContext } from '../../common/types/auth-user.context';
import {
  CreateKnowledgeTagDto,
  KnowledgeTagPageQueryDto,
  UpdateKnowledgeTagDto,
} from './dto/knowledge.dto';
import { KnowledgeCatalogService } from './knowledge-catalog.service';

@ApiTags('管理端-知识标签')
@ApiBearerAuth()
@Controller('admin/knowledge/tags')
export class KnowledgeTagController {
  constructor(private readonly catalog: KnowledgeCatalogService) {}

  @Get()
  @RequirePermissions('menu:knowledge:user')
  @ApiOperation({ summary: '知识标签分页' })
  page(@Query() query: KnowledgeTagPageQueryDto) {
    return this.catalog.pageTags(query);
  }

  @Post()
  @RequirePermissions('button:knowledge:tag:create')
  @ApiOperation({ summary: '创建知识标签' })
  @ApiCreatedResponse({ description: '创建成功的标签' })
  create(
    @Body() dto: CreateKnowledgeTagDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.catalog.createTag(dto, user.userId);
  }

  @Put(':id')
  @RequirePermissions('button:knowledge:tag:update')
  @ApiOperation({ summary: '更新知识标签' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeTagDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.catalog.updateTag(id, dto, user.userId);
  }

  @Delete(':id')
  @RequirePermissions('button:knowledge:tag:delete')
  @ApiOperation({ summary: '删除知识标签' })
  @ApiOkResponse({ type: OkResponseDto })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.catalog.removeTag(id, user.userId);
  }
}
