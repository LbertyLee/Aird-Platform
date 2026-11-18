import { describe, expect, it } from 'vitest';
import {
  researchSearchResponseSchema,
  type ResearchSearchResponse,
} from '@agent/contracts';
import { buildSemanticParseSummary } from './semantic-parse-summary';

function response(): ResearchSearchResponse {
  return {
    runId: 'run',
    query: '主要经济体2025年工业机器人密度',
    mode: 'mixed',
    matchedLocally: false,
    usedExa: false,
    exaConfigured: false,
    cacheHit: false,
    cachedAt: null,
    plan: {
      countries: [],
      regions: [],
      entities: ['中国', '主要经济体'],
      indicators: ['GDP', '工业机器人密度'],
      dimensions: ['行业', '行业=制造业'],
      timeRanges: ['2025'],
      sources: [],
      intent: 'trend',
      confidence: 0.9,
      explanation: '已识别实体：中国、主要经济体。',
    },
    sources: [],
    stages: [],
  };
}

describe('semantic parse summary', () => {
  it('displays structured discovery fields after contract parsing without stage text', () => {
    const parsed = researchSearchResponseSchema.parse(response());

    expect(buildSemanticParseSummary(parsed)).toEqual({
      entities: ['中国', '主要经济体'],
      metrics: ['GDP', '工业机器人密度'],
      dimensions: ['行业', '行业=制造业', '2025'],
      explanation: parsed.plan.explanation,
    });
  });

  it('deduplicates structured values also present in legacy stage details', () => {
    const result = response();
    result.plan.countries = ['中国'];
    result.plan.regions = ['泉州'];
    result.plan.dimensions?.push('泉州');
    result.stages = [{
      key: 'plan',
      label: '语义解析',
      status: 'completed',
      detail: '指标：GDP；实体：中国；维度：行业；时间：2025。',
    }];

    expect(buildSemanticParseSummary(result)).toEqual(expect.objectContaining({
      entities: ['中国', '主要经济体'],
      metrics: ['GDP', '工业机器人密度'],
      dimensions: ['行业', '行业=制造业', '泉州', '2025'],
    }));
  });

  it('still reads dimensions from stage details for historical plans', () => {
    const result = response();
    delete result.plan.dimensions;
    result.stages = [{
      key: 'plan',
      label: '语义解析',
      status: 'completed',
      detail: '指标：GDP；维度：行业；概念：产业升级；时间：2025。',
    }];

    const parsed = researchSearchResponseSchema.parse(result);
    expect(buildSemanticParseSummary(parsed)?.dimensions).toEqual([
      '2025', '行业', '产业升级',
    ]);
  });
});
