import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PageQueryDto, PageResultDto } from '../common/dto/page.dto';
import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PrismaService } from '../infrastructure/prisma/prisma.service';

class StructuredDataPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ['sources', 'remote', 'extractions'] })
  @IsOptional()
  @IsIn(['sources', 'remote', 'extractions'])
  namespace?: string;
}

@ApiTags('管理端-结构化数据')
@ApiBearerAuth()
@Controller('admin/structured-data')
export class StructuredDataAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('menu:data:structured-data|menu:data:dataset')
  @ApiOperation({ summary: '分页查询本地结构化数据记录' })
  async page(@Query() query: StructuredDataPageQueryDto) {
    const { skip, take } = query.toSkipTake();
    const where = {
      ...(query.namespace ? { namespace: query.namespace } : {}),
      ...(query.keyword?.trim()
        ? {
            fingerprint: {
              contains: query.keyword.trim(),
              mode: 'insensitive' as const,
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.structuredDataRecord.findMany({
        where,
        select: {
          id: true,
          namespace: true,
          fingerprint: true,
          checksum: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.structuredDataRecord.count({ where }),
    ]);
    return new PageResultDto(rows, total, query.page, query.pageSize);
  }

  @Get(':id')
  @RequirePermissions('menu:data:structured-data|menu:data:dataset')
  @ApiOperation({ summary: '查询结构化数据记录详情' })
  async detail(@Param('id') id: string) {
    const row = await this.prisma.structuredDataRecord.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('结构化数据记录不存在');
    return row;
  }
}
