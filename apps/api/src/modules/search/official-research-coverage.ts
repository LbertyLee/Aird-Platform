import type {
  ResearchFilters,
  ResearchQueryPlan as OfficialPlan,
} from '@agent/contracts';
import {
  countryCode,
  countryChineseName,
  countryEnglishName,
  inferQueryCountries,
} from '../../common/utils/query-countries';
import {
  WorldBankDataService,
  type OfficialStructuredDataset,
  type WorldBankQueryCriteria,
} from '../../research/world-bank-data.service';
import type { ExaResult } from '../../research/research.types';
import type {
  ResearchEvaluation,
  ResearchSourcePlan,
} from '../semantic/semantic.types';
import type { ResearchQueryPlan } from './research-query-plan';

/** Numeric coverage is established by official rows, never by page titles or model confidence. */
export class OfficialResearchCoverage {
  private readonly request: OfficialPlan;
  private readonly criteria: WorldBankQueryCriteria | undefined;
  private readonly rows = new Map<string, Record<string, unknown>>();
  private readonly datasets: OfficialStructuredDataset[] = [];
  private readonly completeScope: boolean;

  constructor(
    private readonly worldBank: WorldBankDataService,
    private readonly query: string,
    filters: ResearchFilters,
    plan: ResearchQueryPlan,
    allowed: boolean,
  ) {
    this.request = {
      countries: [
        ...new Set([
          ...filters.countries,
          ...inferQueryCountries(query),
          ...plan.entities.filter((entity) => countryCode(entity)),
        ]),
      ],
      regions: plan.regions ?? [],
      entities: [],
      indicators: plan.metrics.length ? plan.metrics : [query],
      timeRanges: plan.periods,
      sources: ['World Bank'],
      intent: 'lookup',
      confidence: 1,
      explanation: '优先查询世界银行官方结构化数据',
    };
    this.criteria = allowed
      ? worldBank.getCriteria(this.request, query)
      : undefined;
    this.completeScope =
      plan.periods.length > 0 &&
      !/预测|未来|原因|政策|影响|解释|定义|什么是|forecast|projection|\bwhy\b|policy|impact|definition/i.test(
        query,
      ) &&
      [...filters.countries, ...plan.entities].every((entity) =>
        Boolean(countryCode(entity)),
      ) &&
      this.request.indicators
        .flatMap((indicator) =>
          indicator.split(/和|以及|及|与|、|[,，;；&]|\band\b/i),
        )
        .filter((indicator) => indicator.trim())
        .every((indicator) =>
          Boolean(
            worldBank.getCriteria(
              { ...this.request, indicators: [indicator] },
              query,
            ),
          ),
        );
  }

  get enabled() {
    return Boolean(this.criteria);
  }

  private key(country: string, year: string, indicator: string) {
    return `${country}/${year}/${indicator}`;
  }

  private missing() {
    if (!this.criteria) return [];
    const gaps: Array<{ country: string; years: string[]; indicator: string }> =
      [];
    for (const country of this.criteria.countries) {
      for (const indicator of this.criteria.indicatorCodes) {
        const years: string[] = [];
        for (
          let year = this.criteria.start;
          year <= this.criteria.end;
          year++
        ) {
          if (
            !this.request.timeRanges.includes(String(year)) &&
            this.request.timeRanges.every((value) => /^\d{4}$/.test(value)) &&
            this.request.timeRanges.length
          )
            continue;
          if (!this.rows.has(this.key(country, String(year), indicator)))
            years.push(String(year));
        }
        if (years.length) gaps.push({ country, years, indicator });
      }
    }
    return gaps;
  }

  async retrieve(): Promise<ExaResult[]> {
    if (!this.criteria) return [];
    const gaps = this.missing();
    if (!gaps.length) return [];
    // Query only countries still missing rows. The API filters years and indicator codes.
    const datasets = await this.worldBank.fetch(
      {
        ...this.request,
        countries: [...new Set(gaps.map((gap) => gap.country))],
        timeRanges: [...new Set(gaps.flatMap((gap) => gap.years))].sort(),
      },
      '',
    );
    const results: ExaResult[] = [];
    for (const dataset of datasets) {
      const rows = dataset.structuredData.filter((row) => {
        if (typeof row.value !== 'number' || !Number.isFinite(row.value))
          return false;
        const gap = gaps.find(
          (item) =>
            item.country === row.countryCode &&
            item.indicator === row.indicatorCode &&
            item.years.includes(String(row.year)),
        );
        if (!gap) return false;
        const key = this.key(gap.country, String(row.year), gap.indicator);
        if (this.rows.has(key)) return false;
        this.rows.set(key, row);
        return true;
      });
      if (!rows.length) continue;
      this.datasets.push({ ...dataset, structuredData: rows });
      results.push({
        title: dataset.title,
        url: dataset.sourceUrl,
        description: `${this.query}\n${dataset.textContent}`,
        extraSnippets: [],
        score: 1,
        officialData: rows.map((row) => ({
          ...row,
          worldBankIndicatorCode: row.indicatorCode,
          indicatorCode: row.catalogIndicatorCode ?? row.indicatorCode,
        })),
      });
    }
    return results;
  }

  evaluate(model: ResearchEvaluation | null): ResearchEvaluation | null {
    if (!this.criteria) return model;
    const missing = this.missing();
    const gaps = missing.map(
      (gap) =>
        `${countryChineseName(gap.country)}（${gap.country}）缺少 ${gap.years.join('、')} 年 ${gap.indicator} 的可核验结构化数值`,
    );
    const evidenceUrls = [
      ...new Set(this.datasets.map((dataset) => dataset.sourceUrl)),
    ];
    if (!missing.length && this.completeScope)
      return {
        sufficient: true,
        reason: '请求国家、年份及指标均有官方结构化观测值',
        gaps: [],
        coveredNeeds: ['全部国家 × 年份 × 指标已覆盖'],
        evidenceUrls,
      };
    if (!gaps.length) return model;
    return {
      sufficient: false,
      reason: '结构化数据覆盖不足，需针对缺失国家和年份继续检索',
      gaps: [...new Set([...gaps, ...(model?.gaps ?? [])])],
      coveredNeeds: [
        `已取得 ${this.rows.size} 条官方观测值`,
        ...(model?.coveredNeeds ?? []),
      ],
      evidenceUrls: [
        ...new Set([...evidenceUrls, ...(model?.evidenceUrls ?? [])]),
      ],
    };
  }

  gapPlan(): ResearchSourcePlan | null {
    const gaps = this.missing();
    if (!gaps.length) return null;
    const grouped = new Map<
      string,
      { countries: string[]; years: string[]; indicator: string }
    >();
    for (const gap of gaps) {
      const key = `${gap.indicator}/${gap.years.join(',')}`;
      const group = grouped.get(key) ?? {
        countries: [],
        years: gap.years,
        indicator: gap.indicator,
      };
      group.countries.push(countryEnglishName(gap.country));
      grouped.set(key, group);
    }
    return {
      status: 'ready',
      intentSummary: '补齐缺失国家、年份和指标的官方数据',
      dataNeeds: gaps.map(
        (gap) =>
          `${countryEnglishName(gap.country)} ${gap.years.join(', ')} ${gap.indicator}`,
      ),
      sources: [...grouped.values()].slice(0, 5).map((gap) => ({
        websiteUrl: 'https://data.worldbank.org',
        query: `${gap.countries.join(' ')} ${gap.indicator} ${gap.years.join(' ')} official data`,
        reason: '仅补充当前证据中缺失的国家和年份',
      })),
      allowDiscovery: false,
    };
  }
}
