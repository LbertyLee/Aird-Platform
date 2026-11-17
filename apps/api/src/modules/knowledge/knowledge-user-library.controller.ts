import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { KnowledgeUserLibraryService } from './knowledge-user-library.service';

@ApiTags('管理端-用户知识库')
@ApiBearerAuth()
@Controller('admin/knowledge/user-libraries')
export class KnowledgeUserLibraryController {
  constructor(private readonly service: KnowledgeUserLibraryService) {}

  @Get(':userId')
  @RequirePermissions(
    'menu:knowledge:user|menu:knowledge:library',
  )
  @ApiOperation({ summary: '按用户汇总知识库与文档' })
  @ApiParam({ name: 'userId', description: '用户 ID' })
  @ApiOkResponse({ description: '用户知识库概览' })
  overview(@Param('userId') userId: string) {
    return this.service.overview(userId);
  }
}
