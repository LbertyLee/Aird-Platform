import { CommonStatus, LocationKind, PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { SYSTEM_DICT_CODES } from '../src/modules/dictionary/dictionary-type.constants';

interface CountryRecord {
  term: string;
  aliases: string[];
  category: string;
  code: string;
}

const prisma = new PrismaClient();

async function main() {
  const filePath = path.resolve(
    __dirname,
    '../resources/dictionaries/world-countries.json',
  );
  const records = JSON.parse(
    await readFile(filePath, 'utf8'),
  ) as CountryRecord[];
  const countries = records
    .filter((item) => item.category === 'country')
    .map(toDictionaryItem);

  if (countries.length < 200) {
    throw new Error(`国家地区数据不完整：仅读取到 ${countries.length} 条`);
  }
  const codes = new Set(countries.map((item) => item.code));
  if (codes.size !== countries.length) {
    throw new Error('国家地区数据存在重复 ISO-2 编码');
  }

  const typeCode = SYSTEM_DICT_CODES.country_region;
  const existingType = await prisma.dictionaryType.findFirst({
    where: { code: typeCode, deletedAt: null },
  });
  if (!existingType) {
    await prisma.dictionaryType.create({
      data: {
        code: typeCode,
        name: '国家地区',
        description: '国家与地区',
        sort: 10,
        status: CommonStatus.active,
        isSystem: true,
      },
    });
  }

  let created = 0;
  let updated = 0;
  for (const [index, country] of countries.entries()) {
    const where = {
      type: typeCode,
      code: country.code,
      deletedAt: null,
    };
    const existing = await prisma.dictionaryItem.findFirst({ where });
    const data = {
      type: typeCode,
      locationKind: LocationKind.country,
      code: country.code,
      name: country.name,
      aliases: country.aliases,
      description: '国家/地区',
      sort: (index + 1) * 10,
      deletedAt: null,
    };

    if (existing) {
      await prisma.dictionaryItem.update({
        where: { id: existing.id },
        data,
      });
      updated += 1;
    } else {
      await prisma.dictionaryItem.create({
        data: { ...data, status: CommonStatus.active },
      });
      created += 1;
    }
  }

  console.log(
    `国家地区导入完成：新增 ${created} 条，更新 ${updated} 条，共 ${countries.length} 个国家和地区。`,
  );
}

function toDictionaryItem(item: CountryRecord) {
  const alpha2 = item.aliases.find((alias) => /^[A-Z]{2}$/.test(alias));
  if (!alpha2 || !item.term || !item.code) {
    throw new Error(
      `国家地区数据缺少名称或 ISO 编码：${item.term || item.code}`,
    );
  }
  const aliases = [...new Set(item.aliases)]
    .filter((alias) => alias !== item.term && alias !== alpha2)
    .sort((left, right) => {
      const leftIsLatin = /^[\x00-\x7F]+$/.test(left);
      const rightIsLatin = /^[\x00-\x7F]+$/.test(right);
      return Number(rightIsLatin) - Number(leftIsLatin);
    });
  return { code: alpha2, name: item.term, aliases };
}

main()
  .catch((error: unknown) => {
    console.error('国家地区导入失败', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
