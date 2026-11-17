import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUserContext } from '../../common/types/auth-user.context';
import { AgentService } from './agent.service';
import {
  CreatePlatformAgentDto,
  CreateUserAgentDto,
  UpdateUserAgentDto,
  UpdatePlatformAgentDto,
} from './dto/agent.dto';

@ApiTags('用户端-智能体')
@Controller('agents')
export class AgentController {
  constructor(private readonly service: AgentService) {}

  @Public()
  @Get('categories')
  @ApiOperation({ summary: '智能体分类选项' })
  categories() {
    return this.service.listCategories();
  }

  @Public()
  @Get()
  @ApiOperation({ summary: '智能体中心列表（平台公开与本人私有）' })
  list(
    @Query('q') q?: string,
    @Query('categoryCode') categoryCode?: string,
    @CurrentUser() user?: AuthUserContext,
  ) {
    return this.service.listForUser(user?.userId, q, categoryCode);
  }

  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建个人智能体' })
  create(
    @Body() dto: CreateUserAgentDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.createForUser(dto, user.userId);
  }

  @Put(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新个人智能体' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserAgentDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.service.updateForUser(id, dto, user.userId);
  }

  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: '删除个人智能体' })
  remove(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.service.removeForUser(id, user.userId);
  }
}

@ApiTags('管理端-智能体')
@ApiBearerAuth()
@Controller('admin/agents')
@RequirePermissions('menu:agent')
export class AgentAdminController {
  constructor(private readonly service: AgentService) {}

  @Get()
  list(@Query('q') q?: string) {
    return this.service.listAdmin(q);
  }

  @Post()
  create(@Body() dto: CreatePlatformAgentDto, @CurrentUser() user: AuthUserContext) {
    return this.service.createPlatform(dto, user.userId);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePlatformAgentDto) {
    return this.service.updatePlatform(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
