import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IngestionJobStatus, IngestionTargetType } from '@prisma/client';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PageQueryDto } from '../../common/dto/page.dto';
import { IngestionService } from './ingestion.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUserContext } from '../../common/types/auth-user.context';

class IngestionJobPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: IngestionTargetType })
  @IsOptional()
  @IsEnum(IngestionTargetType)
  targetType?: IngestionTargetType;

  @ApiPropertyOptional({ enum: IngestionJobStatus })
  @IsOptional()
  @IsEnum(IngestionJobStatus)
  status?: IngestionJobStatus;

  @ApiPropertyOptional({ description: '目标 ID（知识条目/数据集）' })
  @IsOptional()
  @IsString()
  targetId?: string;
}

@ApiTags('管理端-数据接入任务')
@ApiBearerAuth()
@Controller('admin/ingestion-jobs')
export class IngestionAdminController {
  constructor(private readonly ingestion: IngestionService) {}

  @Get()
  @RequirePermissions('menu:data:field-mapping|menu:knowledge:library')
  @ApiOperation({ summary: '接入任务分页（验证学习流水线）' })
  @ApiOkResponse({ description: '分页列表' })
  page(@Query() query: IngestionJobPageQueryDto) {
    return this.ingestion.pageJobs(query);
  }

  @Get(':id')
  @RequirePermissions('menu:data:field-mapping|menu:knowledge:library')
  @ApiOperation({ summary: '接入任务详情' })
  detail(@Param('id') id: string) {
    return this.ingestion.getJob(id);
  }

  @Post(':id/retry')
  @RequirePermissions('menu:data:field-mapping|menu:knowledge:library')
  @ApiOperation({ summary: '人工重试失败的知识接入任务' })
  retry(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.ingestion.retryJob(id, user.userId);
  }
}
