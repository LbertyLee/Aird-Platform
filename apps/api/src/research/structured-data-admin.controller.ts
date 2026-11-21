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

  @Get('observations')
  @RequirePermissions('menu:data:structured-data|menu:data:dataset')
  @ApiOperation({ summary: '分页查询结构化观测数据' })
  async observations(@Query() query: StructuredDataPageQueryDto) {
    const { skip, take } = query.toSkipTake();
    const keyword = query.keyword?.trim();
    const where = {
      ...(query.namespace ? { namespace: query.namespace } : {}),
      ...(keyword
        ? {
            OR: [
              {
                indicatorEnglish: {
                  contains: keyword,
                  mode: 'insensitive' as const,
                },
              },
              {
                indicatorChinese: {
                  contains: keyword,
                  mode: 'insensitive' as const,
                },
              },
              { region: { contains: keyword, mode: 'insensitive' as const } },
              {
                sourceOrganization: {
                  contains: keyword,
                  mode: 'insensitive' as const,
                },
              },
              {
                sourceProject: {
                  contains: keyword,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.structuredDataObservation.findMany({
        where,
        select: {
          id: true,
          namespace: true,
          indicatorEnglish: true,
          indicatorChinese: true,
          sourceOrganization: true,
          sourceProject: true,
          region: true,
          regionType: true,
          parentRegion: true,
          startTime: true,
          endTime: true,
          timeIndicatorType: true,
          dataValue: true,
          unit: true,
          sourceUrl: true,
          publishedAt: true,
          indicatorExplanation: true,
          inputBy: true,
          inputAt: true,
          isPublic: true,
          dataOwner: true,
          lastModifiedBy: true,
          lastModifiedAt: true,
          annotations: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
      this.prisma.structuredDataObservation.count({ where }),
    ]);
    return new PageResultDto(rows, total, query.page, query.pageSize);
  }

  @Get('observations/:id')
  @RequirePermissions('menu:data:structured-data|menu:data:dataset')
  @ApiOperation({ summary: '查询结构化观测数据详情' })
  async observationDetail(@Param('id') id: string) {
    const row = await this.prisma.structuredDataObservation.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('结构化观测数据不存在');
    return row;
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
