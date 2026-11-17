import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { SearchResearchDto } from './dto/search-research.dto';
import { ResearchService } from './research.service';

const SEARCH_TEST_PERMS =
  'menu:data:field-mapping|menu:knowledge:library';

/**
 * 管理端搜索测试：验证学习完成后的 AI Query / RAG / Text-to-SQL 链路。
 */
@ApiTags('管理端-搜索测试')
@ApiBearerAuth()
@Controller('admin/search-test')
export class ResearchAdminController {
  constructor(private readonly research: ResearchService) {}

  @Get('status')
  @RequirePermissions(SEARCH_TEST_PERMS)
  @ApiOperation({ summary: '检索能力状态（向量库 / 外部搜索）' })
  @ApiOkResponse({ description: '能力状态' })
  status() {
    return this.research.getStatus();
  }

  @Post()
  @RequirePermissions(SEARCH_TEST_PERMS)
  @ApiOperation({ summary: '执行一次搜索测试（与研究端同链路）' })
  @ApiOkResponse({ description: '检索结果含 stages / answer / sources' })
  test(@Body() body: SearchResearchDto) {
    return this.research.search(body.query, body.filters, body.mode ?? 'knowledge');
  }
}
