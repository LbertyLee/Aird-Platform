import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 管理端列表分页查询基类。
 */
export class PageQueryDto {
  /** 页码，从 1 开始 */
  @ApiPropertyOptional({ default: 1, description: '页码，从 1 开始' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  /** 每页条数，默认 20，上限 100 */
  @ApiPropertyOptional({
    default: 20,
    description: '每页条数，默认 20，上限 100',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;

  /** 通用关键字 */
  @ApiPropertyOptional({ description: '通用关键字' })
  @IsOptional()
  @IsString()
  keyword?: string;

  /**
   * 转换为 Prisma skip/take。
   */
  toSkipTake(): { skip: number; take: number } {
    return {
      skip: (this.page - 1) * this.pageSize,
      take: this.pageSize,
    };
  }
}

/**
 * 分页结果包装。
 */
export class PageResultDto<T> {
  /** 当前页数据 */
  items: T[];
  /** 总条数 */
  total: number;
  /** 当前页 */
  page: number;
  /** 页大小 */
  pageSize: number;

  constructor(items: T[], total: number, page: number, pageSize: number) {
    this.items = items;
    this.total = total;
    this.page = page;
    this.pageSize = pageSize;
  }
}
