import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  GenerateResearchReportDto,
} from './dto/search-research.dto';
import { ResearchService } from './research.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUserContext } from '../common/types/auth-user.context';

@ApiTags('AI 数据智搜')
@Controller('research')
export class ResearchController {
  constructor(private readonly research: ResearchService) {}

  @Get('filters')
  @Public()
  @ApiOperation({ summary: '读取研究检索动态筛选项' })
  filters() {
    return this.research.getFilterCatalog();
  }

  @Get('status')
  @Public()
  @ApiOperation({ summary: '读取研究检索服务能力状态' })
  status() {
    return this.research.getStatus();
  }

  @Post('upload')
  @ApiOperation({
    summary: '上传研究文档并写入用户补充数据知识库（私有免审，自动学习）',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @UploadedFile() file?: Express.Multer.File,
    @CurrentUser() user?: AuthUserContext,
  ) {
    if (!file) throw new BadRequestException('请选择要上传的文件。');
    return this.research.upload(file, user?.userId ?? null);
  }

  @Post('report')
  @ApiOperation({ summary: '基于选定来源生成研究报告' })
  generateReport(
    @Body() body: GenerateResearchReportDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.research.generateReport(body.query, body.sourceIds, user.userId);
  }
}
