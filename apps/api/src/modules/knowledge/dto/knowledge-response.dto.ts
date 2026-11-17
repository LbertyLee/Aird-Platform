import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CommonStatus,
  KnowledgeAuditAction,
  KnowledgeAuditStatus,
  KnowledgeLibraryType,
  KnowledgePublishStatus,
  KnowledgeSourceType,
  KnowledgeVisibility,
  VectorSyncStatus,
} from '@prisma/client';
import { UploaderBriefDto } from '../../../common/dto/swagger.dto';

export class KnowledgeTagBriefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;
}

export class KnowledgeCategoryBriefDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;
}

export class KnowledgeCategoryTreeDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiPropertyOptional({ nullable: true })
  parentId?: string | null;

  @ApiProperty()
  sort!: number;

  @ApiProperty({ enum: CommonStatus })
  status!: CommonStatus;

  @ApiPropertyOptional({ nullable: true })
  description?: string | null;

  @ApiProperty({ type: [KnowledgeCategoryTreeDto] })
  children!: KnowledgeCategoryTreeDto[];
}

export class KnowledgeItemViewDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  code!: string;

  @ApiPropertyOptional({ nullable: true })
  summary?: string | null;

  @ApiPropertyOptional({ nullable: true })
  content?: string | null;

  @ApiProperty({ enum: KnowledgeVisibility })
  visibility!: KnowledgeVisibility;

  @ApiProperty({ enum: KnowledgeAuditStatus })
  auditStatus!: KnowledgeAuditStatus;

  @ApiProperty({ enum: KnowledgePublishStatus })
  publishStatus!: KnowledgePublishStatus;

  @ApiPropertyOptional({ nullable: true })
  categoryId?: string | null;

  @ApiPropertyOptional({ type: KnowledgeCategoryBriefDto, nullable: true })
  category?: KnowledgeCategoryBriefDto | null;

  @ApiPropertyOptional({ nullable: true })
  libraryId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  groupCode?: string | null;

  @ApiProperty({ enum: KnowledgeSourceType })
  sourceType!: KnowledgeSourceType;

  @ApiPropertyOptional({ nullable: true })
  sourceMeta?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  fileName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  mimeType?: string | null;

  @ApiPropertyOptional({ nullable: true })
  fileSize?: number | null;

  @ApiProperty()
  chunkCount!: number;

  @ApiProperty({ description: '检索命中次数' })
  hitCount!: number;

  @ApiProperty({ enum: VectorSyncStatus })
  vectorStatus!: VectorSyncStatus;

  @ApiPropertyOptional({ nullable: true })
  vectorError?: string | null;

  @ApiPropertyOptional({ nullable: true })
  vectorSyncedAt?: Date | null;

  @ApiPropertyOptional({ nullable: true })
  rejectReason?: string | null;

  @ApiPropertyOptional({ nullable: true })
  auditedAt?: Date | null;

  @ApiPropertyOptional({ type: UploaderBriefDto, nullable: true })
  submitter?: UploaderBriefDto | null;

  @ApiPropertyOptional({ type: UploaderBriefDto, nullable: true })
  auditor?: UploaderBriefDto | null;

  @ApiProperty({ type: [KnowledgeTagBriefDto] })
  tags!: KnowledgeTagBriefDto[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class KnowledgeAuditRecordDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: KnowledgeAuditAction })
  action!: KnowledgeAuditAction;

  @ApiPropertyOptional({ nullable: true })
  remark?: string | null;

  @ApiPropertyOptional({ nullable: true })
  snapshot?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: UploaderBriefDto, nullable: true })
  actor?: UploaderBriefDto | null;

  @ApiProperty()
  createdAt!: Date;
}

export class KnowledgeAuditDetailDto extends KnowledgeItemViewDto {
  @ApiProperty({ type: [KnowledgeAuditRecordDto] })
  auditHistory!: KnowledgeAuditRecordDto[];
}

export class KnowledgeIndexOverviewDto {
  @ApiProperty({ description: '条目总数（未删除）' })
  total!: number;

  @ApiProperty({ description: '已审核通过' })
  approved!: number;

  @ApiProperty({ description: '已发布' })
  published!: number;

  @ApiProperty({ description: '向量 pending' })
  pending!: number;

  @ApiProperty({ description: '向量 processing' })
  processing!: number;

  @ApiProperty({ description: '向量 ready' })
  ready!: number;

  @ApiProperty({ description: '向量 failed' })
  failed!: number;

  @ApiProperty({ description: '脏数据候选（软删/未发布/驳回但仍有向量痕迹）' })
  dirtyCandidates!: number;
}

export class KnowledgeLibraryViewDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty({ enum: KnowledgeLibraryType })
  type!: KnowledgeLibraryType;

  @ApiProperty({ enum: KnowledgeVisibility, description: '公用/私有' })
  visibility!: KnowledgeVisibility;

  @ApiPropertyOptional({ nullable: true })
  intro?: string | null;

  @ApiPropertyOptional({ nullable: true })
  groupCode?: string | null;

  @ApiProperty()
  icon!: string;

  @ApiProperty()
  color!: string;

  @ApiProperty()
  fileTotal!: number;

  @ApiProperty()
  fileSize!: number;

  @ApiProperty({ description: '分段方式' })
  chunkMethod!: string;

  @ApiProperty({ description: '分段长度' })
  chunkSize!: number;

  @ApiProperty({ description: '重叠长度' })
  chunkOverlap!: number;

  @ApiProperty({ description: '结构化文件索引模式' })
  structuredIndexMode!: string;

  @ApiProperty({ description: '向量模型' })
  embeddingModel!: string;

  @ApiProperty({ description: '默认召回 TopK' })
  recallTopK!: number;

  @ApiProperty({ description: '相似度阈值' })
  similarityThreshold!: number;

  @ApiProperty({ description: '混合检索语义权重' })
  hybridSemanticWeight!: number;

  @ApiProperty({ description: '混合检索关键词权重' })
  hybridKeywordWeight!: number;

  @ApiProperty({ enum: CommonStatus })
  status!: CommonStatus;

  @ApiPropertyOptional({ nullable: true })
  createdBy?: string | null;

  @ApiPropertyOptional({ nullable: true })
  updatedBy?: string | null;

  @ApiPropertyOptional({ nullable: true })
  creatorName?: string | null;

  @ApiPropertyOptional({ nullable: true })
  updaterName?: string | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

/** 召回测试命中片段 */
export class KnowledgeRecallHitDto {
  @ApiProperty()
  chunkId!: string;

  @ApiProperty({ description: '知识条目 ID' })
  knowledgeItemId!: string;

  @ApiProperty({ description: '文档标题' })
  title!: string;

  @ApiProperty({ description: '片段内容' })
  content!: string;

  @ApiProperty({ description: '相似度分数（余弦）' })
  score!: number;

  @ApiProperty({ description: '分段序号' })
  chunkIndex!: number;

  @ApiPropertyOptional({ nullable: true })
  pageNumber?: number | null;

  @ApiPropertyOptional({ nullable: true })
  section?: string | null;
}
