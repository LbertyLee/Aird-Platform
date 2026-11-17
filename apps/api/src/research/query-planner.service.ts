import { Injectable } from '@nestjs/common';
import type { ResearchFilters, ResearchQueryPlan } from '@agent/contracts';
import type { ResearchCatalog } from './research-catalog.service';
import { containsSearchTerm } from './research-filtering';
import { inferQueryRegions } from '../common/utils/query-regions';
import { inferQueryCountries } from '../common/utils/query-countries';
import {
  parseRecentYearCount,
  recentCompletedRangeLabel,
} from '../common/utils/recent-years';

@Injectable()
export class QueryPlannerService {
  plan(
    query: string,
    catalog: ResearchCatalog,
    filters: ResearchFilters = emptyFilters(),
  ): ResearchQueryPlan {
    const text = query.toLowerCase();
    const countries = unique([
      ...filters.countries,
      ...inferQueryCountries(query),
      ...this.detectCatalogValues(text, catalog.entries.countries),
    ]);
    const indicators = unique([
      ...filters.indicators,
      ...this.detectCatalogValues(text, catalog.entries.indicators),
    ]);
    const regions = unique([
      ...inferQueryRegions(query),
      ...filters.regions,
      ...this.detectCatalogValues(text, catalog.entries.regions),
    ]);
    const entities = unique([
      ...filters.entities,
      ...this.detectCatalogValues(text, catalog.entries.entities),
    ]);
    const timeRanges = unique([
      ...filters.timeRanges,
      ...this.detectCatalogValues(text, catalog.entries.timeRanges),
      ...this.detectTimeRanges(text),
    ]);
    const sources = unique([
      ...filters.sources,
      ...this.detectCatalogValues(text, catalog.entries.sources),
    ]);
    const intent = this.detectIntent(text);
    const recognizedCount =
      countries.length +
      indicators.length +
      timeRanges.length +
      entities.length;
    const confidence = Math.min(
      0.98,
      0.45 + recognizedCount * 0.1 + (filters.sources.length > 0 ? 0.05 : 0),
    );
    const recognized = [
      countries.length > 0 ? `国家：${countries.join('、')}` : '',
      regions.length > 0 ? `地区：${regions.join('、')}` : '',
      entities.length > 0 ? `主体：${entities.join('、')}` : '',
      indicators.length > 0 ? `指标：${indicators.join('、')}` : '',
      timeRanges.length > 0 ? `时间：${timeRanges.join('、')}` : '',
      sources.length > 0 ? `来源：${sources.join('、')}` : '',
    ].filter(Boolean);

    return {
      countries,
      regions,
      entities,
      indicators,
      timeRanges,
      sources,
      intent,
      confidence,
      explanation:
        recognized.length > 0
          ? `已识别${recognized.join('；')}，检索意图为${intentLabel(intent)}。`
          : '暂未识别出明确筛选项，将按原始问题进行关键词检索。',
    };
  }

  private detectCatalogValues(
    text: string,
    entries: ResearchCatalog['entries'][keyof ResearchCatalog['entries']],
  ): string[] {
    return entries
      .filter((entry) =>
        [entry.value, entry.label, ...entry.aliases].some((candidate) =>
          containsSearchTerm(text, candidate),
        ),
      )
      .map((entry) => entry.value);
  }

  private detectTimeRanges(text: string): string[] {
    const ranges: string[] = [];
    const recentCount = parseRecentYearCount(text);
    if (recentCount) {
      ranges.push(recentCompletedRangeLabel(recentCount));
    }
    const years = text.match(/20\d{2}\s*年?\s*[-—~～至到]\s*20\d{2}\s*年?/g) ?? [];
    ranges.push(
      ...years.map((range) => {
        const pair = range.match(/20\d{2}/g) ?? [];
        return pair.length >= 2 ? `${pair[0]}-${pair[1]}` : range;
      }),
    );
    return unique(ranges);
  }

  private detectIntent(text: string): ResearchQueryPlan['intent'] {
    if (/政策|法规|措施|规划/.test(text)) return 'policy';
    if (/比较|对比|差异|分别/.test(text)) return 'comparison';
    if (/趋势|变化|增长|演变|走势/.test(text)) return 'trend';
    if (/多少|数据|查询|是多少|数值/.test(text)) return 'lookup';
    return 'general';
  }
}

function emptyFilters(): ResearchFilters {
  return {
    countries: [],
    regions: [],
    entities: [],
    indicators: [],
    timeRanges: [],
    sources: [],
  };
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function intentLabel(intent: ResearchQueryPlan['intent']) {
  return {
    comparison: '多对象比较',
    trend: '趋势分析',
    lookup: '数据查询',
    policy: '政策专题',
    general: '综合研究',
  }[intent];
}
