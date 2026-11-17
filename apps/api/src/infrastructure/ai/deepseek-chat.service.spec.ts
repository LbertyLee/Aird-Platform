import { ConfigService } from '@nestjs/config';
import {
  DeepSeekChatService,
  type ExtractedIndicatorValue,
} from './deepseek-chat.service';
import { extractionPassages } from './extraction-excerpt';
import { buildResearchQueryPlanLite } from '../../modules/search/research-query-plan';

const indicator = {
  id: 'gdp',
  code: 'gdp_current_usd',
  name: '国内生产总值',
  unit: '亿元',
  definition: '名义GDP',
  aliases: ['GDP'],
};
const source = (content: string) => ({
  title: '统计公报',
  origin: 'local',
  content,
});
const item = (year: string, value: number): ExtractedIndicatorValue => ({
  indicatorCode: indicator.code,
  period: year,
  entity: '中国',
  unit: '亿元',
  value,
  evidence: `${year}年中国GDP为${value}亿元。`,
});

function setup(config: Record<string, unknown> = {}) {
  const usageMeter = { record: jest.fn() };
  const service = new DeepSeekChatService(
    new ConfigService({
      OPENAI_BASE_URL: 'https://example.com/v1',
      OPENAI_MODEL: 'test',
      ...config,
    }),
    usageMeter as never,
    { current: (fallback: string) => fallback } as never,
  );
  const create = jest.fn();
  Object.defineProperty(service, 'client', {
    value: { chat: { completions: { create } } },
  });
  const respond = (items: ExtractedIndicatorValue[]) => ({
    choices: [{ message: { content: JSON.stringify({ items }) } }],
  });
  return { service, create, respond, usageMeter };
}

describe('complex reasoning model routing', () => {
  it('routes evidence evaluation, answers and analysis to Max while preserving the regular model', async () => {
    const { service, create, usageMeter } = setup();
    create.mockResolvedValue({
      choices: [{ message: { content: '{"sufficient":false,"gaps":["缺少数据"]}' } }],
      usage: { prompt_tokens: 12, completion_tokens: 8 },
    });
    await service.evaluateResearchEvidence('GDP对比', ['GDP'], []);
    await service.answerFromEvidence('GDP对比', ['证据'], 'fallback');
    await service.summarizeAnalysis('GDP对比', [{
      source: '官方来源', indicatorCode: 'gdp', indicatorName: 'GDP', value: 1, unit: '亿元',
    }]);
    expect(create.mock.calls.slice(0, 3).map(([request]) => request.model))
      .toEqual(['qwen3.8-max', 'qwen3.8-max', 'qwen3.8-max']);
    expect(usageMeter.record.mock.calls.map(([record]) => record.model))
      .toEqual(['qwen3.8-max', 'qwen3.8-max', 'qwen3.8-max']);
    await service.optimizeResearchQuery('GDP', {
      countries: [], regions: [], entities: [], indicators: [], timeRanges: [], sources: [],
    });
    expect(create.mock.calls[3][0].model).toBe('test');
    expect(usageMeter.record.mock.calls[3][0].model).toBe('test');
  });

  it('uses the configured reasoning model and preserves provider-reported billing identity', async () => {
    const { service, create, usageMeter } = setup({ OPENAI_REASONING_MODEL: ' custom-max ' });
    create.mockResolvedValue({
      model: 'custom-max-snapshot',
      choices: [{ message: { content: '研究结论' } }],
      usage: { prompt_tokens: 12, completion_tokens: 8 },
    });
    expect(await service.answerFromEvidence('问题', ['证据'], 'fallback')).toBe('研究结论');
    expect(create.mock.calls[0][0].model).toBe('custom-max');
    expect(usageMeter.record.mock.calls[0][0].model).toBe('custom-max-snapshot');
  });

  it('keeps existing fallback behavior when Max is unavailable', async () => {
    const { service, create } = setup();
    create.mockRejectedValue(new Error('model unavailable'));
    expect(await service.evaluateResearchEvidence('问题', [], [])).toBeNull();
    expect(await service.answerFromEvidence('问题', ['证据'], '已有证据')).toBe('已有证据');
    expect(await service.summarizeAnalysis('问题', [{
      source: '来源', indicatorCode: 'gdp', indicatorName: 'GDP', value: 1, unit: '亿元',
    }])).toBeNull();
  });
});

describe('research intent and bilingual source planning', () => {
  it('translates general names, validates returned keys and years, and reuses cached translations', async () => {
    const { service, create } = setup();
    create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ translations: [
      { original: 'Industrial robot density', zh: '工业机器人密度' },
      { original: 'Bavaria', zh: '巴伐利亚' },
      { original: 'Report 2024', zh: '2025年报告' },
      { original: 'unrequested', zh: '不相关名称' },
    ] }) } }] });
    const result = await service.translateDisplayNames(['Industrial robot density', 'Bavaria', 'Report 2024', 'Industrial robot density']);
    expect({ ...result }).toEqual({ 'Industrial robot density': '工业机器人密度', Bavaria: '巴伐利亚' });
    expect(create.mock.calls[0][1]).toEqual({ timeout: 8000, maxRetries: 0 });
    expect({ ...await service.translateDisplayNames(['Bavaria']) }).toEqual({ Bavaria: '巴伐利亚' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('returns no translations on provider failure so original labels remain usable', async () => {
    const { service, create } = setup();
    create.mockRejectedValue(new Error('timeout'));
    expect({ ...await service.translateDisplayNames(['Industrial robot density']) }).toEqual({});
  });

  it('includes catalog items beyond the former first-80 limit and keeps uncatalogued needs separate', async () => {
    const { service, create } = setup();
    create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      metricCodes: ['metric_99'], intent: 'metric_query', time: { type: 'UNKNOWN' },
      discovery: { metrics: ['工业机器人密度', 123, null], entities: [], dataNeeds: ['每万名工人的机器人数量'], websites: ['ifr.org'] },
    }) } }] });
    const result = await service.parseSemanticQuery('工业机器人密度', {
      metrics: Array.from({ length: 100 }, (_, index) => ({ code: `metric_${index}`, name: `指标${index}` })),
      entities: [], concepts: [], dimensions: [], sources: [{ name: '世界银行', websiteUrl: 'https://worldbank.org' }],
    });
    expect(create.mock.calls[0][0].messages[1].content).toContain('metric_99');
    expect(create.mock.calls[0][0].messages[1].content).toContain('worldbank.org');
    expect(result?.discovery?.metrics).toEqual(['工业机器人密度']);
  });

  it('requests Chinese explanations, English foreign-site queries and equivalent bilingual terms', async () => {
    const { service, create } = setup();
    create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({
      intentSummary: '查询机器人密度', dataNeeds: ['机器人密度'],
      sources: [{ websiteUrl: 'https://ifr.org', query: 'Indonesia industrial robot density 2024', reason: '国际机器人统计来源' }],
      allowDiscovery: true, translations: [{ zh: '工业机器人密度', en: 'industrial robot density' }, null],
      discoveryQueries: { zh: '印度尼西亚机器人密度2024', en: 'Indonesia robot density 2024' },
    }) } }] });
    const plan = await service.planResearchSources('印度尼西亚机器人密度2024', {
      metrics: [], entities: [], concepts: [], dimensions: [], time: { type: 'UNKNOWN' }, intent: 'metric_query', confidence: 0.9,
    }, [], ['用户指定来源']);
    expect(plan?.allowDiscovery).toBe(false);
    expect(plan?.sources[0].query).toBe('Indonesia industrial robot density 2024');
    expect(plan?.translations).toEqual([{ zh: '工业机器人密度', en: 'industrial robot density' }]);
    const prompt = create.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toContain('国外英文网站使用英文query');
    expect(prompt).toContain('必须用简体中文');
    expect(prompt).toContain('币种、单位及指标口径');
  });
});

describe('extraction workflow', () => {
  it('restores local historical growth with HTML spacing and excludes the next-year target', async () => {
    const { service, create, respond } = setup();
    const growth = {
      id: 'growth',
      code: 'gdp_real_growth',
      name: 'GDP实际增速',
      unit: '%',
      definition: '不变价GDP同比增速',
    };
    const actual = {
      indicatorCode: growth.code,
      value: 6.5,
      unit: '%',
      period: '2024',
      entity: '泉州',
      evidence: '——地区生产总值增长 6. 5%；',
    };
    const target = {
      ...actual,
      value: 5.5,
      period: '2025',
      evidence: '建议2025年全市地区生产总值增长预期目标为5.5%左右。',
    };
    create.mockResolvedValue(respond([actual, target]));
    const result = await service.extractIndicators(
      source(
        `2024年泉州市经济运行情况\n${actual.evidence}\n${target.evidence}`,
      ),
      [growth],
      {
        plan: buildResearchQueryPlanLite(
          '泉州近10年来经济报告以及未来10年预测',
        ),
      },
    );
    expect(result.items).toEqual([actual]);
    expect(result.trace.rejectedItemCount).toBe(1);
  });

  it('does not retry years absent from the source', async () => {
    const { service, create, respond } = setup();
    create.mockResolvedValue(respond([item('2023', 100)]));
    const result = await service.extractIndicators(
      source('2023年中国GDP为100亿元。'),
      [indicator],
      { plan: buildResearchQueryPlanLite('中国2023和2024年GDP') },
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(1);
  });

  it('lets the model identify an indicator when the backend catalog is empty', async () => {
    const { service, create, respond } = setup();
    const dynamic = {
      indicatorCode: 'industrial_robot_density',
      indicatorName: '工业机器人密度',
      value: 135,
      unit: '台/万人',
      period: '2024',
      entity: '中国',
      evidence: '2024年中国工业机器人密度为135台/万人。',
    };
    create.mockResolvedValue(respond([dynamic]));
    const result = await service.extractIndicators(
      source(dynamic.evidence),
      [],
      { query: '中国2024年工业机器人密度' },
    );
    expect(result.items).toEqual([dynamic]);
    expect(create.mock.calls[0][0].messages[0].content).toContain(
      '后台没有可用的指标目录',
    );
  });

  it('retries a partially extracted passage with explicit missing years and preserves earlier items', async () => {
    const { service, create, respond } = setup();
    create
      .mockResolvedValueOnce(respond([item('2023', 100)]))
      .mockResolvedValueOnce(respond([item('2024', 200)]));
    const result = await service.extractIndicators(
      source('2023年中国GDP为100亿元。\n2024年中国GDP为200亿元。'),
      [indicator],
      { plan: buildResearchQueryPlanLite('中国2023和2024年GDP') },
    );
    expect(result.items?.map((item) => item.period)).toEqual(['2023', '2024']);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].messages[1].content).toContain(
      'gdp_current_usd × 2024',
    );
    expect(result.trace.passes).toHaveLength(2);
  });

  it('covers the entire document and retries only the failing chunk', async () => {
    const { service, create, respond } = setup();
    const content = '说明'.repeat(18000) + '\n2024年中国GDP为200亿元。';
    create
      .mockImplementation(async (request) =>
        respond(
          request.messages[1].content.includes('2024年中国GDP为200亿元')
            ? [item('2024', 200)]
            : [],
        ),
      )
      .mockRejectedValueOnce(new Error('timeout'));
    const result = await service.extractIndicators(source(content), [
      indicator,
    ]);
    expect(create).toHaveBeenCalledTimes(
      extractionPassages(content).length + 1,
    );
    expect(
      create.mock.calls.some((call) =>
        call[0].messages[1].content.includes('2024年中国GDP为200亿元'),
      ),
    ).toBe(true);
    expect(result.trace.error).toBeUndefined();
    expect(result.trace.passes?.[0].error).toContain('timeout');
  });

  it('keeps successful observations when another chunk permanently fails', async () => {
    const { service, create, respond } = setup();
    const content = '2024年中国GDP为200亿元。\n' + '说明'.repeat(18000);
    create
      .mockResolvedValueOnce(respond([item('2024', 200)]))
      .mockRejectedValue(new Error('timeout'));
    const result = await service.extractIndicators(source(content), [
      indicator,
    ]);
    expect(result.items).toHaveLength(1);
    expect(result.trace.error).toContain('部分正文抽取失败');
  });
});
