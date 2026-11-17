jest.mock('@prisma/client', () => ({
  KnowledgeVisibility: { public: 'public' },
}));

import { KnowledgeVisibility } from '@prisma/client';
import {
  buildKnowledgeEvidenceTitle,
  resolveKnowledgeSourceScope,
  mapQueryEvidenceToSources,
  toResearchSourceResponse,
} from './query-evidence-sources.mapper';

describe('query-evidence-sources.mapper', () => {
  it.each(['world-bank-api', 'eurostat-api', 'custom-api'])(
    'persists %s rows as structured sources with their original API URL',
    async (provider) => {
      const rows = [
        {
          country: 'Russian Federation',
          year: 2024,
          value: 100,
          unit: '美元',
          indicatorCode: 'gdp_current_usd',
        },
      ];
      const createSource = jest
        .fn()
        .mockImplementation(async (input) => ({ id: 'source', ...input }));
      await mapQueryEvidenceToSources(
        [
          {
            id: 'ev',
            aiQueryId: 'q',
            evidenceType: 'external',
            sourceType: 'exa',
            sourceId: null,
            content: 'World Bank GDP\nOfficial observations',
            sql: null,
            score: 1,
            metadataJson: {
              provider,
              url: 'https://api.worldbank.org/v2/',
              structuredData: rows,
            },
          },
        ],
        { repository: { createSource } as never, prisma: {} as never },
      );
      expect(createSource).toHaveBeenCalledWith(
        expect.objectContaining({
          storageType: 'structured',
          sourceUrl: 'https://api.worldbank.org/v2/',
          structuredData: rows,
          recordCount: 1,
        }),
      );
    },
  );
  const publicDoc = {
    id: 'doc-1',
    title: '统计公报',
    submittedBy: null,
    library: {
      name: '平台公用库',
      visibility: KnowledgeVisibility.public,
      createdBy: 'admin',
    },
  };

  it('labels platform public knowledge when user does not own the document', () => {
    expect(resolveKnowledgeSourceScope(publicDoc, 'user-a')).toBe(
      'platform_public',
    );
  });

  it('labels user knowledge when the library belongs to the user', () => {
    expect(
      resolveKnowledgeSourceScope(
        {
          ...publicDoc,
          library: {
            ...publicDoc.library!,
            createdBy: 'user-a',
          },
        },
        'user-a',
      ),
    ).toBe('user');
  });

  it('builds readable titles from document metadata', () => {
    expect(buildKnowledgeEvidenceTitle('GDP 概览', { pageNumber: 3 }, 0)).toBe(
      'GDP 概览 · 第 3 页',
    );
  });

  it('renders official API excerpts as readable observations while retaining rows', () => {
    const rows = [
      {
        country: 'China',
        year: 2024,
        indicatorCode: 'NY.GDP.MKTP.KD.ZG',
        value: 5,
        unit: '%',
      },
    ];
    const source = toResearchSourceResponse({
      id: 'api-source',
      title: 'World Bank GDP growth',
      origin: 'exa',
      storageType: 'structured',
      excerpt: '{"country":"China","indicatorCode":"NY.GDP.MKTP.KD.ZG"}',
      structuredData: rows,
      metadata: { analysisProvider: 'world-bank-api' },
    } as never);

    expect(source.excerpt).toContain('China 2024年 NY.GDP.MKTP.KD.ZG：5 %');
    expect(source.structuredData).toEqual(rows);
  });
});
