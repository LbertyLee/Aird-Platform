import { parseWorldBankGdpEvidence } from './world-bank-gdp-evidence';
import { validateExtractedIndicator, evidenceUnitForValue } from './indicator-extraction-validation';
import { extractNominalGdpFallback } from './gdp-text-fallback';
import { buildResearchQueryPlanLite } from '../../modules/search/research-query-plan';

const nominal = { id: 'gdp', code: 'gdp_current_usd', name: '国内生产总值(现价美元)', unit: '万亿美元', definition: '按现价美元计的国内生产总值' };
const card = 'GDP (current US$)\n\nMost recent value\n\n(2025 trillion)\n\n30.77';
const document = `# United States\n\n${card}\n\n(2025 trillion)\n\nTrend\n\nGDP per capita (current US$)\n89,000`;
const candidate = { indicatorCode: nominal.code, value: 30.77, unit: '万亿美元', period: '2025', entity: '美国', evidence: card };

describe('World Bank multiline GDP evidence', () => {
  it('binds the exact GDP amount, year, scale and document country', () => {
    expect(validateExtractedIndicator(candidate, nominal, document)).toBe(true);
    expect(evidenceUnitForValue(card, 30.77)).toBe('万亿美元');
    expect(extractNominalGdpFallback(document, [nominal])).toEqual([candidate]);
  });

  it.each([
    { value: 30.8 }, { period: '2024' }, { entity: '中国' },
    { unit: '美元' }, { value: 89000 }, { entity: undefined },
  ])('rejects mismatched fields %s', (override) => {
    expect(validateExtractedIndicator({ ...candidate, ...override }, nominal, document)).toBe(false);
  });

  it('does not infer the page country from a query or a multi-country title', () => {
    for (const head of ['', '# Data for China, United States', '# GDP (current US$) - United States']) {
      const text = `${head}\n${card}`;
      expect(validateExtractedIndicator(candidate, nominal, text)).toBe(false);
      expect(extractNominalGdpFallback(text, [nominal], buildResearchQueryPlanLite('美国2025年GDP'))).toEqual([]);
    }
  });

  it('binds each country to its own value on a multi-country line', () => {
    const evidence = card.replace('30.77', 'China 19.5 United States 30.8');
    expect(validateExtractedIndicator({ ...candidate, value: 30.8, evidence }, nominal, evidence)).toBe(true);
    expect(validateExtractedIndicator({ ...candidate, value: 19.5, evidence }, nominal, evidence)).toBe(false);
    expect(extractNominalGdpFallback(evidence, [nominal], buildResearchQueryPlanLite('美国近5年GDP'))).toEqual([
      expect.objectContaining({ entity: '美国', value: 30.8, period: '2025' }),
    ]);
  });

  it.each(['GDP, PPP (current international $)', 'GDP per capita (current US$)', 'GDP growth (annual %)'])('excludes a different metric: %s', (metric) => {
    const evidence = card.replace('GDP (current US$)', metric);
    expect(parseWorldBankGdpEvidence(`# United States\n${evidence}`)).toEqual([]);
    expect(validateExtractedIndicator({ ...candidate, evidence }, nominal, `# United States\n${evidence}`)).toBe(false);
  });

  it('rejects fabricated quotes and metadata-only pages', () => {
    expect(validateExtractedIndicator(candidate, nominal, '# United States\nGDP (current US$)\n1960 - 2025')).toBe(false);
    expect(extractNominalGdpFallback('GDP (current US$) - United States\n1960 - 2025', [nominal])).toEqual([]);
    expect(extractNominalGdpFallback(document.replace('30.77', '30.77 GDP per capita 89,000'), [nominal])).toEqual([]);
  });

  it('supports a quoted nominal GDP country table and preserves its scale', () => {
    const evidence = 'GDP (current US$) - Ecuador, United States\n\nCountry Most Recent Year Most Recent Value (Millions)\n\nEcuador 2025 130,320.56\n\nUnited States 2025 30,769,700.00';
    expect(validateExtractedIndicator({ ...candidate, value: 30769700, unit: '百万美元', evidence }, nominal, evidence)).toBe(true);
    expect(validateExtractedIndicator({ ...candidate, value: 130320.56, unit: '百万美元', evidence }, nominal, evidence)).toBe(false);
  });
});
