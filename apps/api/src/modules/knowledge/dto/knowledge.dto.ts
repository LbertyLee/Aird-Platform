import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CommonStatus,
  KnowledgeAuditStatus,
  KnowledgeLibraryType,
  KnowledgePublishStatus,
  KnowledgeVisibility,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page.dto';

/** 创建知识分类 */
export class CreateKnowledgeCategoryDto {
  @ApiProperty({ description: '分类名称' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name!: string;

  @ApiProperty({ description: '分类编码' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  code!: string;

  @ApiPropertyOptional({ description: '父分类 ID' })
  @IsOptional()
  @IsString()
  parentId?: string;

  @ApiPropertyOptional({ description: '排序', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @ApiPropertyOptional({ description: '描述' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;
}

/** 更新知识分类 */
export class UpdateKnowledgeCategoryDto {
  @ApiPropertyOptional({ description: '分类名称' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional({ description: '父分类 ID，传 null 清空' })
  @IsOptional()
  @IsString()
  parentId?: string | null;

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @ApiPropertyOptional({ description: '描述' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;
}

/** 创建知识标签 */
export class CreateKnowledgeTagDto {
  @ApiProperty({ description: '标签名称' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;

  @ApiProperty({ description: '标签编码' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  code!: string;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 更新知识标签 */
export class UpdateKnowledgeTagDto {
  @ApiPropertyOptional({ description: '标签名称' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 创建知识条目（自动审核） */
export class CreateKnowledgeItemDto {
  @ApiProperty({ description: '标题' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  title!: string;

  @ApiProperty({ description: '编码' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  code!: string;

  @ApiPropertyOptional({ description: '摘要' })
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiPropertyOptional({ description: '正文' })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({
    enum: KnowledgeVisibility,
    description: '可见性 public/private',
  })
  @IsEnum(KnowledgeVisibility)
  visibility!: KnowledgeVisibility;

  @ApiPropertyOptional({ description: '分类 ID' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: '所属知识库 ID' })
  @IsOptional()
  @IsString()
  libraryId?: string;

  @ApiPropertyOptional({ description: '知识分组字典编码' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  groupCode?: string;

  @ApiPropertyOptional({ type: [String], description: '标签 ID 列表' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tagIds?: string[];
}

/** 更新知识条目 */
export class UpdateKnowledgeItemDto {
  @ApiPropertyOptional({ description: '标题' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  title?: string;

  @ApiPropertyOptional({ description: '摘要' })
  @IsOptional()
  @IsString()
  summary?: string | null;

  @ApiPropertyOptional({ description: '正文' })
  @IsOptional()
  @IsString()
  content?: string | null;

  @ApiPropertyOptional({
    enum: KnowledgeVisibility,
    description: '可见性',
  })
  @IsOptional()
  @IsEnum(KnowledgeVisibility)
  visibility?: KnowledgeVisibility;

  @ApiPropertyOptional({ description: '分类 ID' })
  @IsOptional()
  @IsString()
  categoryId?: string | null;

  @ApiPropertyOptional({ description: '所属知识库 ID' })
  @IsOptional()
  @IsString()
  libraryId?: string | null;

  @ApiPropertyOptional({ description: '知识分组字典编码' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  groupCode?: string | null;

  @ApiPropertyOptional({ type: [String], description: '标签 ID 列表（全量替换）' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tagIds?: string[];
}

/** 知识条目分页 */
export class KnowledgeItemPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: KnowledgeVisibility })
  @IsOptional()
  @IsEnum(KnowledgeVisibility)
  visibility?: KnowledgeVisibility;

  @ApiPropertyOptional({ enum: KnowledgeAuditStatus })
  @IsOptional()
  @IsEnum(KnowledgeAuditStatus)
  auditStatus?: KnowledgeAuditStatus;

  @ApiPropertyOptional({ enum: KnowledgePublishStatus })
  @IsOptional()
  @IsEnum(KnowledgePublishStatus)
  publishStatus?: KnowledgePublishStatus;

  @ApiPropertyOptional({ description: '分类 ID' })
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ description: '所属知识库 ID' })
  @IsOptional()
  @IsString()
  libraryId?: string;

  @ApiPropertyOptional({ description: '知识分组字典编码' })
  @IsOptional()
  @IsString()
  groupCode?: string;
}

/** 审核队列分页 */
export class KnowledgeAuditPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: KnowledgeAuditStatus,
    description: '默认 pending；传空字符串可查全部状态',
  })
  @IsOptional()
  @IsEnum(KnowledgeAuditStatus)
  auditStatus?: KnowledgeAuditStatus;

  @ApiPropertyOptional({
    enum: KnowledgeVisibility,
    description: '按条目可见性筛选，如公开数据审核传 public',
  })
  @IsOptional()
  @IsEnum(KnowledgeVisibility)
  visibility?: KnowledgeVisibility;

  @ApiPropertyOptional({
    enum: KnowledgeVisibility,
    description: '按所属知识库是否公用筛选',
  })
  @IsOptional()
  @IsEnum(KnowledgeVisibility)
  libraryVisibility?: KnowledgeVisibility;
}

/** 驳回请求 */
export class RejectKnowledgeDto {
  @ApiProperty({ description: '驳回原因' })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  reason!: string;
}

/** 审核通过可选备注 */
export class ApproveKnowledgeDto {
  @ApiPropertyOptional({ description: '审核备注' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  remark?: string;
}

/** 批量索引操作 */
export class KnowledgeIndexIdsDto {
  @ApiPropertyOptional({
    type: [String],
    description: '指定条目 ID；空则按规则全量处理',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids?: string[];
}

/** 标签列表查询 */
export class KnowledgeTagPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: CommonStatus })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 索引失败列表分页 */
export class KnowledgeIndexFailedQueryDto extends PageQueryDto {}

/** 批量重建上限辅助 */
export class KnowledgeRebuildDto extends KnowledgeIndexIdsDto {
  @ApiPropertyOptional({
    description: '全量重建时每批上限',
    default: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** 清空全部向量数据 */
export class KnowledgePurgeVectorsDto {
  @ApiPropertyOptional({
    description: '清空后是否立即重新入队向量化（默认 false）',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  reindex?: boolean;

  @ApiPropertyOptional({
    description: '重新入队时每批上限',
    default: 500,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  reindexLimit?: number;
}

/** 创建平台知识库 */
export class CreateKnowledgeLibraryDto {
  @ApiProperty({ description: '知识库名称' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  name!: string;

  @ApiPropertyOptional({ description: '编码，不传则自动生成' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  code?: string;

  @ApiPropertyOptional({ description: '结构化文件索引模式：sql_only / vector_only / hybrid', default: 'hybrid' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  structuredIndexMode?: string;

  @ApiPropertyOptional({
    enum: KnowledgeLibraryType,
    description: '类型：normal 普通 / qa 历史问答库',
    default: KnowledgeLibraryType.normal,
  })
  @IsOptional()
  @IsEnum(KnowledgeLibraryType)
  type?: KnowledgeLibraryType;

  @ApiPropertyOptional({
    enum: KnowledgeVisibility,
    description: '是否公用：public 公用 / private 私有',
    default: KnowledgeVisibility.private,
  })
  @IsOptional()
  @IsEnum(KnowledgeVisibility)
  visibility?: KnowledgeVisibility;

  @ApiPropertyOptional({ description: '简介' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  intro?: string;

  @ApiPropertyOptional({ description: '知识分组字典编码' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  groupCode?: string;

  @ApiPropertyOptional({ description: '图标 emoji', default: '📚' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;

  @ApiPropertyOptional({ description: '图标底色', default: '#e6efff' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;
}

/** 更新平台知识库 */
export class UpdateKnowledgeLibraryDto {
  @ApiPropertyOptional({ description: '知识库名称' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  name?: string;

  @ApiPropertyOptional({ enum: KnowledgeLibraryType })
  @IsOptional()
  @IsEnum(KnowledgeLibraryType)
  type?: KnowledgeLibraryType;

  @ApiPropertyOptional({
    enum: KnowledgeVisibility,
    description: '是否公用：public 公用 / private 私有',
  })
  @IsOptional()
  @IsEnum(KnowledgeVisibility)
  visibility?: KnowledgeVisibility;

  @ApiPropertyOptional({ description: '简介' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  intro?: string | null;

  @ApiPropertyOptional({ description: '知识分组字典编码' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  groupCode?: string | null;

  @ApiPropertyOptional({ description: '图标 emoji' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;

  @ApiPropertyOptional({ description: '图标底色' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;

  @ApiPropertyOptional({ enum: CommonStatus })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @ApiPropertyOptional({
    description: '分段方式：smart 智能分段 / fixed 固定长度',
    default: 'smart',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  chunkMethod?: string;

  @ApiPropertyOptional({ description: '分段长度', default: 800 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(4000)
  chunkSize?: number;

  @ApiPropertyOptional({ description: '重叠长度', default: 120 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  chunkOverlap?: number;

  @ApiPropertyOptional({ description: '结构化文件索引模式：sql_only / vector_only / hybrid', default: 'hybrid' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  structuredIndexMode?: string;

  @ApiPropertyOptional({
    description: '向量模型标识',
    default: 'text-embedding-v3',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  embeddingModel?: string;

  @ApiPropertyOptional({ description: '默认召回条数 TopK', default: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  recallTopK?: number;

  @ApiPropertyOptional({ description: '相似度阈值 0~1', default: 0.6 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  similarityThreshold?: number;

  @ApiPropertyOptional({ description: '混合检索语义权重', default: 0.7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  hybridSemanticWeight?: number;

  @ApiPropertyOptional({ description: '混合检索关键词权重', default: 0.3 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  hybridKeywordWeight?: number;
}

/** 用户端更新知识库配置 */
export class UserUpdateKnowledgeLibraryDto {
  @ApiPropertyOptional({ description: '知识库名称' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  name?: string;

  @ApiPropertyOptional({
    enum: KnowledgeVisibility,
    description: '私有 / 公共',
  })
  @IsOptional()
  @IsEnum(KnowledgeVisibility)
  visibility?: KnowledgeVisibility;

  @ApiPropertyOptional({ description: '简介' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  intro?: string | null;

  @ApiPropertyOptional({ description: '分段方式：smart / fixed' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  chunkMethod?: string;

  @ApiPropertyOptional({ description: '分段长度' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(4000)
  chunkSize?: number;

  @ApiPropertyOptional({ description: '重叠长度' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  chunkOverlap?: number;

  @ApiPropertyOptional({ description: '向量模型标识' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  embeddingModel?: string;

  @ApiPropertyOptional({ description: '默认召回条数 TopK' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  recallTopK?: number;

  @ApiPropertyOptional({ description: '相似度阈值 0~1' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  similarityThreshold?: number;

  @ApiPropertyOptional({ description: '混合检索语义权重' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  hybridSemanticWeight?: number;

  @ApiPropertyOptional({ description: '混合检索关键词权重' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  hybridKeywordWeight?: number;
}

/** 用户端文档分组 */
export class UserKnowledgeGroupDto {
  @ApiProperty({ description: '分组名称，去除首尾空格后为 1 至 64 个字符' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;
}

/** 用户端召回测试 */
export class UserRecallTestDto {
  @ApiProperty({ description: '测试问题', example: '2025 年中国 GDP 增速是多少？' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  query!: string;

  @ApiPropertyOptional({ description: '召回条数，默认取知识库配置', default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number;
}

/** 知识库列表查询 */
export class KnowledgeLibraryPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '知识分组字典编码' })
  @IsOptional()
  @IsString()
  groupCode?: string;

  @ApiPropertyOptional({ enum: KnowledgeLibraryType })
  @IsOptional()
  @IsEnum(KnowledgeLibraryType)
  type?: KnowledgeLibraryType;

  @ApiPropertyOptional({
    enum: KnowledgeVisibility,
    description: '按是否公用筛选',
  })
  @IsOptional()
  @IsEnum(KnowledgeVisibility)
  visibility?: KnowledgeVisibility;

  @ApiPropertyOptional({ enum: CommonStatus })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 用户端存入知识库（勾选研究来源批量入库） */
export class UserDepositKnowledgeDto {
  @ApiProperty({ description: '目标知识库 ID' })
  @IsString()
  @MinLength(1)
  libraryId!: string;

  @ApiPropertyOptional({ description: '知识分组字典编码' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  groupCode?: string;

  @ApiPropertyOptional({
    enum: KnowledgeVisibility,
    description: '可见性；若指定知识库则最终以知识库可见性为准',
  })
  @IsOptional()
  @IsEnum(KnowledgeVisibility)
  visibility?: KnowledgeVisibility;

  @ApiPropertyOptional({
    type: [String],
    description: '标签名称列表（不存在则自动创建）',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tags?: string[];

  @ApiProperty({
    type: [String],
    description: '研究来源 ID 列表（ResearchSource）',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  sourceIds!: string[];
}

/** 用户端编辑知识文档 */
export class UserUpdateKnowledgeItemDto {
  @ApiPropertyOptional({ description: '文档名称' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  title?: string;

  @ApiPropertyOptional({
    type: [String],
    description: '标签名称列表（全量替换，不存在则自动创建）',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '知识分组字典编码' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  groupCode?: string | null;

  @ApiPropertyOptional({ description: '摘要' })
  @IsOptional()
  @IsString()
  summary?: string | null;
}

/** 用户端自定义文本文档 */
export class UserCreateTextKnowledgeDto {
  @ApiProperty({ description: '所属知识库 ID' })
  @IsString()
  @MinLength(1)
  libraryId!: string;

  @ApiProperty({ description: '文档标题' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  title!: string;

  @ApiProperty({ description: '正文内容' })
  @IsString()
  @MinLength(1)
  content!: string;

  @ApiPropertyOptional({ description: '知识分组字典编码' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  groupCode?: string;

  @ApiPropertyOptional({ type: [String], description: '标签名称' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ description: '摘要' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  summary?: string;
}

/** multipart 空字符串转 undefined，避免枚举校验失败 */
const emptyToUndefined = ({ value }: { value: unknown }) =>
  value === '' || value === null ? undefined : value;

/** 用户端新建知识库 */
export class UserCreateKnowledgeLibraryDto {
  @ApiProperty({ description: '知识库名称' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  name!: string;

  @ApiPropertyOptional({ description: '简介' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  intro?: string;

  @ApiPropertyOptional({
    enum: KnowledgeVisibility,
    description: '私有仅自己可见 / 公共全员可见',
    default: KnowledgeVisibility.private,
  })
  @IsOptional()
  @IsEnum(KnowledgeVisibility)
  visibility?: KnowledgeVisibility;

  @ApiPropertyOptional({
    description: '封面颜色，如 #3b82f6',
    default: '#3b82f6',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  color?: string;
}

/** 用户端直接上传文件入库（multipart 字段） */
export class UserUploadKnowledgeDto {
  @ApiPropertyOptional({
    description: '目标知识库 ID；不传则写入用户补充数据知识库',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  libraryId?: string;

  @ApiPropertyOptional({ description: '知识分组字典编码' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(128)
  groupCode?: string;

  @ApiPropertyOptional({ enum: KnowledgeVisibility })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(KnowledgeVisibility)
  visibility?: KnowledgeVisibility;

  @ApiPropertyOptional({
    description: '标签，逗号分隔，如：GDP,中美对比,宏观',
  })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(512)
  tags?: string;

  @ApiPropertyOptional({ description: '标题；默认使用文件名' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(256)
  title?: string;

  @ApiPropertyOptional({ description: '编码；不传则自动生成' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(128)
  code?: string;

  @ApiPropertyOptional({ description: '摘要' })
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(1024)
  summary?: string;
}
