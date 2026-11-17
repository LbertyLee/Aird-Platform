import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CommonStatus,
  DatasetPublishStatus,
  DatasetVisibility,
} from '@prisma/client';
import { UploaderBriefDto } from '../../../common/dto/swagger.dto';

/** 数据集关联的指标摘要 */
export class DatasetIndicatorBriefDto {
  @ApiProperty({ description: '指标 ID' })
  id!: string;

  @ApiProperty({ description: '指标名称' })
  name!: string;

  @ApiProperty({ description: '指标编码' })
  code!: string;

  @ApiProperty({ description: '分类' })
  category!: string;

  @ApiProperty({
    enum: ['auto', 'manual'],
    description: '关联来源：auto 自动识别 / manual 手动',
  })
  source!: 'auto' | 'manual';
}

/** 数据集关联的字典项摘要 */
export class DatasetDictionaryBriefDto {
  @ApiProperty({ description: '字典项 ID' })
  id!: string;

  @ApiProperty({ description: '字典类型编码' })
  type!: string;

  @ApiProperty({ description: '编码' })
  code!: string;

  @ApiProperty({ description: '名称' })
  name!: string;

  @ApiProperty({
    enum: ['auto', 'manual'],
    description: '关联来源：auto 自动识别 / manual 手动',
  })
  source!: 'auto' | 'manual';
}

/** 数据集视图 */
export class DatasetViewDto {
  @ApiProperty({ description: '数据集 ID' })
  id!: string;

  @ApiProperty({ description: '来源名称' })
  name!: string;

  @ApiPropertyOptional({ description: '英文名', nullable: true })
  nameEn?: string | null;

  @ApiProperty({ description: '来源编码' })
  code!: string;

  @ApiPropertyOptional({ description: '来源分类编码', nullable: true })
  categoryCode?: string | null;

  @ApiPropertyOptional({ description: '地区/层级', nullable: true })
  regionLevel?: string | null;

  @ApiPropertyOptional({ description: '网站链接', nullable: true })
  websiteUrl?: string | null;

  @ApiProperty({ description: '是否可作为 Exa 外部搜索域名' })
  externalSearchEligible!: boolean;

  @ApiPropertyOptional({ description: '不可用于 Exa 外部搜索的原因', nullable: true })
  externalSearchIneligibleReason?: string | null;

  @ApiPropertyOptional({ description: '备注', nullable: true })
  remark?: string | null;

  @ApiProperty({ enum: CommonStatus, description: '启用状态' })
  status!: CommonStatus;

  @ApiPropertyOptional({ description: '描述说明', nullable: true })
  description?: string | null;

  @ApiProperty({ enum: DatasetVisibility, description: '可见性' })
  visibility!: DatasetVisibility;

  @ApiProperty({ enum: DatasetPublishStatus, description: '上架状态' })
  publishStatus!: DatasetPublishStatus;

  @ApiPropertyOptional({ description: 'MinIO 对象 Key', nullable: true })
  fileKey?: string | null;

  @ApiPropertyOptional({ description: '原始文件名', nullable: true })
  fileName?: string | null;

  @ApiPropertyOptional({ description: 'MIME 类型', nullable: true })
  mimeType?: string | null;

  @ApiPropertyOptional({ description: '文件大小（字节）', nullable: true })
  fileSize?: number | null;

  @ApiPropertyOptional({ description: '创建人用户 ID', nullable: true })
  createdBy?: string | null;

  @ApiPropertyOptional({
    type: () => UploaderBriefDto,
    description: '上传人信息',
    nullable: true,
  })
  uploader?: UploaderBriefDto | null;

  @ApiProperty({
    type: [DatasetIndicatorBriefDto],
    description: '关联指标',
  })
  indicators!: DatasetIndicatorBriefDto[];

  @ApiProperty({
    type: [DatasetDictionaryBriefDto],
    description: '关联字典项',
  })
  dictionaries!: DatasetDictionaryBriefDto[];

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt!: Date;
}

/** 数据集分页响应 */
export class DatasetPageResultDto {
  @ApiProperty({ type: [DatasetViewDto], description: '当前页数据' })
  items!: DatasetViewDto[];

  @ApiProperty({ description: '总条数', example: 100 })
  total!: number;

  @ApiProperty({ description: '当前页码', example: 1 })
  page!: number;

  @ApiProperty({ description: '每页条数', example: 20 })
  pageSize!: number;
}

/** 来源分类统计 */
export class DatasetCategoryStatDto {
  @ApiProperty({ description: '分类编码；全部为 all' })
  categoryCode!: string;

  @ApiProperty({ description: '数量' })
  count!: number;
}

/** 来源管理统计 */
export class DatasetStatsDto {
  @ApiProperty({ description: '来源总数' })
  total!: number;

  @ApiProperty({ description: '启用数量' })
  activeCount!: number;

  @ApiProperty({ type: [DatasetCategoryStatDto], description: '各分类数量' })
  byCategory!: DatasetCategoryStatDto[];
}

/** 数据集文件预览 */
export class DatasetFilePreviewDto {
  @ApiProperty({
    enum: ['pdf', 'document', 'spreadsheet'],
    description: '预览类型：pdf / document / spreadsheet',
  })
  kind!: 'pdf' | 'document' | 'spreadsheet';

  @ApiProperty({ description: '文件名' })
  fileName!: string;

  @ApiPropertyOptional({ description: 'PDF MIME（kind=pdf 时）' })
  mimeType?: string;

  @ApiPropertyOptional({ description: '文档纯文本（kind=document 时）' })
  text?: string;

  @ApiPropertyOptional({ description: '是否截断' })
  truncated?: boolean;

  @ApiPropertyOptional({ description: '工作表名（kind=spreadsheet 时）' })
  sheetName?: string;

  @ApiPropertyOptional({
    description: '表格预览行（二维字符串数组）',
    type: 'array',
    items: { type: 'array', items: { type: 'string' } },
  })
  rows?: string[][];

  @ApiPropertyOptional({ description: '原表总行数' })
  totalRows?: number;

  @ApiPropertyOptional({ description: '原表总列数' })
  totalColumns?: number;
}
