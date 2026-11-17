import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PageQueryDto } from '../../common/dto/page.dto';
import { BackupProducer } from './backup.producer';
import { BackupService } from './backup.service';
import {
  BackupJobListResultDto,
  BackupJobViewDto,
  BackupStatusDto,
  RestoreAcceptedDto,
  RestoreBackupDto,
  UpdateBackupScheduleDto,
} from './dto/backup-response.dto';

/**
 * 系统备份管理 HTTP 入口。
 */
@ApiTags('管理端-系统管理-数据备份')
@ApiBearerAuth()
@Controller('admin/system/backups')
export class BackupController {
  constructor(
    private readonly service: BackupService,
    private readonly producer: BackupProducer,
  ) {}

  @Get('status')
  @RequirePermissions('menu:system:backup')
  @ApiOperation({ summary: '备份调度状态与最近一次结果' })
  @ApiOkResponse({ type: BackupStatusDto })
  getStatus() {
    return this.service.getStatus();
  }

  @Get()
  @RequirePermissions('menu:system:backup')
  @ApiOperation({ summary: '备份任务分页列表' })
  @ApiOkResponse({ type: BackupJobListResultDto })
  page(@Query() query: PageQueryDto) {
    return this.service.pageJobs(query);
  }

  @Put('schedule')
  @RequirePermissions('button:system:backup:run')
  @ApiOperation({ summary: '开启/关闭定时自动备份' })
  @ApiOkResponse({ type: BackupStatusDto })
  updateSchedule(@Body() dto: UpdateBackupScheduleDto) {
    return this.producer.setAutoBackup(dto.enabled);
  }

  @Post('run')
  @RequirePermissions('button:system:backup:run')
  @ApiOperation({ summary: '手动触发一次系统备份' })
  @ApiOkResponse({ type: BackupJobViewDto })
  runNow() {
    return this.producer.enqueueManual();
  }

  @Post(':id/restore')
  @RequirePermissions('button:system:backup:restore')
  @ApiOperation({
    summary: '一键恢复指定备份（覆盖当前库与业务文件，需确认口令）',
  })
  @ApiParam({ name: 'id', description: '备份任务 ID' })
  @ApiOkResponse({ type: RestoreAcceptedDto })
  restore(@Param('id') id: string, @Body() dto: RestoreBackupDto) {
    return this.producer.enqueueRestore(id, dto.confirmText);
  }
}
