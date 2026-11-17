import { SiteDataDiscoveryService, needsStructuredDiscovery } from './site-data-discovery.service';
import type { DocumentParserService } from './document-parser.service';
import type { SourceEntity } from './research.types';

describe('SiteDataDiscoveryService', () => {
  const config = { get: jest.fn().mockReturnValue(undefined) };

  afterEach(() => jest.restoreAllMocks());

  it('only enables directory exploration for structured multi-year or download requests', () => {
    expect(needsStructuredDiscovery('人口趋势怎么样？')).toBe(false);
    expect(needsStructuredDiscovery('中国1950—2100逐年人口和出生数')).toBe(true);
    expect(needsStructuredDiscovery('下载人口数据集')).toBe(true);
  });

  it('follows same-site catalogue links and parses a discovered CSV', async () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://stats.example.org/') {
        return new Response('<a href="/downloads">Downloads</a>', { headers: { 'content-type': 'text/html' } });
      }
      if (url === 'https://stats.example.org/downloads') {
        return new Response('<a href="/files/population.csv">Population data CSV</a>', { headers: { 'content-type': 'text/html' } });
      }
      if (url === 'https://stats.example.org/files/population.csv') {
        return new Response('country,year,population\nChina,2024,1419', { headers: { 'content-type': 'text/csv' } });
      }
      return new Response('forbidden', { status: 403 });
    });
    global.fetch = fetchMock as typeof fetch;
    const parser = {
      parseBuffer: jest.fn().mockResolvedValue({
        storageType: 'structured',
        textContent: 'China 2024 1419',
        structuredData: [{ country: 'China', year: '2024', population: '1419' }],
        recordCount: 1,
        metadata: { format: 'csv' },
      }),
    } as unknown as DocumentParserService;
    const service = new SiteDataDiscoveryService(parser, config as never);
    const source = {
      id: 'source-1', sourceUrl: 'https://stats.example.org/', title: 'Population portal',
    } as SourceEntity;

    try {
      const results = await service.discover([source], 'China 1950—2100 annual population births dataset');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        sourceUrl: 'https://stats.example.org/files/population.csv',
        storageType: 'structured',
        recordCount: 1,
        metadata: { provider: 'site-navigation', discoveredFrom: 'https://stats.example.org/' },
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      await service.discover([source], 'China 1950—2100 annual population dataset with births');
      expect(fetchMock).toHaveBeenCalledTimes(6);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
