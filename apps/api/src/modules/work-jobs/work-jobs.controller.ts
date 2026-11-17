import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserContext } from '../../common/types/auth-user.context';
import { CreateAnalysisSessionDto } from '../analysis/dto/analysis-session.dto';
import { GenerateResearchReportDto } from '../../research/dto/search-research.dto';
import { WorkJobsService } from './work-jobs.service';

@ApiTags('用户端-后台分析任务')
@ApiBearerAuth()
@Controller('work-jobs')
export class WorkJobsController {
  constructor(private readonly jobs: WorkJobsService) {}

  @Post('analysis')
  @ApiOperation({ summary: '在后台创建数据分析会话' })
  analysis(
    @CurrentUser() user: AuthUserContext,
    @Body() input: CreateAnalysisSessionDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.jobs.start(user.userId, { kind: 'analysis', input }, requestId);
  }

  @Post('report')
  @ApiOperation({ summary: '在后台生成研究报告' })
  report(
    @CurrentUser() user: AuthUserContext,
    @Body() input: GenerateResearchReportDto,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.jobs.start(user.userId, { kind: 'report', input }, requestId);
  }

  @Get(':jobId')
  @ApiOperation({ summary: '读取本人后台任务的状态与结果' })
  get(@CurrentUser() user: AuthUserContext, @Param('jobId') jobId: string) {
    return this.jobs.get(user.userId, jobId);
  }
}
