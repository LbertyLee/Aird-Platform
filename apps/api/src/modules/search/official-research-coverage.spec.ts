import { OfficialResearchCoverage } from './official-research-coverage';
import { WorldBankDataService } from '../../research/world-bank-data.service';
import { buildResearchQueryPlanLite } from './research-query-plan';
import { runResearchRetrievalGraph } from './research-retrieval-graph';

const query = '中国 美国，法国，英国 俄罗斯 2021-2025年GDP';
const filters = {
  countries: [],
  regions: [],
  entities: [],
  indicators: [],
  timeRanges: [],
  sources: [],
};
const makeDataset = (
  countries: string[],
  years = [2021, 2022, 2023, 2024, 2025],
) => ({
  title: 'World Bank GDP',
  sourceUrl: `https://api.worldbank.org/v2/country/${countries.join(';')}/indicator/NY.GDP.MKTP.CD`,
  textContent: 'GDP current US$ official observations',
  metadata: {},
  structuredData: countries.flatMap((country) =>
    years.map((year) => ({
      countryCode: country,
      country,
      year,
      value: 100,
      unit: '美元',
      indicatorCode: 'NY.GDP.MKTP.CD',
      catalogIndicatorCode: 'gdp_current_usd',
    })),
  ),
});

function setup(text = query, allowed = true) {
  const bank = new WorldBankDataService();
  const fetch = jest.spyOn(bank, 'fetch').mockResolvedValue([]);
  const plan = buildResearchQueryPlanLite(text);
  plan.metrics = ['GDP'];
  return {
    fetch,
    coverage: new OfficialResearchCoverage(bank, text, filters, plan, allowed),
  };
}

describe('official numeric coverage in the retrieval loop', () => {
  it('retains all five requested countries and closes the loop after missing countries are retrieved', async () => {
    const { fetch, coverage } = setup();
    fetch
      .mockResolvedValueOnce([makeDataset(['CHN', 'USA', 'GBR'])])
      .mockResolvedValueOnce([makeDataset(['FRA', 'RUS'])]);
    const initialPlan = coverage.gapPlan()!;
    const result = await runResearchRetrievalGraph({
      initialPlan,
      replan: async () => coverage.gapPlan(),
      retrieve: async () => ({
        results: [
          { sourceId: '', sourceName: '', results: await coverage.retrieve() },
        ],
        attempted: 1,
        succeeded: 1,
        failed: 0,
        skipped: 0,
      }),
      evaluate: async () => coverage.evaluate(null),
    });
    expect(fetch.mock.calls[0][0].countries).toEqual(
      expect.arrayContaining(['CHN', 'USA', 'FRA', 'GBR', 'RUS']),
    );
    expect(fetch.mock.calls[1][0].countries.sort()).toEqual(['FRA', 'RUS']);
    expect(result.round).toBe(2);
    expect(result.stopReason).toBe('sufficient');
    const rows = result.summary.results
      .flatMap((group) => group.results)
      .flatMap((item) => item.officialData ?? []);
    expect(rows).toHaveLength(25);
    expect(rows[0]).toMatchObject({
      indicatorCode: 'gdp_current_usd',
      worldBankIndicatorCode: 'NY.GDP.MKTP.CD',
      unit: '美元',
    });
  });

  it('targets the missing year and overrides a false positive from the model', async () => {
    const { fetch, coverage } = setup('France 2021-2023 GDP');
    fetch.mockResolvedValueOnce([makeDataset(['FRA'], [2021, 2023])]);
    await coverage.retrieve();
    const evaluation = coverage.evaluate({
      sufficient: true,
      reason: '网页主题相关',
      gaps: [],
      coveredNeeds: [],
      evidenceUrls: [],
    });
    expect(evaluation?.sufficient).toBe(false);
    expect(evaluation?.gaps).toEqual([expect.stringContaining('2022')]);
    expect(coverage.gapPlan()?.sources[0].query).toBe(
      'France NY.GDP.MKTP.CD 2022 official data',
    );
    await coverage.retrieve();
    expect(fetch.mock.calls[1][0].timeRanges).toEqual(['2022']);
  });

  it('does not invent unpublished values or loop indefinitely when a year stays unavailable', async () => {
    const { fetch, coverage } = setup('俄罗斯2025年GDP');
    const result = await runResearchRetrievalGraph({
      initialPlan: coverage.gapPlan()!,
      maxRounds: 3,
      replan: async () => coverage.gapPlan(),
      retrieve: async () => {
        await coverage.retrieve();
        return {
          results: [],
          attempted: 1,
          succeeded: 1,
          failed: 0,
          skipped: 0,
        };
      },
      evaluate: async () => coverage.evaluate(null),
    });
    expect(result.evaluation.sufficient).toBe(false);
    expect(result.round).toBeLessThanOrEqual(3);
    expect(result.stopReason).toBe('no_new_queries');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('honors source restrictions and does not use national GDP for a city query', async () => {
    const restricted = setup(query, false);
    await restricted.coverage.retrieve();
    expect(restricted.fetch).not.toHaveBeenCalled();
    expect(restricted.coverage.evaluate(null)).toBeNull();
    const city = setup('中国泉州2024年GDP');
    await city.coverage.retrieve();
    expect(city.fetch).not.toHaveBeenCalled();
  });

  it('does not declare a mixed supported/unsupported metric request fully covered', async () => {
    const bank = new WorldBankDataService();
    jest.spyOn(bank, 'fetch').mockResolvedValue([makeDataset(['FRA'], [2024])]);
    const plan = buildResearchQueryPlanLite('法国2024年GDP和机器人密度');
    plan.metrics = ['GDP和机器人密度'];
    const coverage = new OfficialResearchCoverage(
      bank,
      plan.originalQuery,
      filters,
      plan,
      true,
    );
    await coverage.retrieve();
    expect(coverage.evaluate(null)).toBeNull();
  });

  it('requires model assessment of explanation and forecast needs even when historical numbers are complete', async () => {
    const { fetch, coverage } = setup('法国2024年GDP及未来预测');
    fetch.mockResolvedValue([makeDataset(['FRA'], [2024])]);
    await coverage.retrieve();
    expect(coverage.evaluate(null)).toBeNull();
  });
});
