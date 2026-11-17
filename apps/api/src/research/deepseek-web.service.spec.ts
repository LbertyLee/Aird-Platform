import { ConfigService } from '@nestjs/config';
import { ExaSearchService } from './exa-search.service';

describe('DeepSeek web integration', () => {
  afterEach(() => jest.restoreAllMocks());
  const service = () =>
    new ExaSearchService(
      new ConfigService({
        DEEPSEEK_SEARCH_API_KEY: 'test-deepseek-key',
        EXA_API_KEY: 'legacy-key',
        EXA_SEARCH_COUNT: 5,
      }),
    );
  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), { status });

  it('supports explicit open-web discovery with English queries while rejecting non-http results', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(json({ results: [
      { title: 'Robot density', url: 'https://ifr.org/report', summary: 'Indonesia robot density' },
      { title: 'Invalid', url: 'file:///private' },
    ] }));
    const results = await service().search('Indonesia robot density 2024', [], 'deepseek', true);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).query).toBe('Indonesia robot density 2024');
    expect(results.map((item) => item.url)).toEqual(['https://ifr.org/report']);
  });

  it('selects DeepSeek and preserves domain restrictions, excerpts and normalized scores', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      json({
        results: [
          {
            title: 'GDP',
            url: 'https://data.worldbank.org/gdp',
            summary: 'Annual GDP',
            snippet: 'GDP data',
            rerank_score: 2.4,
          },
          {
            title: 'Untrusted',
            url: 'https://worldbank.org.attacker.test/gdp',
          },
        ],
      }),
    );
    const adapter = service();
    expect(adapter.configured).toBe(true);
    expect(adapter.isConfigured('deepseek')).toBe(true);
    const results = await adapter.search('China GDP', ['worldbank.org'], 'deepseek');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/tools/search',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-deepseek-key',
          'Content-Type': 'application/json',
        },
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      query: 'China GDP site:worldbank.org',
      count: 5,
      need_content: false,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'GDP',
      description: 'Annual GDP',
      extraSnippets: ['GDP data'],
    });
    expect(results[0].score).toBeCloseTo(0.8);
  });

  it('bounds Unicode queries and queries each configured domain explicitly', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => json({ results: [] }));
    await service().search('经济😀'.repeat(100), ['worldbank.org', 'imf.org'], 'deepseek');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const queries = fetchMock.mock.calls.map(
      ([, init]) => JSON.parse(init!.body as string).query as string,
    );
    expect(queries.every((query) => Array.from(query).length <= 128)).toBe(
      true,
    );
    expect(queries[0]).toMatch(/ site:worldbank\.org$/);
    expect(queries[1]).toMatch(/ site:imf\.org$/);
  });

  it('never searches without configured sources', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    expect(await service().search('GDP', [], 'deepseek')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches Markdown once per unique URL and keeps successes when a page fails', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        json({ title: 'GDP', content: '# GDP\n\n123456789' }),
      )
      .mockResolvedValueOnce(json({ error: { message: 'unavailable' } }, 404));
    const url = 'https://worldbank.org/gdp';
    const results = await service().getContents(
      [
        url,
        url,
        'https://imf.org/missing',
        'file:///secret',
        'https://user:pass@example.com/',
      ],
      8,
      'deepseek',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.deepseek.com/v1/tools/fetch',
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({
      url,
    });
    expect(results.get(url)).toEqual({ title: 'GDP', text: '# GDP\n\n1', url });
    expect(results.size).toBe(1);
  });

  it.each([400, 401, 402, 403, 404])(
    'does not retry permanent error %s or leak upstream content',
    async (status) => {
      const fetchMock = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async () =>
          json({ error: { message: 'private upstream data' } }, status),
        );
      await expect(service().search('GDP', ['imf.org'], 'deepseek')).rejects.toThrow(
        `DeepSeek search 返回 ${status}`,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('retries temporary upstream failures', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({}, 429))
      .mockResolvedValueOnce(json({ results: [] }));
    await expect(service().search('GDP', ['imf.org'], 'deepseek')).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed successful responses', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(json({}));
    await expect(service().search('GDP', ['imf.org'], 'deepseek')).rejects.toThrow(
      '响应格式无效',
    );
  });

  it('keeps Exa selected by default even when a DeepSeek key exists', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(json({ results: [] }));
    const adapter = service();
    await adapter.search('GDP', ['imf.org']);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.exa.ai/search');
    expect(adapter.provider).toBe('exa');
  });

  it('preserves other source results when one domain fails', async () => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const payload = JSON.parse(init!.body as string) as { query: string };
      return payload.query.includes('site:imf.org')
        ? json({}, 403)
        : json({ results: [{ title: 'GDP', url: 'https://worldbank.org/gdp' }] });
    });
    const summary = await service().searchSources('GDP', [
      { id: 'wb', name: 'World Bank', websiteUrl: 'https://worldbank.org' },
      { id: 'imf', name: 'IMF', websiteUrl: 'https://imf.org' },
    ], 'deepseek');
    expect(summary).toMatchObject({ attempted: 2, succeeded: 1, failed: 1 });
    expect(summary.results[0].results[0].title).toBe('GDP');
  });
});
