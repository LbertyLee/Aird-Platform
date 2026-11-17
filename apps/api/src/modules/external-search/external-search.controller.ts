import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserContext } from '../../common/types/auth-user.context';
import { SearchDataAnalysisDto } from '../data-analysis/dto/data-analysis.dto';
import { ExternalSearchService } from './external-search.service';

@ApiTags('用户端-Exa 联网检索')
@ApiBearerAuth()
@Controller('external-search')
export class ExternalSearchController {
  constructor(private readonly service: ExternalSearchService) {}

  @Get('status')
  @ApiOperation({ summary: '读取 Exa 联网检索能力状态' })
  status() { return this.service.getStatus(); }

  @Post('search')
  @ApiOperation({ summary: '执行联网或 AI 搜索（ai-search）' })
  search(@Body() body: SearchDataAnalysisDto, @CurrentUser() user: AuthUserContext) {
    return this.service.search(user.userId, body.query, body.filters, {
      mode: body.mode === 'ai-search' ? 'ai-search' : 'exa',
    });
  }
}
