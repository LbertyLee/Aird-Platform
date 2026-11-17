import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { ExaSearchService } from './exa-search.service';

describe('ExaSearchService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses explicit discovery to find sites when proposed websites return nothing', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ results: [] })));
    const service = new ExaSearchService(new ConfigService({ EXA_API_KEY: 'test-key' }));
    const result = await service.discoverSources('robot density 2024', ['https://ifr.org']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).includeDomains).toEqual(['ifr.org']);
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).includeDomains).toBeUndefined();
    expect(result.attempted).toBe(2);
  });

  it('does not call Exa when the API key is not configured', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    const service = new ExaSearchService(new ConfigService({}));

    await expect(
      service.search('China GDP', ['worldbank.org']),
    ).resolves.toEqual([]);
    expect(service.configured).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the selected official domain and maps returned content', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: 'GDP data',
              url: 'https://data.worldbank.org/gdp.csv',
              text: 'Annual GDP observations',
              highlights: ['China GDP increased'],
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const service = new ExaSearchService(
      new ConfigService({ EXA_API_KEY: 'test-key', EXA_SEARCH_COUNT: 3 }),
    );

    const results = await service.search('China GDP', ['worldbank.org']);

    expect(service.configured).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.exa.ai/search');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toMatchObject({
      query: 'China GDP',
      numResults: 3,
      includeDomains: ['worldbank.org'],
    });
    expect(JSON.parse(init?.body as string).contents).toEqual({
      text: { maxCharacters: 1500 },
      highlights: { query: 'China GDP', numSentences: 3, highlightsPerUrl: 3 },
    });
    expect(results).toEqual([
      {
        title: 'GDP data',
        url: 'https://data.worldbank.org/gdp.csv',
        description: 'Annual GDP observations\nChina GDP increased',
        extraSnippets: ['China GDP increased'],
      },
    ]);
  });

  it('fetches deferred full text via Exa Contents for selected URLs', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: 'GDP data',
              url: 'https://data.worldbank.org/gdp.csv',
              text: 'Full page body with multi-year GDP series…',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const service = new ExaSearchService(
      new ConfigService({ EXA_API_KEY: 'test-key' }),
    );

    const contents = await service.getContents([
      'https://data.worldbank.org/gdp.csv',
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.exa.ai/contents',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]?.body as string),
    ).toMatchObject({
      urls: ['https://data.worldbank.org/gdp.csv'],
      text: { maxCharacters: 50_000 },
    });
    expect(contents.get('https://data.worldbank.org/gdp.csv')?.text).toContain(
      'Full page body',
    );
  });

  it('does not issue an unrestricted request when no configured domain is available', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ results: [] })));
    const service = new ExaSearchService(
      new ConfigService({ EXA_API_KEY: 'test-key' }),
    );

    await expect(service.search('global GDP', [])).resolves.toEqual([]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns a useful error for a rejected Exa request', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          tag: 'INVALID_DOMAIN',
          error: 'Domain must include a top-level domain: localhost',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const service = new ExaSearchService(
      new ConfigService({ EXA_API_KEY: 'test-key' }),
    );

    await expect(
      service.search('China GDP', ['worldbank.org']),
    ).rejects.toEqual(
      new ServiceUnavailableException(
        'Exa Search 返回 400（INVALID_DOMAIN）：Domain must include a top-level domain: localhost',
      ),
    );
  });

  it('batches configured domains, accepts bare domains and reports failures', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            results: [
              {
                title: 'World Bank GDP',
                url: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      )
      .mockResolvedValueOnce(new Response('', { status: 429 }));
    const service = new ExaSearchService(
      new ConfigService({
        EXA_API_KEY: 'test-key',
        EXA_SOURCE_DOMAIN_BATCH_SIZE: 2,
        EXA_SOURCE_SEARCH_CONCURRENCY: 1,
      }),
    );

    const summary = await service.searchSources('China GDP', [
      { id: 'world-bank', name: '世界银行', websiteUrl: 'www.worldbank.org' },
      {
        id: 'world-bank-copy',
        name: '世界银行镜像',
        websiteUrl: 'https://worldbank.org',
      },
      { id: 'imf', name: '国际货币基金组织', websiteUrl: 'www.imf.org' },
      { id: 'un', name: '联合国', websiteUrl: 'www.un.org' },
      {
        id: 'invalid',
        name: '无效来源',
        websiteUrl: 'mailto:test@example.com',
      },
      {
        id: 'intranet',
        name: '内网来源',
        websiteUrl: 'localhost',
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]?.body as string).includeDomains,
    ).toEqual(['worldbank.org', 'imf.org']);
    expect(summary).toMatchObject({
      attempted: 2,
      succeeded: 1,
      failed: 1,
      skipped: 2,
    });
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].sourceId).toBe('');
  });
});
