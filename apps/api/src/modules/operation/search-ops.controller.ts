import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CommonStatus } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PageResultDto } from '../../common/dto/page.dto';
import { OkResponseDto } from '../../common/dto/swagger.dto';
import { AuthUserContext } from '../../common/types/auth-user.context';
import {
  HotWordItemDto,
  NoResultWordItemDto,
  SensitiveWordViewDto,
} from './dto/operation-response.dto';
import {
  CreateSensitiveWordDto,
  MarkNoResultDto,
  SearchOpsRangeQueryDto,
  SensitiveWordPageQueryDto,
  SetQuickSearchDto,
  UpdateSensitiveWordDto,
} from './dto/operation.dto';
import { SearchOpsService } from './search-ops.service';

/**
 * 搜索运营 HTTP 入口。
 */
@ApiTags('管理端-运营管理-搜索运营')
@ApiBearerAuth()
@Controller('admin/operation/search-ops')
export class SearchOpsController {
  constructor(private readonly service: SearchOpsService) {}

  @Get('hot-words')
  @RequirePermissions('menu:operation:search')
  @ApiOperation({ summary: '热门搜索词' })
  @ApiOkResponse({ description: '热门词分页' })
  hotWords(
    @Query() query: SearchOpsRangeQueryDto,
  ): Promise<PageResultDto<HotWordItemDto>> {
    return this.service.hotWords(query);
  }

  @Get('hot-words/export')
  @RequirePermissions('export:operation:search')
  @ApiOperation({ summary: '导出热门搜索词 CSV' })
  @ApiProduces('text/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportHotWords(
    @Query('range') range: '7d' | '30d' = '7d',
    @Res() res: Response,
  ) {
    const csv = await this.service.exportHotWordsCsv(range === '30d' ? '30d' : '7d');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="hot-words-${range === '30d' ? '30d' : '7d'}.csv"`,
    );
    res.send('\uFEFF' + csv);
  }

  @Post('quick-search')
  @RequirePermissions('button:operation:search:quick')
  @ApiOperation({ summary: '设为快捷检索' })
  @ApiOkResponse({ type: OkResponseDto })
  setQuickSearch(
    @Body() dto: SetQuickSearchDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.setQuickSearch(dto, user.userId);
  }

  @Get('no-result-words')
  @RequirePermissions('menu:operation:search')
  @ApiOperation({ summary: '无结果搜索词' })
  @ApiOkResponse({ description: '无结果词分页' })
  noResultWords(
    @Query() query: SearchOpsRangeQueryDto,
  ): Promise<PageResultDto<NoResultWordItemDto>> {
    return this.service.noResultWords(query);
  }

  @Post('no-result-words/mark')
  @RequirePermissions('menu:operation:search')
  @ApiOperation({ summary: '标记无结果词已处理' })
  @ApiOkResponse({ type: OkResponseDto })
  markNoResult(
    @Body() body: MarkNoResultDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.markNoResultHandled(body.keyword, body, user.userId);
  }

  @Get('sensitive-words')
  @RequirePermissions('menu:operation:search')
  @ApiOperation({ summary: '敏感词分页' })
  @ApiOkResponse({ description: '敏感词分页' })
  pageSensitive(
    @Query() query: SensitiveWordPageQueryDto,
  ): Promise<PageResultDto<SensitiveWordViewDto>> {
    return this.service.pageSensitiveWords(query);
  }

  @Post('sensitive-words')
  @RequirePermissions('button:operation:search:sensitive')
  @ApiOperation({ summary: '新增敏感词' })
  @ApiCreatedResponse({ type: SensitiveWordViewDto })
  createSensitive(
    @Body() dto: CreateSensitiveWordDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.createSensitiveWord(dto, user.userId);
  }

  @Put('sensitive-words/:id')
  @RequirePermissions('button:operation:search:sensitive')
  @ApiOperation({ summary: '编辑敏感词' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: SensitiveWordViewDto })
  updateSensitive(
    @Param('id') id: string,
    @Body() dto: UpdateSensitiveWordDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.updateSensitiveWord(id, dto, user.userId);
  }

  @Post('sensitive-words/:id/enable')
  @RequirePermissions('button:operation:search:sensitive')
  @ApiOperation({ summary: '启用敏感词' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: SensitiveWordViewDto })
  enableSensitive(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.setSensitiveStatus(
      id,
      CommonStatus.active,
      user.userId,
    );
  }

  @Post('sensitive-words/:id/disable')
  @RequirePermissions('button:operation:search:sensitive')
  @ApiOperation({ summary: '停用敏感词' })
  @ApiParam({ name: 'id' })
  @ApiOkResponse({ type: SensitiveWordViewDto })
  disableSensitive(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.setSensitiveStatus(
      id,
      CommonStatus.disabled,
      user.userId,
    );
  }
}
