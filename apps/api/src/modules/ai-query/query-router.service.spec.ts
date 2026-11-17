import { QueryRouterService } from './query-router.service';
import type { SemanticResolution } from '../semantic/semantic.types';

const baseResolution: SemanticResolution = {
  metrics: [],
  entities: [],
  concepts: [],
  dimensions: [],
  time: { type: 'UNKNOWN' },
  confidence: 0.8,
  intent: 'metric_query',
};

describe('QueryRouterService', () => {
  const router = new QueryRouterService();

  it('uses hybrid retrieval for catalog and AI-discovered metrics together', () => {
    expect(
      router.route(
        {
          ...baseResolution,
          metrics: [{ code: 'GDP', name: 'GDP', indicatorId: 'gdp-id' }],
          discovery: {
            metrics: ['green technology patents'],
            entities: [],
            dimensions: [],
            dataNeeds: [],
            websites: [],
          },
        },
        'GDP and green technology patents',
      ),
    ).toBe('hybrid');
  });

  it('keeps AI-only metrics on semantic retrieval', () => {
    expect(
      router.route(
        {
          ...baseResolution,
          discovery: {
            metrics: ['green technology patents'],
            entities: [],
            dimensions: [],
            dataNeeds: [],
            websites: [],
          },
        },
        'green technology patents',
      ),
    ).toBe('semantic');
  });
});
