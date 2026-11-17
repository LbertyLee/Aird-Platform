import { gzipSync } from 'node:zlib';
import { WPP_METRICS } from '../../research/population-metrics';
import {
  AnalysisSessionService,
  normalizeDisplayEntity,
} from './analysis-session.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ResearchRepository } from '../../research/research.repository';
import type { KnowledgeAccessScopeService } from '../knowledge/knowledge-access-scope.service';
import type { DeepSeekChatService } from '../../infrastructure/ai/deepseek-chat.service';
import type { AnalysisPresentation } from '@agent/contracts';
import { recentCompletedCalendarYears } from '../../common/utils/recent-years';
import { WorldBankDataService } from '../../research/world-bank-data.service';
import type { SourceEntity } from '../../research/research.types';
import ExcelJS from 'exceljs';
import { StructuredDataStore } from '../../research/structured-data-store';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('analysis visualization persistence', () => {
  const findFirst = jest.fn();
  const updateMany = jest.fn();
  const service = new AnalysisSessionService(
    { analysisSession: { findFirst, updateMany } } as unknown as PrismaService,
    {} as ResearchRepository,
    {} as KnowledgeAccessScopeService,
    {} as DeepSeekChatService,
    {
      ensureFullText: async (sources: unknown) => sources,
    } as unknown as import('../../research/exa-content-hydration.service').ExaContentHydrationService,
    new WorldBankDataService(),
  );
  const stored = {
    id: 'session',
    createdAt: new Date('2026-09-01'),
    resultJson: {
      runId: 'run',
      query: 'GDP',
      status: 'ready',
      selectedSourceIds: ['source'],
      preferredIndicatorIds: [],
      sources: [{ id: 'source', title: 'World Bank' }],
      availableIndicators: [],
      rows: [],
      summary: [],
      warnings: [],
      observations: [
        {
          sourceId: 'source',
          source: 'World Bank',
          indicatorId: 'gdp',
          indicatorName: 'GDP',
          unit: '%',
          entity: '中国',
          period: '2025',
          value: 5,
        },
      ],
    },
  };
  const config: AnalysisPresentation = {
    datasetId: '["gdp","%"]',
    entities: ['中国'],
    startPeriod: '2025',
    endPeriod: '2025',
    currentPeriod: '2025',
    view: 'map',
    reportViews: ['map', 'table'],
  };
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('enforces ownership on read and write and persists run association, report and configuration', async () => {
    findFirst.mockResolvedValue(stored);
    updateMany.mockResolvedValue({ count: 1 });
    const result = await service.savePresentation(
      'user-a',
      'session',
      config,
      true,
    );
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'session', userId: 'user-a' } }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session', userId: 'user-a' },
        data: {
          resultJson: expect.objectContaining({
            runId: 'run',
            presentation: config,
            visualReport: expect.objectContaining({ presentation: config }),
          }),
        },
      }),
    );
    expect(result.visualDatasets[0].points[0].value).toBe(5);
    findFirst.mockResolvedValue(null);
    await expect(
      service.savePresentation('user-b', 'session', config),
    ).rejects.toThrow('无权访问');
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('exports only the selected matrix scope and rejects sources outside the session', async () => {
    findFirst.mockResolvedValue({
      ...stored,
      resultJson: {
        ...stored.resultJson,
        selectedSourceIds: ['source', 'other'],
        sources: [
          ...stored.resultJson.sources,
          { id: 'other', title: '另一来源' },
        ],
        observations: [
          ...stored.resultJson.observations,
          {
            ...stored.resultJson.observations[0],
            sourceId: 'other',
            source: '另一来源',
            value: 50,
          },
        ],
      },
    });
    const scoped = { ...config, sourceIds: ['source'], periods: ['2025'] };
    updateMany.mockResolvedValue({ count: 1 });
    const saved = await service.savePresentation(
      'user-a',
      'session',
      scoped,
      true,
    );
    expect(
      saved.visualReport?.metrics.find((metric) => metric.label === '样本均值')
        ?.value,
    ).toContain('5');
    const file = await service.exportXlsx(
      'user-a',
      'session',
      undefined,
      scoped,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer as never);
    expect(workbook.worksheets[0].getRow(1).values).toEqual([
      undefined,
      '数据源',
      'entity',
      '2025',
    ]);
    expect(workbook.worksheets[0].getRow(2).values).toEqual([
      undefined,
      'World Bank',
      '中国',
      5,
    ]);
    await expect(
      service.savePresentation(
        'user-a',
        'session',
        { ...scoped, sourceIds: ['foreign'] },
        true,
      ),
    ).rejects.toThrow('筛选来源不属于');
    await expect(
      service.exportXlsx('user-a', 'session', undefined, {
        ...scoped,
        sourceIds: ['foreign'],
      }),
    ).rejects.toThrow('筛选来源不属于');
  });

  it('finds the latest session per exact run id within the requesting user', async () => {
    findFirst
      .mockResolvedValueOnce({ id: 'session' })
      .mockResolvedValueOnce(stored);
    const result = await service.recent('user-a', ['run']);
    expect(findFirst).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          userId: 'user-a',
          resultJson: { path: ['runId'], equals: 'run' },
        },
      }),
    );
    expect(result[0].runId).toBe('run');
    await expect(
      service.recent('user-a', ['1', '2', '3', '4', '5']),
    ).rejects.toThrow();
  });

  it('preserves an existing final report when saving chart configuration', async () => {
    findFirst.mockResolvedValue(stored);
    updateMany.mockResolvedValue({ count: 1 });
    const generated = await service.savePresentation(
      'user-a',
      'session',
      config,
      true,
    );
    findFirst.mockResolvedValue({
      ...stored,
      resultJson: {
        ...stored.resultJson,
        visualReport: generated.visualReport,
      },
    });
    const changed = {
      ...config,
      view: 'line' as const,
      reportViews: ['line' as const],
    };
    const updated = await service.savePresentation(
      'user-a',
      'session',
      changed,
    );
    expect(updated.visualReport?.presentation).toEqual(config);
    const cleared = await service.savePresentation('user-a', 'session', {
      ...changed,
      entities: [],
    });
    expect(cleared.visualReport).toEqual(generated.visualReport);
    expect(
      updateMany.mock.calls.at(-1)?.[0].data.resultJson.visualReport,
    ).toEqual(generated.visualReport);
  });
});

describe('analysis display localization', () => {
  it('normalizes common English external-source entities to Chinese', () => {
    expect(normalizeDisplayEntity('China')).toBe('中国');
    expect(normalizeDisplayEntity('United States of America')).toBe('美国');
    expect(normalizeDisplayEntity('South Korea')).toBe('韩国');
    expect(normalizeDisplayEntity('Russian Federation')).toBe('俄罗斯');
  });
});

describe('search evidence to analysis', () => {
  const catalog = [
    {
      id: 'gdp',
      code: 'gdp_current_usd',
      name: '国内生产总值',
      unit: '万亿美元',
      definition: '名义GDP',
      aliases: [{ alias: 'GDP' }],
    },
    {
      id: 'cpi',
      code: 'cpi',
      name: '居民消费价格指数',
      unit: '%',
      definition: 'CPI',
      aliases: [{ alias: 'CPI' }],
    },
  ];
  const source = (rows?: unknown[]) => ({
    id: 'source',
    title: '统计公报',
    origin: 'local' as const,
    storageType: 'structured' as const,
    sourceUrl: null,
    mimeType: 'application/json',
    textContent: '2024年中国GDP为100亿元。',
    excerpt: '',
    recordCount: rows?.length ?? 0,
    createdAt: new Date().toISOString(),
    structuredData: rows,
  });
  function setup(selectedSource: SourceEntity = source()) {
    const prisma = {
      researchRun: {
        findFirst: jest.fn().mockResolvedValue({
          query: '近5年GDP',
          sourceIds: ['source'],
          filters: { countries: ['德国'], timeRanges: ['2022-2026'] },
          resultJson: {
            plan: { countries: ['中国'], timeRanges: ['2021-2025'] },
          },
        }),
      },
      analysisSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'session', createdAt: new Date() }),
      },
      indicatorFieldMapping: { findMany: jest.fn().mockResolvedValue([]) },
      indicator: { findMany: jest.fn().mockResolvedValue(catalog) },
    };
    const chat = {
      isReady: () => true,
      extractIndicators: jest.fn().mockResolvedValue({
        items: [
          {
            indicatorCode: 'gdp_current_usd',
            value: 100,
            unit: '亿元',
            period: '2024',
            entity: '中国',
          },
        ],
      }),
      summarizeAnalysis: jest.fn().mockResolvedValue(null),
      translateDisplayNames: jest.fn().mockResolvedValue({}),
    };
    const service = new AnalysisSessionService(
      prisma as never,
      { getSourcesByIds: async () => [selectedSource] } as never,
      { resolveAccessibleKnowledgeIds: async () => new Set() } as never,
      chat as never,
      { ensureFullText: async (sources: unknown) => sources } as never,
      new WorldBankDataService(),
    );
    return { service, prisma, chat };
  }

  it.each([false, true])(
    'loads all 1208 WPP observations without LLM guessing or truncation (missing country=%s)',
    async (missing) => {
      const rows = [
        'ISO3_code,Location,Time,Variant,VarID,TPopulation1July,TFR,Births,NetMigrations',
      ];
      for (const country of ['CHN', 'USA'])
        for (let year = 1950; year <= 2100; year++) {
          if (missing && country === 'USA' && year === 2100) continue;
          rows.push(
            `${country},${country},${year},Medium,2,544044.358,5.813,22293.375,-20.646`,
          );
        }
      const fetch = jest
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () => new Response(gzipSync(rows.join('\n'))),
        );
      try {
        const official = {
          ...source(),
          origin: 'exa' as const,
          structuredData: undefined,
          sourceUrl:
            'https://population.un.org/wpp/assets/Files/WPP2024_Methodology-Report_Final.pdf',
        };
        const { service, prisma, chat } = setup(official);
        prisma.indicator.findMany.mockResolvedValue(
          WPP_METRICS.map((metric) => ({
            id: metric.code,
            code: metric.code,
            name: metric.name,
            unit: metric.unit,
            definition: metric.name,
            aliases:
              metric.code === 'population_total' ? [{ alias: '人口总量' }] : [],
          })),
        );
        const result = await service['prepare'](
          '联合国《世界人口展望 2024》中国与美国，1950-2100年，每年的人口总量数据、每年的人口总和生育率、每年的新生人口数据、每年的移民人口数据',
          [official, { ...official, id: 'reference' }],
        );
        expect(result.observations).toHaveLength(missing ? 1204 : 1208);
        expect(result.status).toBe(missing ? 'partial' : 'ready');
        expect(result.queryDimensions?.periods).toHaveLength(151);
        expect(new Set(result.observations.map((item) => item.entity))).toEqual(
          new Set(['中国', '美国']),
        );
        expect(
          new Set(result.observations.map((item) => item.indicatorCode)),
        ).toEqual(new Set(WPP_METRICS.map((metric) => metric.code)));
        expect(
          result.observations.find(
            (item) => item.indicatorCode === 'net_migration',
          )?.value,
        ).toBe(-20646);
        expect(result.rows.filter((row) => row.indicatorCode)).toHaveLength(
          missing ? 1204 : 1208,
        );
        expect(chat.extractIndicators).not.toHaveBeenCalled();
        expect(chat.summarizeAnalysis).not.toHaveBeenCalled();
        expect(result.warnings.join(' ')).not.toContain('已截断');
        if (missing) expect(result.warnings.join(' ')).toContain('美国 × 2100');
      } finally {
        fetch.mockRestore();
      }
    },
  );

  it('reuses extracted rows across service recreation and invalidates on changed evidence', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'analysis-extraction-'));
    try {
      const first = setup();
      Object.assign(first.service, {
        structuredStore: new StructuredDataStore(directory, true),
      });
      await first.service['prepare']('GDP', [source()]);
      expect(first.chat.extractIndicators).toHaveBeenCalledTimes(1);
      const second = setup();
      Object.assign(second.service, {
        structuredStore: new StructuredDataStore(directory, true),
      });
      const cached = await second.service['prepare']('GDP', [source()]);
      expect(cached.observations.length).toBeGreaterThan(0);
      expect(second.chat.extractIndicators).not.toHaveBeenCalled();
      await second.service['prepare']('GDP', [
        { ...source(), textContent: source().textContent + '新增修订数据' },
      ]);
      expect(second.chat.extractIndicators).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('loads canonical SQL rows into observations and keeps detail/export values consistent with charts', async () => {
    const { service, chat } = setup();
    const result = await service['prepare']('2024中国GDP', [
      source([
        {
          indicatorCode: 'gdp_current_usd',
          value: 100,
          metric_value: 100,
          unit: '亿元',
          year: '2024',
          entity: '中国',
        },
      ]),
    ]);
    expect(result.status).toBe('ready');
    expect(result.observations).toHaveLength(1);
    expect(result.observations[0].value).toBeCloseTo(
      (100 * 1e8) / 7.1957 / 1e12,
      12,
    );
    expect(result.rows[0]).toMatchObject({
      value: result.observations[0].value,
      metric_value: result.observations[0].value,
      unit: '万亿美元',
      originalValue: 100,
      originalUnit: '亿元',
    });
    expect(chat.extractIndicators).not.toHaveBeenCalled();
  });

  it('localizes analysis labels consistently and preserves canonical identifiers and numbers', async () => {
    const { service, chat, prisma } = setup();
    chat.translateDisplayNames.mockResolvedValue({
      Bavaria: '巴伐利亚',
      'Industrial robot density': '工业机器人密度',
      'Robotics report': '机器人报告',
    });
    prisma.indicator.findMany.mockResolvedValue([
      { ...catalog[0], name: 'Industrial robot density' },
    ]);
    const input = {
      ...source([
        {
          indicatorCode: 'gdp_current_usd',
          value: 100,
          unit: '万亿美元',
          year: '2024',
          entity: 'Bavaria',
        },
      ]),
      title: 'Robotics report',
    };
    const result = await service['prepare'](
      '2024 Bavaria Industrial robot density',
      [input],
      ['gdp'],
      { entities: ['Bavaria'] },
    );
    expect(result.sources[0].title).toBe('机器人报告');
    expect(result.observations[0]).toMatchObject({
      entity: '巴伐利亚',
      indicatorName: '工业机器人密度',
      indicatorCode: 'gdp_current_usd',
      value: 100,
    });
    expect(result.rows[0]).toMatchObject({ entity: '巴伐利亚', value: 100 });
    expect(result.queryDimensions.entities).toContain('巴伐利亚');
    expect(result.displayTranslations).toMatchObject({ Bavaria: '巴伐利亚' });
    expect(input.structuredData).toEqual(
      expect.arrayContaining([expect.objectContaining({ entity: 'Bavaria' })]),
    );
  });

  it('keeps unknown-unit data inspectable without plotting it as canonical currency', async () => {
    const { service } = setup();
    const result = await service['prepare']('2026中国GDP', [
      source([
        {
          indicatorCode: 'gdp_current_usd',
          value: 100,
          unit: '亿元',
          year: '2026',
          entity: '中国',
        },
      ]),
    ]);
    expect(result.status).toBe('partial');
    expect(result.observations[0]).toMatchObject({
      value: null,
      originalValue: 100,
      originalUnit: '亿元',
      normalizationStatus: 'unknown',
    });
    expect(result.summary[0].value).toBeNull();
    expect(result.rows[0].value).toBeNull();
  });

  it('does not mark unmapped structured rows as usable analysis', async () => {
    const { service } = setup();
    const result = await service['prepare']('GDP', [
      source([{ year: '2024', metric_value: null }]),
    ]);
    expect(result.observations).toEqual([]);
    expect(result.status).toBe('partial');
  });

  it('preserves UI search dimensions and sends explicitly selected indicators to extraction', async () => {
    const { service, chat, prisma } = setup();
    const result = await service.create('user', {
      runId: 'run',
      query: '近5年GDP',
      sourceIds: ['source'],
      indicatorIds: ['cpi'],
    });
    expect(result.queryDimensions).toMatchObject({
      entities: ['德国'],
      periods: recentCompletedCalendarYears(5),
    });
    expect(
      chat.extractIndicators.mock.calls[0][1].map(
        (item: { code: string }) => item.code,
      ),
    ).toContain('cpi');
    expect(result.preferredIndicatorIds).toContain('cpi');
    expect(prisma.researchRun.findFirst.mock.calls[0][0].select).toMatchObject({
      filters: true,
      resultJson: true,
    });
  });

  it('reuses a completed session for the same run and selected sources', async () => {
    const { service, prisma, chat } = setup();
    prisma.analysisSession.findFirst.mockResolvedValue({
      id: 'existing-session',
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      resultJson: {
        runId: 'run',
        query: '近5年GDP',
        pipelineVersion: 9,
        status: 'ready',
        selectedSourceIds: ['source'],
        sources: [],
        availableIndicators: [],
        rows: [],
        observations: [],
        summary: [],
        warnings: [],
      },
    });

    const result = await service.create('user', {
      runId: 'run',
      query: '近5年GDP',
      sourceIds: ['source'],
    });

    expect(result.id).toBe('existing-session');
    expect(prisma.analysisSession.create).not.toHaveBeenCalled();
    expect(chat.extractIndicators).not.toHaveBeenCalled();
  });

  it('reports model format errors as extraction failures', async () => {
    const { service, chat } = setup();
    chat.extractIndicators.mockResolvedValue({
      items: [],
      trace: { error: 'response JSON missing items array' },
    } as never);
    const result = await service['prepare']('CPI', [
      {
        ...source(),
        textContent: '2024年中国居民消费价格指数同比上涨2%。',
      },
    ]);
    expect(result.sources[0].message).toContain('抽取失败');
    expect(result.status).toBe('partial');
  });

  it.each([undefined, 1, 2, 3, 4, 5, 6, 7])(
    'rebuilds old or incomplete cached sessions (version %s)',
    async (pipelineVersion) => {
      const { service, prisma, chat } = setup();
      prisma.analysisSession.findFirst.mockResolvedValue({
        id: 'old-session',
        createdAt: new Date(),
        resultJson: {
          pipelineVersion,
          status: 'ready',
        },
      } as never);
      await service.create('user', {
        runId: 'run',
        query: 'GDP',
        sourceIds: ['source'],
        indicatorIds: ['cpi'],
      });
      expect(chat.extractIndicators).toHaveBeenCalled();
      expect(prisma.analysisSession.create).toHaveBeenCalled();
      expect(
        prisma.analysisSession.findFirst.mock.calls[0][0].where
          .selectedIndicatorIds,
      ).toEqual({ equals: ['cpi'] });
    },
  );

  it('marks incomplete requested year coverage as partial and lists missing years', async () => {
    const { service } = setup();
    const result = await service['prepare']('中国2023和2024年GDP', [source()]);
    expect(result.status).toBe('partial');
    expect(
      result.warnings.some(
        (warning) => warning.includes('2023') && warning.includes('保留为空'),
      ),
    ).toBe(true);
  });

  it('merges official World Bank rows into persisted analysis, charts and exports when pages have no numbers', async () => {
    const api = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify([
          { pages: 1 },
          [
            {
              countryiso3code: 'USA',
              country: { value: 'United States' },
              date: '2024',
              value: 29e12,
              indicator: { id: 'NY.GDP.MKTP.CD', value: 'GDP (current US$)' },
            },
            {
              countryiso3code: 'USA',
              country: { value: 'United States' },
              date: '2025',
              value: null,
              indicator: { id: 'NY.GDP.MKTP.CD', value: 'GDP (current US$)' },
            },
          ],
        ]),
      ),
    );
    try {
      const { service, prisma, chat } = setup({
        ...source(),
        origin: 'exa',
        storageType: 'knowledge',
        sourceUrl:
          'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD?locations=US',
        textContent: 'GDP indicator metadata',
      });
      prisma.researchRun.findFirst.mockResolvedValue({
        query: '美国2024和2025年GDP',
        sourceIds: ['source'],
        filters: {},
        resultJson: {},
      } as never);
      const result = await service.create('user', {
        runId: 'run',
        sourceIds: ['source'],
        query: 'GDP',
      });
      expect(api).toHaveBeenCalledTimes(1);
      expect(String(api.mock.calls[0][0])).toContain('/country/USA/');
      expect(result.observations).toEqual([
        expect.objectContaining({
          sourceId: 'source',
          indicatorCode: 'gdp_current_usd',
          entity: '美国',
          period: '2024',
          value: 29,
          originalValue: 29e12,
          originalUnit: '美元',
          unit: '万亿美元',
        }),
      ]);
      expect(result.visualDatasets[0].points[0].value).toBe(29);
      expect(result.rows[0]).toMatchObject({
        value: 29,
        unit: '万亿美元',
        worldBankIndicatorCode: 'NY.GDP.MKTP.CD',
      });
      expect(result.rows[0].sourceUrl).toContain(
        'https://api.worldbank.org/v2/',
      );
      expect(result.sources[0].message).toContain('官方 API');
      expect(
        result.warnings.some((warning) => warning.includes('人民币金额')),
      ).toBe(false);
      expect(result.status).toBe('partial');
      expect(
        result.warnings.some(
          (warning) => warning.includes('2025') && warning.includes('保留为空'),
        ),
      ).toBe(true);
      expect(
        prisma.analysisSession.create.mock.calls[0][0].data.resultJson,
      ).toMatchObject({
        observations: result.observations,
        rows: result.rows,
        selectedSourceIds: ['source'],
      });
      expect(chat.extractIndicators).not.toHaveBeenCalled();
      prisma.analysisSession.findFirst.mockResolvedValue({
        id: result.id,
        createdAt: new Date(),
        resultJson: result,
      } as never);
      const exported = await service.exportXlsx('user', result.id, [
        'value',
        'unit',
        'sourceUrl',
      ]);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(exported.buffer as never);
      expect(workbook.worksheets[0].getRow(2).getCell(2).value).toBe(29);
      expect(workbook.worksheets[0].getRow(2).getCell(3).value).toBe(
        '万亿美元',
      );
    } finally {
      api.mockRestore();
    }
  });

  it('uses all 25 official country/year rows directly for analysis without page fetching or model extraction', async () => {
    const countries = [
      'China',
      'United States',
      'France',
      'United Kingdom',
      'Russian Federation',
    ];
    const rows = countries.flatMap((country) =>
      [2021, 2022, 2023, 2024, 2025].map((year) => ({
        country,
        year,
        value: 1e12,
        unit: '美元',
        indicatorCode: 'gdp_current_usd',
        worldBankIndicatorCode: 'NY.GDP.MKTP.CD',
      })),
    );
    const { service, chat } = setup();
    const fetch = jest.spyOn(WorldBankDataService.prototype, 'fetch');
    try {
      const result = await service['prepare'](
        '中国 美国，法国，英国 俄罗斯 2021-2025年GDP',
        [
          {
            ...source(rows),
            sourceUrl: 'https://api.worldbank.org/v2/',
            metadata: { analysisProvider: 'world-bank-api' },
          },
        ],
        ['gdp'],
      );
      expect(result.observations).toHaveLength(25);
      expect(new Set(result.observations.map((row) => row.entity))).toEqual(
        new Set(['中国', '美国', '法国', '英国', '俄罗斯']),
      );
      expect(
        result.observations.every(
          (row) => row.value === 1 && row.unit === '万亿美元',
        ),
      ).toBe(true);
      expect(result.status).toBe('ready');
      expect(fetch).not.toHaveBeenCalled();
      expect(chat.extractIndicators).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });

  it('keeps text extraction for other requested indicators when only part of the official API succeeds', async () => {
    const official = jest
      .spyOn(WorldBankDataService.prototype, 'fetch')
      .mockResolvedValue([
        {
          title: 'World Bank GDP',
          sourceUrl: 'https://api.worldbank.org/v2/',
          textContent: '',
          structuredData: [
            {
              country: 'United States',
              countryCode: 'USA',
              year: 2024,
              indicatorCode: 'NY.GDP.MKTP.CD',
              catalogIndicatorCode: 'gdp_current_usd',
              unit: '美元',
              value: 29e12,
            },
          ],
          metadata: { indicatorCode: 'NY.GDP.MKTP.CD' },
        },
      ]);
    try {
      const { service, chat } = setup();
      chat.extractIndicators.mockResolvedValue({
        items: [
          {
            indicatorCode: 'cpi',
            value: 2,
            unit: '%',
            period: '2024',
            entity: '美国',
          },
        ],
      } as never);
      const result = await service['prepare'](
        '美国2024年GDP和CPI',
        [
          {
            ...source(),
            sourceUrl: 'https://data.worldbank.org/indicator/NY.GDP.MKTP.CD',
            textContent: '2024年美国居民消费价格指数同比上涨2%。'.repeat(12),
          },
        ],
        ['gdp', 'cpi'],
      );
      expect(result.observations.map((item) => item.indicatorCode)).toEqual([
        'gdp_current_usd',
        'cpi',
      ]);
      expect(result.sources).toHaveLength(1);
      expect(result.sources[0].observationCount).toBe(2);
      expect(
        chat.extractIndicators.mock.calls[0][1].map(
          (item: { code: string }) => item.code,
        ),
      ).toEqual(['cpi']);
    } finally {
      official.mockRestore();
    }
  });

  it('retries a failed model extraction once', async () => {
    const { service, chat } = setup();
    chat.extractIndicators
      .mockResolvedValueOnce({
        items: null,
        trace: { error: 'timeout', itemCount: 0 },
      } as never)
      .mockResolvedValueOnce({
        items: [
          {
            indicatorCode: 'gdp_current_usd',
            value: 100,
            unit: '亿元',
            period: '2024',
            entity: '中国',
          },
        ],
        trace: { itemCount: 1 },
      } as never);
    const result = await service['prepare']('GDP', [source()]);
    expect(chat.extractIndicators).toHaveBeenCalledTimes(2);
    expect(result.observations).toHaveLength(1);
    expect(result.status).toBe('ready');
  });

  it('does not send prefixed title-only content to the model', async () => {
    const { service, chat } = setup();
    const result = await service['prepare']('GDP', [
      {
        ...source(),
        origin: 'exa',
        title: '国家统计局：什么是现价和不变价 - 国家统计局',
        textContent: '什么是现价和不变价 - 国家统计局',
      },
    ]);
    expect(chat.extractIndicators).not.toHaveBeenCalled();
    expect(result.sources[0].message).toContain('仅有标题');
  });
});
