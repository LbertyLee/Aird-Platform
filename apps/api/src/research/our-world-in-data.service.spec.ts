import {
  OWID_MADDISON_CSV_URL,
  OurWorldInDataService,
} from './our-world-in-data.service';
import type { SourceEntity } from './research.types';

const source = (
  sourceUrl = 'https://ourworldindata.org/grapher/gdp-per-capita-maddison-project-database',
): SourceEntity => ({
  id: 'maddison',
  title: 'Maddison GDP per capita',
  sourceUrl,
  origin: 'exa',
  storageType: 'knowledge',
  mimeType: 'text/html',
  textContent: 'Maddison Project Database GDP per capita',
  excerpt: '',
  recordCount: 0,
  createdAt: '2026-11-19T00:00:00Z',
});

function csvFixture() {
  const rows = [
    'Entity,Code,Year,GDP per capita,GDP per capita (Annotations)',
    'World,OWID_WRL,2000,12000,',
    'China,CHN,1950,448,',
    'China,CHN,2022,12720,',
    'Western Europe,OWID_WEUR,2020,32000,',
  ];
  for (let index = 0; index < 20_001; index += 1) {
    rows.push(
      `Test entity ${index},OWID_TEST,${(index % 2022) + 1},${index + 1},`,
    );
  }
  return rows.join('\n');
}

describe('OurWorldInDataService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('hydrates the requested country and years with source metadata', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () => new Response(csvFixture(), { status: 200 }),
      );

    const result = await new OurWorldInDataService().hydrateSources(
      [source()],
      ['中国'],
      ['1950', '2022'],
    );

    expect(fetch).toHaveBeenCalledWith(
      OWID_MADDISON_CSV_URL,
      expect.objectContaining({ redirect: 'error' }),
    );
    expect(result[0]).toMatchObject({
      storageType: 'structured',
      recordCount: 2,
      metadata: {
        analysisProvider: 'owid-grapher',
        datasetRevision: 'Maddison Project Database 2023',
        datasetUnit: 'international-$ in 2011 prices',
      },
      structuredData: [
        expect.objectContaining({ countryCode: 'CHN', year: 1950, value: 448 }),
        expect.objectContaining({
          countryCode: 'CHN',
          year: 2022,
          value: 12720,
        }),
      ],
    });
  });

  it('selects named regions, defaults to World, and rejects lookalike hosts', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () => new Response(csvFixture(), { status: 200 }),
      );
    const service = new OurWorldInDataService();

    const region = await service.hydrateSources(
      [source()],
      [],
      ['2020'],
      ['Western Europe'],
    );
    expect(region[0].structuredData).toEqual([
      expect.objectContaining({ entity: 'Western Europe', year: 2020 }),
    ]);

    const world = await service.hydrateSources([source()], [], ['2000']);
    expect(world[0].structuredData).toEqual([
      expect.objectContaining({ entity: 'World', year: 2000 }),
    ]);

    const lookalike = [
      source(
        'https://ourworldindata.org.attacker.test/grapher/gdp-per-capita-maddison-project-database',
      ),
    ];
    expect(await service.hydrateSources(lookalike, ['China'], ['2022'])).toBe(
      lookalike,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
