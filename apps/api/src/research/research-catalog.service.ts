import { Injectable } from '@nestjs/common';
import {
  CommonStatus,
  DatasetPublishStatus,
  LocationKind,
} from '@prisma/client';
import type {
  ResearchFilterCatalog,
  ResearchFilterOption,
} from '@agent/contracts';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { SYSTEM_DICT_CODES } from '../modules/dictionary/dictionary-type.constants';
import { externalSourceDatasetWhere } from '../modules/dataset/dataset-scope';
import { recentCompletedRangeLabel } from '../common/utils/recent-years';

export interface ResearchCatalogEntry extends ResearchFilterOption {
  aliases: string[];
  datasetId?: string;
}

export interface ResearchCatalog {
  filters: ResearchFilterCatalog;
  entries: Record<keyof ResearchFilterCatalog, ResearchCatalogEntry[]>;
}

@Injectable()
export class ResearchCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async load(): Promise<ResearchCatalog> {
    const [dictionaryItems, indicators, datasets] = await Promise.all([
      this.prisma.dictionaryItem.findMany({
        where: { deletedAt: null, status: CommonStatus.active },
        select: {
          type: true,
          code: true,
          name: true,
          aliases: true,
          locationKind: true,
        },
        orderBy: [{ type: 'asc' }, { sort: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.indicator.findMany({
        where: { deletedAt: null, status: CommonStatus.active },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.dataset.findMany({
        where: {
          deletedAt: null,
          publishStatus: DatasetPublishStatus.published,
          ...externalSourceDatasetWhere(),
        },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const locations = dictionaryItems.filter(
      (item) => item.type === SYSTEM_DICT_CODES.country_region,
    );
    const organizations = dictionaryItems.filter(
      (item) => item.type === SYSTEM_DICT_CODES.organization,
    );
    const industries = dictionaryItems.filter(
      (item) => item.type === SYSTEM_DICT_CODES.industry,
    );
    const entries: ResearchCatalog['entries'] = {
      countries: this.entries(
        locations.filter((item) => item.locationKind === LocationKind.country),
      ),
      regions: this.entries(
        locations.filter((item) => item.locationKind === LocationKind.region),
      ),
      entities: this.entries([...organizations, ...industries]),
      indicators: this.entries(indicators),
      timeRanges: [5, 10, 15].map((years) => {
        const value = recentCompletedRangeLabel(years);
        return { value, label: value, aliases: [`近${years}年`] };
      }),
      sources: [
        ...this.entries(organizations).map((entry) => ({
          ...entry,
          kind: 'organization' as const,
        })),
        ...datasets.map((dataset) => ({
          value: dataset.name,
          label: dataset.name,
          aliases: [dataset.code].filter(Boolean),
          datasetId: dataset.id,
          kind: 'dataset' as const,
        })),
      ],
    };

    return {
      entries,
      filters: Object.fromEntries(
        Object.entries(entries).map(([key, values]) => [
          key,
          values.map(({ value, label, kind }) => ({ value, label, kind })),
        ]),
      ) as ResearchFilterCatalog,
    };
  }

  private entries(
    items: Array<{ code: string; name: string; aliases?: string[] }>,
  ): ResearchCatalogEntry[] {
    const seen = new Set<string>();
    return items.flatMap((item) => {
      if (seen.has(item.name)) return [];
      seen.add(item.name);
      return [
        {
          value: item.name,
          label: item.name,
          aliases: [item.code, ...(item.aliases ?? [])].filter(
            (alias) => alias.trim().length > 0,
          ),
        },
      ];
    });
  }
}
