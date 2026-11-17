import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUserContext } from '../../common/types/auth-user.context';
import { SearchDataAnalysisDto } from '../data-analysis/dto/data-analysis.dto';
import { SearchOrchestratorService } from './search-orchestrator.service';
import { Public } from '../../common/decorators/public.decorator';
import type { Request, Response } from 'express';
import { streamSearchJob } from './search-job-stream';

@ApiTags('用户端-统一搜索')
@ApiBearerAuth()
@Controller('search')
export class SearchOrchestratorController {
  constructor(private readonly service: SearchOrchestratorService) {}

  @Post('query')
  @ApiOperation({ summary: '按混合、联网、知识库或 AI 搜索模式执行检索' })
  @ApiOkResponse({ description: '混合模式并发聚合知识库和 Exa 的结果' })
  search(
    @Body() body: SearchDataAnalysisDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.search(
      user.userId,
      body.query,
      body.filters,
      body.mode,
      body.model,
    );
  }

  @Post('jobs')
  @ApiOperation({
    summary: '创建异步检索任务（返回 jobId，通过 SSE 或轮询读取进度）',
  })
  startJob(
    @Body() body: SearchDataAnalysisDto,
    @CurrentUser() user: AuthUserContext,
    @Headers('x-request-id') requestId?: string,
  ) {
    return this.service.startSearchJob(
      user.userId,
      body.query,
      body.filters,
      body.mode,
      requestId,
      body.model,
    );
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: '查询异步检索任务状态与结果' })
  getJob(@CurrentUser() user: AuthUserContext, @Param('jobId') jobId: string) {
    return this.service.getSearchJob(user.userId, jobId);
  }

  @Get('jobs/:jobId/events')
  @ApiOperation({ summary: '订阅当前用户检索任务的 SSE 状态和结果快照' })
  async events(
    @CurrentUser() user: AuthUserContext,
    @Param('jobId') jobId: string,
    @Res() response: Response,
  ) {
    // Check ownership before committing SSE headers so 401/404 stay normal HTTP errors.
    const initial = await this.service.getSearchJob(user.userId, jobId);
    if (response.destroyed) return;
    streamSearchJob(response, initial, () =>
      this.service.getSearchJob(user.userId, jobId),
    );
  }

  @Get('history')
  @ApiOperation({ summary: '读取当前用户的检索历史' })
  history(@CurrentUser() user: AuthUserContext) {
    return this.service.history(user.userId);
  }

  @Delete('history/:runId')
  @ApiOperation({ summary: '删除当前用户的一条检索历史' })
  deleteHistory(
    @CurrentUser() user: AuthUserContext,
    @Param('runId') runId: string,
  ) {
    return this.service.deleteHistory(user.userId, runId);
  }

  @Get('sources/:sourceId/preview-url')
  @ApiOperation({ summary: '读取知识库文件在线预览内容' })
  previewUrl(
    @CurrentUser() user: AuthUserContext,
    @Req() request: Request,
    @Param('sourceId') sourceId: string,
  ) {
    const forwardedProto = request.headers['x-forwarded-proto'];
    const protocol =
      typeof forwardedProto === 'string' ? forwardedProto : request.protocol;
    return this.service.getFilePreview(
      user.userId,
      sourceId,
      `${protocol}://${request.get('host')}/api/v1`,
    );
  }

  @Public()
  @Get('preview-file')
  async previewFile(
    @Query('sourceId') sourceId: string,
    @Query('expiresAt') expiresAt: string,
    @Query('token') token: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.service.getPreviewFile(
      sourceId,
      Number(expiresAt),
      token,
    );
    response.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    return new StreamableFile(file.buffer, { type: file.mimeType });
  }
}
