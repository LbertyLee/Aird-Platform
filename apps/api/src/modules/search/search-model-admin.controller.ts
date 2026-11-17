import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ModelSelectionService } from '../../infrastructure/ai/model-selection.service';

class CreateSearchModelDto {
  @IsString() @MinLength(1) @MaxLength(128) value!: string;
  @IsString() @MinLength(1) @MaxLength(128) label!: string;
  @IsOptional() @IsInt() @Min(0) sort?: number;
}

class UpdateSearchModelDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) value?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(128) label?: string;
  @IsOptional() @IsInt() @Min(0) sort?: number;
  @IsOptional() @IsIn(['active', 'disabled']) status?: 'active' | 'disabled';
}

@ApiTags('管理端-搜索模型')
@ApiBearerAuth()
@Controller('admin/search-models')
export class SearchModelAdminController {
  constructor(private readonly models: ModelSelectionService) {}

  @Get()
  @RequirePermissions('menu:system:search-model')
  list() { return this.models.adminList(); }

  @Post()
  @RequirePermissions('button:system:search-model:create')
  create(@Body() dto: CreateSearchModelDto) { return this.models.create(dto.value, dto.label, dto.sort); }

  @Put(':id')
  @RequirePermissions('button:system:search-model:update')
  update(@Param('id') id: string, @Body() dto: UpdateSearchModelDto) { return this.models.update(id, dto); }

  @Delete(':id')
  @RequirePermissions('button:system:search-model:delete')
  remove(@Param('id') id: string) { return this.models.remove(id); }
}
