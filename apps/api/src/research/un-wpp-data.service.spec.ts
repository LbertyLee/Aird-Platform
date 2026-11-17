import { gzipSync } from 'node:zlib';
import { UnWppDataService, WPP_2024_URL } from './un-wpp-data.service';
import type { SourceEntity } from './research.types';

const page = {
  id: 'pdf',
  title: 'World Population Prospects 2024 Methodology',
  origin: 'exa',
  storageType: 'knowledge',
  sourceUrl:
    'https://population.un.org/wpp/assets/Files/WPP2024_Methodology-Report_Final.pdf',
  textContent: 'Methodology only',
  recordCount: 0,
} as SourceEntity;
const csv =
  'ISO3_code,Location,Time,Variant,VarID,TPopulation1July,TFR,Births,NetMigrations\n' +
  'CHN,China,1950,Medium,2,544044.358,5.813,22293.375,-20.646\n' +
  'USA,United States of America,2100,Medium,2,421278.889,1.6469,3914.151,1226.443\n' +
  'JPN,Japan,1950,Medium,2,84000,3,1000,0\n' +
  'CHN,China,1950,High,3,999999,9,99999,999\n';

describe('UN WPP 2024 official annual data', () => {
  afterEach(() => jest.restoreAllMocks());

  it('streams gzip CSV, keeps country/year/medium constraints and converts thousands once', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(gzipSync(csv)));
    const service = new UnWppDataService();
    const sources = await service.hydrateSources(
      [page],
      '人口总量、总和生育率、新生人口、移民人口',
      ['中国', '美国'],
      ['1950', '2100'],
      ['population_total', 'tfr', 'births', 'net_migration'],
    );
    expect(fetch.mock.calls[0][0]).toBe(WPP_2024_URL);
    expect(sources[0].recordCount).toBe(8);
    const rows = sources[0].structuredData as Array<Record<string, unknown>>;
    expect(
      rows.find(
        (row) =>
          row.countryCode === 'CHN' && row.indicatorCode === 'population_total',
      ),
    ).toMatchObject({
      value: 544044358,
      unit: '人',
      sourceValue: 544044.358,
      sourceFileUnit: '千人',
      estimateType: 'estimate',
    });
    expect(
      rows.find(
        (row) =>
          row.countryCode === 'CHN' && row.indicatorCode === 'net_migration',
      )?.value,
    ).toBe(-20646);
    expect(
      rows.find(
        (row) => row.countryCode === 'USA' && row.indicatorCode === 'tfr',
      ),
    ).toMatchObject({
      value: 1.6469,
      variant: 'Medium',
      estimateType: 'projection',
    });
    expect(rows.every((row) => row.sourceUrl === WPP_2024_URL)).toBe(true);
  });

  it('does not fabricate missing cells, convert empty strings to zero, or confuse birth counts with rates', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () =>
          new Response(
            gzipSync(csv.replace('5.813,22293.375,-20.646', ',0,..')),
          ),
      );
    const sources = await new UnWppDataService().hydrateSources(
      [page],
      '总和生育率、新生人口、移民人口',
      ['中国'],
      ['1950'],
      ['tfr', 'births', 'net_migration', 'crude_birth_rate'],
    );
    expect(sources[0].structuredData).toEqual([
      expect.objectContaining({ indicatorCode: 'births', value: 0 }),
    ]);
  });

  it('leaves inaccessible or unsupported official downloads retryable and reports failure', async () => {
    const fetch = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('unavailable', { status: 503 }));
    const result = await new UnWppDataService().hydrateSources(
      [page],
      '总人口',
      ['中国'],
      ['1950'],
      ['population_total'],
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result[0].structuredData).toBeUndefined();
    expect(result[0].metadata?.officialDataUnavailable).toBe(true);
  });

  it('requires a selected official WPP source and never substitutes another country, metric, variant or provider', async () => {
    const fetch = jest.spyOn(globalThis, 'fetch');
    const service = new UnWppDataService();
    for (const source of [
      { ...page, origin: 'upload' as const },
      { ...page, sourceUrl: 'https://population.un.org.evil.test/wpp/' },
    ]) {
      expect(
        await service.hydrateSources(
          [source],
          '总人口',
          ['中国'],
          ['1950'],
          ['population_total'],
        ),
      ).toEqual([source]);
    }
    await service.hydrateSources(
      [page],
      'WPP 2022 总人口',
      ['中国'],
      ['1950'],
      ['population_total'],
    );
    await service.hydrateSources(
      [page],
      'high fertility scenario total population',
      ['中国'],
      ['1950'],
      ['population_total'],
    );
    await service.hydrateSources(
      [{ ...page, title: 'WPP2022' }],
      '总人口',
      ['中国'],
      ['1950'],
      ['population_total'],
    );
    await service.hydrateSources(
      [page],
      '高方案总人口',
      ['中国'],
      ['1950'],
      ['population_total'],
    );
    await service.hydrateSources(
      [page],
      '总人口',
      ['中国'],
      ['1950'],
      ['world_population'],
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('aborts a stalled response body instead of leaving the parser waiting indefinitely', async () => {
    jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      const controller = new AbortController();
      setImmediate(() => controller.abort());
      return controller.signal;
    });
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () => new Response(new ReadableStream({ start() {} })),
      );
    await expect(
      new UnWppDataService().download(['CHN'], [1950]),
    ).rejects.toThrow();
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('rejects unexpected official CSV schemas', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () => new Response(gzipSync('ISO3_code,Time\nCHN,1950\n')),
      );
    await expect(
      new UnWppDataService().download(['CHN'], [1950]),
    ).rejects.toThrow('schema mismatch');
  });

  it('rejects duplicate country/year observations instead of silently overwriting a revision', async () => {
    const duplicate = csv + 'CHN,China,1950,Medium,2,1,1,1,1\n';
    jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response(gzipSync(duplicate)));
    await expect(
      new UnWppDataService().download(['CHN'], [1950]),
    ).rejects.toThrow('duplicate country/year');
  });
});
