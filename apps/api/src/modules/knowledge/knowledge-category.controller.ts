import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
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
  CreateKnowledgeCategoryDto,
  UpdateKnowledgeCategoryDto,
} from './dto/knowledge.dto';
import { KnowledgeCategoryTreeDto } from './dto/knowledge-response.dto';
import { KnowledgeCatalogService } from './knowledge-catalog.service';

@ApiTags('管理端-知识类目')
@ApiBearerAuth()
@Controller('admin/knowledge/categories')
export class KnowledgeCategoryController {
  constructor(private readonly catalog: KnowledgeCatalogService) {}

  @Get('tree')
  @RequirePermissions('menu:knowledge:user')
  @ApiOperation({ summary: '知识分类树' })
  @ApiOkResponse({ type: [KnowledgeCategoryTreeDto] })
  tree() {
    return this.catalog.categoryTree();
  }

  @Post()
  @RequirePermissions('button:knowledge:category:create')
  @ApiOperation({ summary: '创建知识分类' })
  @ApiCreatedResponse({ description: '创建成功的分类' })
  create(
    @Body() dto: CreateKnowledgeCategoryDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.catalog.createCategory(dto, user.userId);
  }

  @Put(':id')
  @RequirePermissions('button:knowledge:category:update')
  @ApiOperation({ summary: '更新知识分类' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeCategoryDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.catalog.updateCategory(id, dto, user.userId);
  }

  @Delete(':id')
  @RequirePermissions('button:knowledge:category:delete')
  @ApiOperation({ summary: '删除知识分类' })
  @ApiOkResponse({ type: OkResponseDto })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.catalog.removeCategory(id, user.userId);
  }
}
