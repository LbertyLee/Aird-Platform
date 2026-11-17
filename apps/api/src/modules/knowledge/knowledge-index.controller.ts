import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { BatchOkCountDto } from '../../common/dto/swagger.dto';
import { AuthUserContext } from '../../common/types/auth-user.context';
import {
  KnowledgeIndexFailedQueryDto,
  KnowledgePurgeVectorsDto,
  KnowledgeRebuildDto,
} from './dto/knowledge.dto';
import { KnowledgeIndexOverviewDto } from './dto/knowledge-response.dto';
import { KnowledgeIndexService } from './knowledge-index.service';

@ApiTags('管理端-知识索引')
@ApiBearerAuth()
@Controller('admin/knowledge/indexes')
export class KnowledgeIndexController {
  constructor(private readonly service: KnowledgeIndexService) {}

  @Get('overview')
  @RequirePermissions('menu:knowledge:index')
  @ApiOperation({ summary: '知识向量索引概览' })
  @ApiOkResponse({ type: KnowledgeIndexOverviewDto })
  overview() {
    return this.service.overview();
  }

  @Get('failed')
  @RequirePermissions('menu:knowledge:index')
  @ApiOperation({ summary: '向量失败列表' })
  failed(@Query() query: KnowledgeIndexFailedQueryDto) {
    return this.service.pageFailed(query);
  }

  @Post('rebuild')
  @RequirePermissions('button:knowledge:index:rebuild')
  @ApiOperation({ summary: '重建向量索引' })
  @ApiOkResponse({ type: BatchOkCountDto })
  rebuild(
    @Body() dto: KnowledgeRebuildDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.rebuild(dto, user.userId);
  }

  @Post('incremental')
  @RequirePermissions('button:knowledge:index:rebuild')
  @ApiOperation({ summary: '增量更新（pending/failed）' })
  @ApiOkResponse({ type: BatchOkCountDto })
  incremental(
    @Body() dto: KnowledgeRebuildDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.incremental(dto, user.userId);
  }

  @Post('cleanup')
  @RequirePermissions('button:knowledge:index:cleanup')
  @ApiOperation({ summary: '清理脏向量数据' })
  @ApiOkResponse({ type: BatchOkCountDto })
  cleanup(
    @Body() dto: KnowledgeRebuildDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.cleanupDirty(dto, user.userId);
  }

  @Post('purge-all')
  @RequirePermissions('button:knowledge:index:cleanup')
  @ApiOperation({
    summary: '清空全部向量数据（Milvus + DB 状态），可选立即重跑',
  })
  purgeAll(
    @Body() dto: KnowledgePurgeVectorsDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.purgeAllVectors(dto, user.userId);
  }
}
