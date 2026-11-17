import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUserContext } from '../../common/types/auth-user.context';
import { SearchDataAnalysisDto } from './dto/data-analysis.dto';
import { DataAnalysisService } from './data-analysis.service';

@ApiTags('用户端-数据分析')
@ApiBearerAuth()
@Controller('data-analysis')
export class DataAnalysisController {
  constructor(private readonly service: DataAnalysisService) {}

  @Get('status')
  @ApiOperation({ summary: '读取数据分析检索能力状态' })
  status() {
    return this.service.getStatus();
  }

  @Post('search')
  @ApiOperation({
    summary: '仅检索公共知识库与本人知识库（含关系型结构化数据）',
    description:
      '查询范围为：公共知识库 + 当前用户本人知识库/上传条目；不会检索其他用户的私有知识库。',
  })
  @ApiOkResponse({ description: '检索结果含 stages / answer / sources' })
  search(
    @Body() body: SearchDataAnalysisDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    if (body.mode && body.mode !== 'knowledge') {
      throw new BadRequestException(
        '该接口仅支持 knowledge 模式，请使用 /search/query 进行统一检索。',
      );
    }
    return this.service.search(user.userId, body.query, body.filters);
  }
}
