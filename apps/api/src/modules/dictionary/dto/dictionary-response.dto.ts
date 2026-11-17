import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommonStatus, VectorSyncStatus } from '@prisma/client';

/** 字典类型视图 */
export class DictionaryTypeViewDto {
  @ApiProperty({ description: '类型 ID' })
  id!: string;

  @ApiProperty({ description: '类型编码' })
  code!: string;

  @ApiProperty({ description: '类型名称' })
  name!: string;

  @ApiPropertyOptional({ description: '说明', nullable: true })
  description?: string | null;

  @ApiProperty({ description: '排序值' })
  sort!: number;

  @ApiProperty({ enum: CommonStatus, description: '状态' })
  status!: CommonStatus;

  @ApiProperty({ description: '是否系统内置' })
  isSystem!: boolean;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt!: Date;
}

/** 字典项视图 */
export class DictionaryViewDto {
  @ApiProperty({ description: '字典项 ID' })
  id!: string;

  @ApiProperty({ description: '字典类型编码' })
  type!: string;

  @ApiProperty({ description: '字典编码' })
  code!: string;

  @ApiProperty({ description: '字典名称' })
  name!: string;

  @ApiProperty({ type: [String], description: '别名列表' })
  aliases!: string[];

  @ApiPropertyOptional({ description: '描述说明', nullable: true })
  description?: string | null;

  @ApiProperty({ description: '排序值' })
  sort!: number;

  @ApiProperty({ enum: CommonStatus, description: '状态' })
  status!: CommonStatus;

  @ApiProperty({ enum: VectorSyncStatus, description: '向量化状态' })
  vectorStatus!: VectorSyncStatus;

  @ApiPropertyOptional({ description: '向量化失败原因', nullable: true })
  vectorError?: string | null;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt!: Date;
}

/** 字典语义检索命中项 */
export class DictionarySearchHitDto extends DictionaryViewDto {
  @ApiProperty({ description: '向量相似度分数', example: 0.86 })
  score!: number;
}

/** 字典分页响应 */
export class DictionaryPageResultDto {
  @ApiProperty({ type: [DictionaryViewDto], description: '当前页数据' })
  items!: DictionaryViewDto[];

  @ApiProperty({ description: '总条数', example: 100 })
  total!: number;

  @ApiProperty({ description: '当前页码', example: 1 })
  page!: number;

  @ApiProperty({ description: '每页条数', example: 20 })
  pageSize!: number;
}
