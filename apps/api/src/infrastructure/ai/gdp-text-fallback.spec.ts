import { extractNominalGdpFallback } from './gdp-text-fallback';
import type { IndicatorCatalogForExtraction } from './deepseek-chat.service';
import { buildResearchQueryPlanLite } from '../../modules/search/research-query-plan';

const nominal: IndicatorCatalogForExtraction = {
  id: 'gdp',
  code: 'gdp_current_usd',
  name: '国内生产总值(现价美元)',
  unit: '万亿美元',
  definition: '按现价美元计的国内生产总值',
  aliases: ['GDP', '国内生产总值'],
};

describe('nominal GDP text fallback', () => {
  it('extracts local GDP amounts without a verb while excluding growth and forecast targets', () => {
    const document =
      '2018年全市地区生产总值9019亿元。\n2024年泉州地区生产总值增长6.5%。\n预计2025年地区生产总值达1.5万亿元。';
    expect(
      extractNominalGdpFallback(
        document,
        [nominal],
        buildResearchQueryPlanLite('泉州近10年经济报告'),
      ),
    ).toEqual([
      expect.objectContaining({
        value: 9019,
        unit: '亿元',
        period: '2018',
        entity: '泉州',
      }),
    ]);
  });

  it('extracts explicit current-price GDP and rejects real-price amounts and growth', () => {
    const document = [
      '现价又称当时价格。比如2022年我国国内生产总值（GDP）为1204724亿元，是以2022年价格进行核算；2021年GDP为1149237亿元。',
      '按照2020年价格计算，2021年和2022年的GDP分别为1099198亿元和1131632亿元，由此可知2022年GDP比2021年实际增长3.0％。',
    ].join('\n');

    expect(extractNominalGdpFallback(document, [nominal])).toEqual([
      expect.objectContaining({
        indicatorCode: 'gdp_current_usd',
        value: 1204724,
        unit: '亿元',
        period: '2022',
        entity: '中国',
      }),
      expect.objectContaining({
        indicatorCode: 'gdp_current_usd',
        value: 1149237,
        unit: '亿元',
        period: '2021',
        entity: '中国',
      }),
    ]);
  });

  it('does not turn forecasts or per-capita values into observed GDP totals', () => {
    const document = [
      '预计2027年中国GDP为1500000亿元。',
      '2022年我国人均GDP为85698元。',
    ].join('\n');
    expect(extractNominalGdpFallback(document, [nominal])).toEqual([]);
  });
});
