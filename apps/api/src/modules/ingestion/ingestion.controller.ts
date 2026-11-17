import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IngestionService } from './ingestion.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('数据接入')
@Controller('ingestion-jobs')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @Get(':id')
  @Public()
  @ApiOperation({ summary: '查询数据接入任务状态' })
  getJob(@Param('id') id: string) {
    return this.ingestion.getJob(id);
  }
}
