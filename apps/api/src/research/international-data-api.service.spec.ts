import { ConfigService } from '@nestjs/config';
import { InternationalDataApiService } from './international-data-api.service';
import type { ResearchQueryPlan } from '../modules/search/research-query-plan';

describe('InternationalDataApiService', () => {
  const plan = {
    entities: ['China'],
    periods: ['2022'],
    metrics: ['life expectancy'],
  } as ResearchQueryPlan;

  afterEach(() => jest.restoreAllMocks());

  it('queries a selected WHO source and returns normalized structured observations', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          value: [
            {
              SpatialDim: 'CHN',
              TimeDim: 2022,
              NumericValue: 78.2,
              Dim1: 'SEX_BTSX',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const service = new InternationalDataApiService(new ConfigService());

    const results = await service.retrieve(
      [
        {
          websiteUrl: 'https://www.who.int/data/gho',
          query: 'China life expectancy',
        },
      ],
      'China life expectancy 2022',
      plan,
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(results[0]).toMatchObject({
      officialProvider: 'who-api',
      url: expect.stringContaining(
        'https://ghoapi.azureedge.net/api/WHOSIS_000001',
      ),
      officialData: [
        expect.objectContaining({
          countryCode: 'CHN',
          year: 2022,
          value: 78.2,
          unit: 'years',
        }),
      ],
    });
  });

  it('does not call an API unless the research planner selected its source', async () => {
    const fetch = jest.spyOn(global, 'fetch');
    const service = new InternationalDataApiService(new ConfigService());

    const results = await service.retrieve(
      [
        {
          websiteUrl: 'https://data.example.org',
          query: 'China life expectancy',
        },
      ],
      'China life expectancy 2022',
      plan,
    );

    expect(results).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns selected IMF Australia forecast years as structured GDP observations', async () => {
    const fetch = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          values: {
            NGDPD: {
              AUS: { '2026': 1900, '2027': 1980, '2025': 1810 },
            },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const service = new InternationalDataApiService(new ConfigService());

    const results = await service.retrieve(
      [
        {
          websiteUrl: 'https://www.imf.org/en/Data',
          query: 'Australia GDP forecast',
        },
      ],
      '澳大利亚 GDP 预测 2026-2027',
      {
        ...plan,
        entities: ['澳大利亚'],
        periods: ['2026', '2027'],
        metrics: ['GDP forecast'],
      },
    );

    expect(fetch).toHaveBeenCalledWith(
      'https://www.imf.org/external/datamapper/api/v1/NGDPD',
      expect.any(Object),
    );
    expect(results[0]).toMatchObject({
      officialProvider: 'imf-api',
      officialData: [
        expect.objectContaining({
          countryCode: 'AUS',
          year: 2026,
          value: 1900,
        }),
        expect.objectContaining({
          countryCode: 'AUS',
          year: 2027,
          value: 1980,
        }),
      ],
    });
  });
});
