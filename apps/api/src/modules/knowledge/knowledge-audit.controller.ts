import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuthUserContext } from '../../common/types/auth-user.context';
import {
  ApproveKnowledgeDto,
  KnowledgeAuditPageQueryDto,
  RejectKnowledgeDto,
} from './dto/knowledge.dto';
import {
  KnowledgeAuditDetailDto,
  KnowledgeItemViewDto,
} from './dto/knowledge-response.dto';
import { KnowledgeAuditService } from './knowledge-audit.service';
import { KnowledgeItemService } from './knowledge-item.service';

@ApiTags('管理端-知识审核')
@ApiBearerAuth()
@Controller('admin/knowledge/audits')
export class KnowledgeAuditController {
  constructor(
    private readonly service: KnowledgeAuditService,
    private readonly items: KnowledgeItemService,
  ) {}

  @Get()
  @RequirePermissions('menu:knowledge:public-review')
  @ApiOperation({ summary: '知识审核队列' })
  page(@Query() query: KnowledgeAuditPageQueryDto) {
    return this.service.page(query);
  }

  @Get(':id/preview')
  @RequirePermissions('menu:knowledge:public-review')
  @ApiOperation({ summary: '审核时预览知识文件' })
  preview(@Param('id') id: string) {
    return this.items.preview(id);
  }

  @Get(':id/file')
  @RequirePermissions('menu:knowledge:public-review')
  @ApiOperation({ summary: '审核时下载知识文件' })
  async file(@Param('id') id: string) {
    const { buffer, fileName, contentType } = await this.items.fileStream(id);
    return new StreamableFile(buffer, {
      type: contentType,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }

  @Get(':id')
  @RequirePermissions('menu:knowledge:public-review')
  @ApiOperation({ summary: '审核详情（含来源溯源与历史）' })
  @ApiOkResponse({ type: KnowledgeAuditDetailDto })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Post(':id/approve')
  @RequirePermissions('button:knowledge:audit:approve')
  @ApiOperation({ summary: '审核通过' })
  @ApiOkResponse({ type: KnowledgeItemViewDto })
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveKnowledgeDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.approve(id, dto, user.userId);
  }

  @Post(':id/reject')
  @RequirePermissions('button:knowledge:audit:reject')
  @ApiOperation({ summary: '审核驳回' })
  @ApiOkResponse({ type: KnowledgeItemViewDto })
  reject(
    @Param('id') id: string,
    @Body() dto: RejectKnowledgeDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.reject(id, dto, user.userId);
  }
}
