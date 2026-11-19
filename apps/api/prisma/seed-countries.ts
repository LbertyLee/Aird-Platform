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

interface RegionRecord {
  term: string;
  aliases: string[];
  category: string;
  code: string;
  parent: string;
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
  const regionPath = path.resolve(
    __dirname,
    '../resources/dictionaries/world-regions.json',
  );
  const regionRecords = JSON.parse(
    await readFile(regionPath, 'utf8'),
  ) as RegionRecord[];
  const regions = regionRecords.filter((item) => item.category === 'region');

  if (countries.length < 200) {
    throw new Error(`国家地区数据不完整：仅读取到 ${countries.length} 条`);
  }
  const codes = new Set(countries.map((item) => item.code));
  if (codes.size !== countries.length) {
    throw new Error('国家地区数据存在重复 ISO-2 编码');
  }
  const regionCodes = new Set(regions.map((item) => item.code));
  if (regions.length < 4000 || regionCodes.size !== regions.length) {
    throw new Error('全球一级行政区数据不完整或存在重复编码');
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

  const countryNames = new Map(
    countries.map((country) => [country.code, country.name]),
  );
  const regionData = regions.map((region, index) => {
    const parentName = countryNames.get(region.parent);
    if (!parentName) {
      throw new Error(`地区 ${region.code} 找不到所属国家 ${region.parent}`);
    }
    return {
      type: typeCode,
      locationKind: LocationKind.region,
      code: region.code,
      name: region.term,
      aliases: region.aliases,
      description: `一级行政区（${parentName}）`,
      sort: 10000 + index,
      deletedAt: null,
    };
  });
  const existingRegions = await prisma.dictionaryItem.findMany({
    where: {
      type: typeCode,
      code: { in: regionData.map((region) => region.code) },
      deletedAt: null,
    },
    select: { id: true, code: true },
  });
  const existingRegionCodes = new Set(existingRegions.map((item) => item.code));
  const existingByCode = new Map(
    existingRegions.map((region) => [region.code, region.id]),
  );
  const newRegions = regionData.filter(
    (region) => !existingRegionCodes.has(region.code),
  );
  for (let index = 0; index < newRegions.length; index += 500) {
    const result = await prisma.dictionaryItem.createMany({
      data: newRegions
        .slice(index, index + 500)
        .map((region) => ({ ...region, status: CommonStatus.active })),
      skipDuplicates: true,
    });
    created += result.count;
  }
  for (let index = 0; index < regionData.length; index += 50) {
    const batch = regionData
      .slice(index, index + 50)
      .filter((region) => existingRegionCodes.has(region.code));
    await Promise.all(
      batch.map(async (region) => {
        await prisma.dictionaryItem.update({
          where: { id: existingByCode.get(region.code)! },
          data: region,
        });
        updated += 1;
      }),
    );
  }

  console.log(
    `国家地区导入完成：新增 ${created} 条，更新 ${updated} 条，包含 ${countries.length} 个国家和地区、${regions.length} 个一级行政区。`,
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
