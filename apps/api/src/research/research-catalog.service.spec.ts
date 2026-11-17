import {
  CommonStatus,
  DatasetPublishStatus,
  LocationKind,
} from '@prisma/client';
import { externalSourceDatasetWhere } from '../modules/dataset/dataset-scope';
import { SYSTEM_DICT_CODES } from '../modules/dictionary/dictionary-type.constants';
import { ResearchCatalogService } from './research-catalog.service';

describe('ResearchCatalogService', () => {
  it('builds filters from active dictionaries, indicators and published datasets', async () => {
    const prisma = {
      dictionaryItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            type: SYSTEM_DICT_CODES.country_region,
            code: 'US',
            name: '美国',
            aliases: ['United States'],
            locationKind: LocationKind.country,
          },
          {
            type: SYSTEM_DICT_CODES.country_region,
            code: 'EU',
            name: '欧盟',
            aliases: ['European Union'],
            locationKind: LocationKind.region,
          },
          {
            type: SYSTEM_DICT_CODES.organization,
            code: 'WB',
            name: '世界银行',
            aliases: ['World Bank'],
            locationKind: null,
          },
        ]),
      },
      indicator: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'indicator-1', code: 'GDP', name: '国内生产总值' },
          ]),
      },
      dataset: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { id: 'dataset-1', code: 'DS-01', name: '全球经济数据集' },
          ]),
      },
    };
    const service = new ResearchCatalogService(prisma as never);

    const catalog = await service.load();

    expect(prisma.dictionaryItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { deletedAt: null, status: CommonStatus.active },
      }),
    );
    expect(prisma.dataset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletedAt: null,
          publishStatus: DatasetPublishStatus.published,
          ...externalSourceDatasetWhere(),
        },
      }),
    );
    expect(catalog.filters.countries).toEqual([
      { value: '美国', label: '美国' },
    ]);
    expect(catalog.filters.regions).toEqual([{ value: '欧盟', label: '欧盟' }]);
    expect(catalog.filters.indicators).toContainEqual({
      value: '国内生产总值',
      label: '国内生产总值',
    });
    expect(catalog.filters.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: '世界银行',
          kind: 'organization',
        }),
        expect.objectContaining({
          value: '全球经济数据集',
          kind: 'dataset',
        }),
      ]),
    );
    expect(catalog.entries.countries[0].aliases).toEqual([
      'US',
      'United States',
    ]);
    expect(catalog.entries.sources).toContainEqual(
      expect.objectContaining({
        value: '全球经济数据集',
        datasetId: 'dataset-1',
      }),
    );
  });
});
