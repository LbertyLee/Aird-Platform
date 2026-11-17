import type { Prisma } from '@prisma/client';

/**
 * 知识库结构化接入生成的内部 Dataset（供字段映射 / Text-to-SQL）。
 * 不应出现在「来源管理」或研究端来源筛选中。
 */
export function knowledgeStructuredDatasetWhere(): Prisma.DatasetWhereInput {
  return {
    OR: [
      { code: { startsWith: 'kb_' } },
      { remark: { startsWith: 'knowledgeItemId=' } },
    ],
  };
}

/** 外部数据来源（来源管理目录）：排除知识库结构化产物 */
export function externalSourceDatasetWhere(): Prisma.DatasetWhereInput {
  return {
    NOT: knowledgeStructuredDatasetWhere(),
  };
}
