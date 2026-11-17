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
  CreateKnowledgeLibraryDto,
  KnowledgeLibraryPageQueryDto,
  UpdateKnowledgeLibraryDto,
} from './dto/knowledge.dto';
import { KnowledgeLibraryViewDto } from './dto/knowledge-response.dto';
import { KnowledgeLibraryService } from './knowledge-library.service';

@ApiTags('管理端-知识库')
@ApiBearerAuth()
@Controller('admin/knowledge/libraries')
export class KnowledgeLibraryController {
  constructor(private readonly service: KnowledgeLibraryService) {}

  @Get()
  @RequirePermissions('menu:knowledge:library')
  @ApiOperation({ summary: '知识库分页列表' })
  page(@Query() query: KnowledgeLibraryPageQueryDto) {
    return this.service.page(query);
  }

  @Get('statistics')
  @RequirePermissions('menu:knowledge:library')
  @ApiOperation({ summary: '知识库全量统计' })
  statistics(@Query() query: KnowledgeLibraryPageQueryDto) {
    return this.service.statistics(query);
  }

  @Get(':id')
  @RequirePermissions('menu:knowledge:library')
  @ApiOperation({ summary: '知识库详情' })
  @ApiParam({ name: 'id', description: '知识库 ID' })
  @ApiOkResponse({ type: KnowledgeLibraryViewDto })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Post()
  @RequirePermissions('button:knowledge:library:create')
  @ApiOperation({ summary: '新增知识库' })
  @ApiCreatedResponse({ type: KnowledgeLibraryViewDto })
  create(
    @Body() dto: CreateKnowledgeLibraryDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.create(dto, user.userId);
  }

  @Put(':id')
  @RequirePermissions('button:knowledge:library:update')
  @ApiOperation({ summary: '更新知识库' })
  @ApiOkResponse({ type: KnowledgeLibraryViewDto })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateKnowledgeLibraryDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.update(id, dto, user.userId);
  }

  @Delete(':id')
  @RequirePermissions('button:knowledge:library:delete')
  @ApiOperation({ summary: '删除知识库' })
  @ApiOkResponse({ type: OkResponseDto })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.remove(id, user.userId);
  }
}
