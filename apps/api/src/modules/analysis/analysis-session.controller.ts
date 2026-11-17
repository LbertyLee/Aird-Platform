import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserContext } from '../../common/types/auth-user.context';
import {
  AnalysisPresentationDto,
  RecentAnalysisSessionsDto,
  CreateAnalysisSessionDto,
  ExportAnalysisSessionDto,
} from './dto/analysis-session.dto';
import { AnalysisSessionService } from './analysis-session.service';

@ApiTags('用户端-数据分析工作台')
@ApiBearerAuth()
@Controller('analysis/sessions')
export class AnalysisSessionController {
  constructor(private readonly service: AnalysisSessionService) {}

  @Post()
  @ApiOperation({ summary: '根据已选检索来源创建数据分析会话' })
  @ApiCreatedResponse({ description: '返回已标准化的结构化数据与来源状态' })
  create(
    @Body() dto: CreateAnalysisSessionDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.create(user.userId, dto);
  }

  @Post('recent')
  @ApiOperation({
    summary: '按最近四条检索记录读取本人最新的分析结果与图表配置',
  })
  recent(
    @Body() dto: RecentAnalysisSessionsDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.recent(user.userId, dto.runIds);
  }

  @Put(':id/presentation')
  @ApiOperation({ summary: '保存图表筛选及报告可视化配置' })
  savePresentation(
    @Param('id') id: string,
    @Body() dto: AnalysisPresentationDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.savePresentation(user.userId, id, dto);
  }

  @Post(':id/report')
  @ApiOperation({ summary: '按当前图表筛选生成并保存可复现的分析结果' })
  report(
    @Param('id') id: string,
    @Body() dto: AnalysisPresentationDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.savePresentation(user.userId, id, dto, true);
  }

  @Post(':id/export.xlsx')
  @ApiOperation({ summary: '导出分析会话的结构化数据为 Excel 文件' })
  @ApiOkResponse({ description: 'Excel 文件流' })
  async exportExcel(
    @Param('id') id: string,
    @Body() dto: ExportAnalysisSessionDto,
    @CurrentUser() user: AuthUserContext,
  ): Promise<StreamableFile> {
    const file = await this.service.exportXlsx(user.userId, id, dto.columns);
    return new StreamableFile(file.buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      length: file.buffer.length,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: '读取当前用户的数据分析会话' })
  @ApiOkResponse({ description: '返回已保存的分析会话内容' })
  get(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.get(user.userId, id);
  }
}
