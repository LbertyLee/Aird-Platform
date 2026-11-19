import { WorldBankDataService } from './world-bank-data.service';
import type { ResearchQueryPlan } from '@agent/contracts';
import type { SourceEntity } from './research.types';

describe('WorldBankDataService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fetches selected countries, a recognized indicator and time range as rows', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          { page: 1, pages: 1 },
          [
            {
              indicator: { id: 'NY.GDP.MKTP.CD', value: 'GDP (current US$)' },
              country: { id: 'CN', value: 'China' },
              countryiso3code: 'CHN',
              date: '2024',
              value: 18000000000000,
            },
          ],
        ]),
        { status: 200 },
      ),
    );
    const service = new WorldBankDataService();

    const datasets = await service.fetch(
      {
        countries: ['China'],
        regions: [],
        entities: [],
        indicators: ['GDP'],
        timeRanges: ['2020-2024'],
        sources: ['World Bank'],
        intent: 'lookup',
        confidence: 0.9,
        explanation: 'test',
      },
      'World Bank GDP trend',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      '/country/CHN/indicator/NY.GDP.MKTP.CD',
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain('date=2020%3A2024');
    expect(datasets[0]?.structuredData).toEqual([
      expect.objectContaining({
        country: 'China',
        year: 2024,
        value: 18000000000000,
      }),
    ]);
  });

  it('does not request World Bank without a matching source or question', async () => {
    const service = new WorldBankDataService();
    expect(
      service.isRequested(
        {
          countries: [],
          regions: [],
          entities: [],
          indicators: ['GDP'],
          timeRanges: [],
          sources: [],
          intent: 'lookup',
          confidence: 0.5,
          explanation: 'test',
        },
        'GDP trend',
      ),
    ).toBe(false);
  });

  it('keeps successful indicators when another indicator request times out', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).includes('NY.GDP.MKTP.CD')) {
        throw new Error('timeout');
      }
      return new Response(
        JSON.stringify([
          {},
          [
            {
              indicator: { id: 'SP.POP.TOTL', value: 'Population, total' },
              country: { id: 'CN', value: 'China' },
              countryiso3code: 'CHN',
              date: '2024',
              value: 1400000000,
            },
          ],
        ]),
        { status: 200 },
      );
    });
    const service = new WorldBankDataService();

    const datasets = await service.fetch(
      {
        countries: ['China'],
        regions: [],
        entities: [],
        indicators: ['GDP', 'Population'],
        timeRanges: [],
        sources: ['World Bank'],
        intent: 'lookup',
        confidence: 0.9,
        explanation: 'test',
      },
      'World Bank GDP and population',
    );

    expect(datasets).toHaveLength(1);
    expect(datasets[0]?.structuredData[0]).toEqual(
      expect.objectContaining({ indicatorCode: 'SP.POP.TOTL' }),
    );
  }, 15000);
});

describe('World Bank selected source hydration', () => {
  const plan: ResearchQueryPlan = {
    countries: ['美国'],
    regions: [],
    entities: [],
    indicators: ['GDP'],
    timeRanges: ['2021', '2022', '2023', '2024', '2025'],
    sources: [],
    intent: 'lookup',
    confidence: 1,
    explanation: 'test',
  };
  const page = (
    id: string,
    sourceUrl = 'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD?locations=US',
  ): SourceEntity => ({
    id,
    title: 'World Bank GDP',
    sourceUrl,
    origin: 'exa',
    storageType: 'knowledge',
    mimeType: 'text/html',
    textContent: 'GDP indicator metadata only',
    excerpt: '',
    recordCount: 0,
    createdAt: '2026-11-12T00:00:00Z',
  });
  const row = {
    countryiso3code: 'USA',
    country: { value: 'United States' },
    indicator: { id: 'NY.GDP.MKTP.CD', value: 'GDP (current US$)' },
    date: '2024',
    value: 29e12,
  };
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('recognizes real World Bank hosts, fetches once for seven pages, and keeps source IDs and original text', async () => {
    jest.useFakeTimers({ doNotFake: ['setTimeout'] });
    jest.setSystemTime(new Date('2026-11-12T00:00:00Z'));
    const api = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify([{}, [row]])));
    const sources = Array.from({ length: 7 }, (_, index) =>
      page(`page-${index}`),
    );
    const result = await new WorldBankDataService().hydrateSources(
      sources,
      {
        ...plan,
        timeRanges: ['2022-2026'],
      },
      '美国近5年GDP',
      ['gdp_current_usd'],
    );
    expect(api).toHaveBeenCalledTimes(1);
    const url = new URL(String(api.mock.calls[0][0]));
    expect(url.searchParams.get('date')).toBe('2021:2025');
    expect(result.map((source) => source.id)).toEqual(
      sources.map((source) => source.id),
    );
    expect(
      result.flatMap((source) => source.structuredData ?? []),
    ).toHaveLength(1);
    expect(result[0].structuredData).toEqual([
      expect.objectContaining({
        indicatorCode: 'gdp_current_usd',
        worldBankIndicatorCode: 'NY.GDP.MKTP.CD',
        unit: '美元',
        value: 29e12,
      }),
    ]);
    expect(result[0].textContent).toBe(sources[0].textContent);
    expect(sources[0].structuredData).toBeUndefined();
  });

  it('fetches available observations for a range longer than 100 years', async () => {
    const api = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{}, [row, { ...row, date: '2025', value: null }]])),
    );
    const result = await new WorldBankDataService().hydrateSources(
      [page('page')],
      { ...plan, timeRanges: ['1900-2026'] },
      '美国1900-2026年GDP总量',
      ['gdp_current_usd'],
    );
    expect(new URL(String(api.mock.calls[0][0])).searchParams.get('date')).toBe('1900:2026');
    expect(result[0].structuredData).toEqual([
      expect.objectContaining({ year: 2024, value: 29e12 }),
    ]);
  });

  it.each([
    'https://worldbank.org.attacker.test/indicator/NY.GDP.MKTP.CD',
    'https://attacker.test/?source=worldbank.org',
    'https://example.com/worldbank.org',
    'not-a-url',
  ])('does not trust a title or lookalike domain: %s', async (url) => {
    const api = jest.spyOn(globalThis, 'fetch');
    const sources = [page('page', url)];
    expect(
      await new WorldBankDataService().hydrateSources(
        sources,
        plan,
        '美国GDP',
        ['gdp_current_usd'],
      ),
    ).toBe(sources);
    expect(api).not.toHaveBeenCalled();
  });

  it('keeps existing structured sources intact and skips unsupported countries and subnational scope', async () => {
    const api = jest.spyOn(globalThis, 'fetch');
    const service = new WorldBankDataService();
    const source = {
      ...page('structured'),
      structuredData: [{ value: 123 }],
      storageType: 'structured' as const,
    };
    expect(
      (
        await service.hydrateSources([source], plan, '美国GDP', [
          'gdp_current_usd',
        ])
      )[0],
    ).toBe(source);
    const sources = [page('page')];
    expect(
      await service.hydrateSources(
        sources,
        { ...plan, countries: ['未知国家'] },
        'GDP',
        ['gdp_current_usd'],
      ),
    ).toBe(sources);
    expect(
      await service.hydrateSources(
        sources,
        { ...plan, regions: ['纽约'] },
        '纽约GDP',
        ['gdp_current_usd'],
      ),
    ).toBe(sources);
    expect(api).not.toHaveBeenCalled();
  });

  it('rejects null, non-finite, wrong-country, wrong-indicator and out-of-range observations', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify([
            {},
            [
              row,
              { ...row, value: null },
              { ...row, value: '29000000000000' },
              { ...row, date: '2020' },
              { ...row, countryiso3code: 'CHN' },
              { ...row, indicator: { id: 'NY.GDP.PCAP.CD' } },
            ],
          ]),
        ),
      );
    const result = await new WorldBankDataService().hydrateSources(
      [page('page')],
      plan,
      '美国GDP',
      ['gdp_current_usd'],
    );
    expect(result[0].structuredData).toHaveLength(1);
  });

  it('preserves the text extraction fallback when the API fails', async () => {
    const api = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('unavailable'));
    const sources = [page('page')];
    const result = await new WorldBankDataService().hydrateSources(
      sources,
      plan,
      '美国GDP',
      ['gdp_current_usd'],
    );
    expect(api).toHaveBeenCalledTimes(3);
    expect(result[0]).toBe(sources[0]);
  });

  it('does not invent observations for missing years or map unknown catalog codes', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify([{}, [row, { ...row, date: '2025', value: null }]]),
        ),
      );
    const sources = [page('page')];
    const result = await new WorldBankDataService().hydrateSources(
      sources,
      plan,
      '美国GDP',
      ['unrelated_metric'],
    );
    expect(result[0]).toBe(sources[0]);
  });

  it.each([
    ['人均GDP', ['NY.GDP.PCAP.CD']],
    ['GDP实际增速', ['NY.GDP.MKTP.KD.ZG']],
    ['比较2020-2025年中美GDP增长率', ['NY.GDP.MKTP.KD.ZG']],
    ['GDP不变价', []],
    ['人口自然增长率', []],
    ['人口增长率', ['SP.POP.GROW']],
  ])('keeps statistical definitions distinct for %s', (indicator, expected) => {
    expect(
      new WorldBankDataService().getCriteria(
        { ...plan, sources: ['World Bank'], indicators: [indicator] },
        indicator,
      )?.indicatorCodes ?? [],
    ).toEqual(expected);
  });

  it('honors a single explicitly selected year', () => {
    expect(
      new WorldBankDataService().getCriteria(
        { ...plan, sources: ['World Bank'], timeRanges: ['2024'] },
        '美国2024年GDP',
      ),
    ).toMatchObject({ start: 2024, end: 2024, countries: ['USA'] });
  });

  it.each(['全球', '世界', 'World', 'global', 'WLD'])(
    'accepts explicitly selected global scope: %s',
    (country) => {
      expect(
        new WorldBankDataService().getCriteria(
          { ...plan, sources: ['World Bank'], countries: [country] },
          '全球GDP',
        ),
      ).toMatchObject({ countries: ['WLD'] });
    },
  );

  it('keeps only explicitly selected non-consecutive years', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          {},
          [
            { ...row, date: '2021' },
            { ...row, date: '2022' },
            { ...row, date: '2024' },
          ],
        ]),
      ),
    );
    const result = await new WorldBankDataService().hydrateSources(
      [page('page')],
      { ...plan, timeRanges: ['2021', '2024'] },
      '美国2021和2024年GDP',
      ['gdp_current_usd'],
    );
    expect(
      (result[0].structuredData as Array<{ year: number }>).map(
        (item) => item.year,
      ),
    ).toEqual([2021, 2024]);
  });
});
