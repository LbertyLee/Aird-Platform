/**
 * 从来源字典 mock 数据初始化 datasets（来源管理）。
 * 数据源：yudao-ui-admin-vue3 sources-data.ts
 *
 * 运行：cd apps/api && pnpm exec ts-node --compiler-options "{\"module\":\"CommonJS\"}" prisma/seed-sources.ts
 */
import {
  CommonStatus,
  DatasetPublishStatus,
  DatasetVisibility,
  PrismaClient,
} from '@prisma/client';
import { SYSTEM_DICT_CODES, SOURCE_CATEGORY_SEEDS } from '../src/modules/dictionary/dictionary-type.constants';
import { dataSources } from './data/yudao-sources-data';

const prisma = new PrismaClient();

const CATEGORY_CODE: Record<string, string> = {
  国际组织: 'intl_org',
  各国统计局: 'national_stats',
  中国政府机构: 'cn_gov',
};

async function ensureSourceCategories() {
  const type = await prisma.dictionaryType.findFirst({
    where: { code: SYSTEM_DICT_CODES.source_category },
  });
  if (type) {
    await prisma.dictionaryType.update({
      where: { id: type.id },
      data: {
        name: '来源分类',
        isSystem: true,
        status: CommonStatus.active,
        deletedAt: null,
      },
    });
  } else {
    await prisma.dictionaryType.create({
      data: {
        code: SYSTEM_DICT_CODES.source_category,
        name: '来源分类',
        description: '数据来源类型',
        sort: 70,
        status: CommonStatus.active,
        isSystem: true,
      },
    });
  }
  for (const item of SOURCE_CATEGORY_SEEDS) {
    const existing = await prisma.dictionaryItem.findFirst({
      where: {
        type: SYSTEM_DICT_CODES.source_category,
        code: item.code,
      },
    });
    if (existing) {
      await prisma.dictionaryItem.update({
        where: { id: existing.id },
        data: {
          name: item.name,
          sort: item.sort,
          status: CommonStatus.active,
          deletedAt: null,
        },
      });
    } else {
      await prisma.dictionaryItem.create({
        data: {
          type: SYSTEM_DICT_CODES.source_category,
          code: item.code,
          name: item.name,
          sort: item.sort,
          status: CommonStatus.active,
          description: '来源分类',
        },
      });
    }
  }
}

async function retireStaleSourceCodes() {
  const activeCodes = dataSources.map((item) => item.id);
  const retired = await prisma.dataset.updateMany({
    where: {
      AND: [
        { code: { startsWith: 'DS' } },
        { code: { notIn: activeCodes } },
        { deletedAt: null },
        {
          NOT: {
            OR: [
              { code: { startsWith: 'kb_' } },
              { remark: { startsWith: 'knowledgeItemId=' } },
            ],
          },
        },
      ],
    },
    data: {
      deletedAt: new Date(),
      status: CommonStatus.disabled,
      publishStatus: DatasetPublishStatus.unpublished,
      visibility: DatasetVisibility.private,
    },
  });
  if (retired.count > 0) {
    console.log(`已下线过期来源编码 ${retired.count} 条（DS* 且不在当前字典中）`);
  }
}

async function main() {
  await ensureSourceCategories();
  await retireStaleSourceCodes();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of dataSources) {
    const categoryCode = CATEGORY_CODE[item.category];
    if (!categoryCode) {
      skipped += 1;
      console.warn(`跳过未知分类: ${item.id} ${item.category}`);
      continue;
    }
    const status =
      item.status === '停用' ? CommonStatus.disabled : CommonStatus.active;
    const payload = {
      name: item.name,
      nameEn: item.en ?? null,
      categoryCode,
      regionLevel: item.region ?? null,
      websiteUrl: item.site ?? null,
      remark: item.note ?? null,
      status,
      description: item.note ?? null,
      visibility:
        status === CommonStatus.active
          ? DatasetVisibility.public
          : DatasetVisibility.private,
      publishStatus:
        status === CommonStatus.active
          ? DatasetPublishStatus.published
          : DatasetPublishStatus.unpublished,
      deletedAt: null,
    };

    const existing = await prisma.dataset.findFirst({
      where: { code: item.id },
    });
    if (existing) {
      await prisma.dataset.update({
        where: { id: existing.id },
        data: payload,
      });
      updated += 1;
    } else {
      await prisma.dataset.create({
        data: {
          code: item.id,
          ...payload,
        },
      });
      created += 1;
    }
  }

  console.log(
    `来源初始化完成：新增 ${created}，更新 ${updated}，跳过 ${skipped}，合计 ${dataSources.length}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
