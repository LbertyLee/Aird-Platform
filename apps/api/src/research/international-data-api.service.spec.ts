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
    const fetch = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
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
});
