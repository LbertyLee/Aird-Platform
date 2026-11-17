import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';
import { ResearchCatalogService } from './research-catalog.service';
import { ModelSelectionService } from '../infrastructure/ai/model-selection.service';

/** 用户端只读选项接口，不复用管理端分页接口。 */
@ApiTags('用户端-研究选项')
@Public()
@Controller('user/options')
export class UserOptionsController {
  constructor(private readonly catalog: ResearchCatalogService, private readonly models: ModelSelectionService) {}

  @Get()
  @ApiOperation({ summary: '读取用户端研究筛选项与数据源' })
  options() {
    return this.catalog.load().then(({ filters }) => filters);
  }

  @Get('data-sources')
  @ApiOperation({ summary: '读取用户端可用数据源' })
  dataSources() {
    return this.catalog.load().then(({ filters }) => filters.sources);
  }

  @Get('models')
  @ApiOperation({ summary: '读取后台配置的用户可选模型' })
  modelsOptions() { return this.models.list(); }
}
