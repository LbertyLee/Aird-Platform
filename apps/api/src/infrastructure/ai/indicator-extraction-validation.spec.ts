import {
  enrichExtractedUnitFromEvidence,
  validateExtractedIndicator,
} from './indicator-extraction-validation';
import type { IndicatorCatalogForExtraction } from './deepseek-chat.service';

const nominal: IndicatorCatalogForExtraction = {
  id: '1',
  code: 'gdp_current_usd',
  name: '国内生产总值(现价美元)',
  unit: '万亿美元',
  definition: '按现价美元计的国内生产总值',
};
const growth: IndicatorCatalogForExtraction = {
  id: '2',
  code: 'gdp_real_growth',
  name: 'GDP实际增速',
  unit: '%',
  definition: '不变价GDP同比增速',
};
const perCapita: IndicatorCatalogForExtraction = {
  id: '3',
  code: 'gdp_per_capita',
  name: '人均GDP',
  unit: '美元/人',
  definition: 'GDP除以年中人口',
};

const document = [
  '以国内生产总值为例，其常见数据为现价指标。比如2022年我国国内生产总值（GDP）为1204724亿元，2021年GDP为1149237亿元。',
  '我国采用固定基期方法核算不变价GDP。按照2020年价格计算，2021年和2022年的GDP分别为1099198亿元和1131632亿元，由此可知2022年GDP比2021年实际增长3.0%。',
].join('\n');

describe('indicator extraction validation', () => {
  it('accepts a real report decimal split by inline HTML spacing and preserves its quote', () => {
    const evidence = '——地区生产总值增长 6. 5%；';
    const item = {
      indicatorCode: growth.code,
      value: 6.5,
      unit: '%',
      period: '2024',
      entity: '泉州',
      evidence,
    };
    expect(validateExtractedIndicator(item, growth, evidence)).toBe(true);
    expect(item.evidence).toBe(evidence);
    expect(
      validateExtractedIndicator({ ...item, value: 5 }, growth, evidence),
    ).toBe(false);
    expect(
      validateExtractedIndicator({ ...item, value: 65 }, growth, evidence),
    ).toBe(false);
  });

  it('validates years split by inline HTML and rejects a conflicting year', () => {
    const evidence = '202 4年泉州市地区生产总值增长6.5%。';
    const item = {
      indicatorCode: growth.code,
      value: 6.5,
      unit: '%',
      period: '2024',
      evidence,
    };
    expect(validateExtractedIndicator(item, growth, evidence)).toBe(true);
    expect(
      validateExtractedIndicator({ ...item, period: '2025' }, growth, evidence),
    ).toBe(false);
  });

  it('does not join separate table values or accept per-capita growth as total growth', () => {
    for (const evidence of [
      '年份 GDP增速 CPI同比\n2024 6 5',
      '2024年泉州人均地区生产总值增长6.5%。',
    ]) {
      expect(
        validateExtractedIndicator(
          {
            indicatorCode: growth.code,
            value: 6.5,
            unit: '%',
            period: '2024',
            evidence,
          },
          growth,
          evidence,
        ),
      ).toBe(false);
    }
  });

  it('does not treat a government expected growth target as an actual observation', () => {
    const evidence = '建议2025年全市地区生产总值增长预期目标为5.5%左右。';
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: growth.code,
          value: 5.5,
          unit: '%',
          period: '2025',
          evidence,
        },
        growth,
        evidence,
      ),
    ).toBe(false);
  });

  it('rejects a planning target even when the quote omits the qualifier', () => {
    const evidence = '2025年地区生产总值达1.5万亿元左右';
    const item = {
      indicatorCode: nominal.code,
      value: 1.5,
      unit: '万亿元',
      period: '2025',
      evidence,
    };
    expect(
      validateExtractedIndicator(item, nominal, `争取\n${evidence}。`),
    ).toBe(false);
    expect(
      validateExtractedIndicator(
        item,
        nominal,
        `规划预期目标：\n${evidence}。`,
      ),
    ).toBe(false);
    expect(validateExtractedIndicator(item, nominal, `${evidence}。`)).toBe(
      true,
    );
    const actual = '2024年地区生产总值增长6.5%';
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: growth.code,
          value: 6.5,
          unit: '%',
          period: '2024',
          evidence: actual,
        },
        growth,
        `${actual}；争取2025年增长7%。`,
      ),
    ).toBe(true);
  });

  it('binds a table amount to its own year and indicator column', () => {
    const evidence =
      '单位：亿元\n年份 国内生产总值 财政收入\n2023 100 20\n2024 200 30';
    const item = {
      indicatorCode: nominal.code,
      value: 100,
      unit: '亿元',
      period: '2024',
      evidence,
    };
    expect(validateExtractedIndicator(item, nominal, evidence)).toBe(false);
    expect(
      validateExtractedIndicator({ ...item, value: 200 }, nominal, evidence),
    ).toBe(true);
    expect(
      validateExtractedIndicator({ ...item, value: 30 }, nominal, evidence),
    ).toBe(false);
  });

  it('binds horizontal year columns to the correct table value', () => {
    const evidence = '单位：亿元\n指标 2023 2024\n国内生产总值 100 200';
    const item = {
      indicatorCode: nominal.code,
      value: 100,
      unit: '亿元',
      period: '2024',
      evidence,
    };
    expect(validateExtractedIndicator(item, nominal, evidence)).toBe(false);
    expect(
      validateExtractedIndicator({ ...item, value: 200 }, nominal, evidence),
    ).toBe(true);
  });

  it('keeps repeated table values bound to each occurrence and statistical scope', () => {
    const evidence = '单位：亿元\n年份 财政收入 国内生产总值\n2024 100 100';
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: nominal.code,
          value: 100,
          unit: '亿元',
          period: '2024',
          evidence,
        },
        nominal,
        evidence,
      ),
    ).toBe(true);
    const mixed = '单位：%\n年份 GDP增速 GDP\n2024 5 100';
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: growth.code,
          value: 100,
          unit: '%',
          period: '2024',
          evidence: mixed,
        },
        growth,
        mixed,
      ),
    ).toBe(false);
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: growth.code,
          value: 5,
          unit: '%',
          period: '2024',
          evidence: mixed,
        },
        growth,
        mixed,
      ),
    ).toBe(true);
  });

  it('rejects another metric amount or per-capita amount mapped to total GDP', () => {
    for (const evidence of [
      '2024年中国GDP为200亿元，财政收入为100亿元。',
      '2024年中国人均GDP为100美元。',
    ]) {
      expect(
        validateExtractedIndicator(
          {
            indicatorCode: nominal.code,
            value: 100,
            unit: evidence.includes('美元') ? '美元' : '亿元',
            period: '2024',
            evidence,
          },
          nominal,
          evidence,
        ),
      ).toBe(false);
    }
  });

  it('rejects CPI percentage mapped to GDP growth in a mixed quote', () => {
    const evidence = '2024年中国GDP同比增长5.0%，CPI上涨2.0%。';
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: growth.code,
          value: 2,
          unit: '%',
          period: '2024',
          evidence,
        },
        growth,
        evidence,
      ),
    ).toBe(false);
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: growth.code,
          value: 5,
          unit: '%',
          period: '2024',
          evidence,
        },
        growth,
        evidence,
      ),
    ).toBe(true);
  });
  it('preserves negative signs instead of accepting the positive counterpart', () => {
    const evidence = '2024年中国GDP同比增长-2.5%。';
    expect(
      validateExtractedIndicator(
        { indicatorCode: growth.code, value: -2.5, unit: '%', evidence },
        growth,
        evidence,
      ),
    ).toBe(true);
    expect(
      validateExtractedIndicator(
        { indicatorCode: growth.code, value: 2.5, unit: '%', evidence },
        growth,
        evidence,
      ),
    ).toBe(false);
  });

  it('accepts a table value with the unit in its header and rejects a year as value', () => {
    const evidence = '单位：亿元\n年份 国内生产总值\n2024 100';
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: nominal.code,
          value: 100,
          unit: '亿元',
          period: '2024',
          evidence,
        },
        nominal,
        evidence,
      ),
    ).toBe(true);
    expect(
      validateExtractedIndicator(
        { indicatorCode: nominal.code, value: 2024, unit: '亿元', evidence },
        nominal,
        evidence,
      ),
    ).toBe(false);
  });

  it('rejects contradictory periods and entities in quoted evidence', () => {
    const evidence = '2024年中国GDP为100亿元。';
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: nominal.code,
          value: 100,
          unit: '亿元',
          period: '2025',
          evidence,
        },
        nominal,
        evidence,
      ),
    ).toBe(false);
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: nominal.code,
          value: 100,
          unit: '亿元',
          entity: '美国',
          evidence,
        },
        nominal,
        evidence,
      ),
    ).toBe(false);
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: nominal.code,
          value: 100,
          unit: '亿元',
          entity: '中国',
          evidence,
        },
        nominal,
        evidence,
      ),
    ).toBe(true);
  });
  it('accepts current-price GDP amounts despite currency differences', () => {
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: nominal.code,
          value: 1204724,
          unit: '亿元',
          evidence: '2022年我国国内生产总值（GDP）为1204724亿元',
        },
        nominal,
        document,
      ),
    ).toBe(true);
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: nominal.code,
          value: 17.8,
          unit: 'trillion USD',
          evidence: 'China GDP reached 17.8 trillion USD in 2022',
        },
        nominal,
        'China GDP reached 17.8 trillion USD in 2022',
      ),
    ).toBe(true);
  });

  it('rejects constant-price amounts under nominal GDP even when the quote omits the paragraph qualifier', () => {
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: nominal.code,
          value: 1099198,
          unit: '亿元',
          evidence: '2021年和2022年的GDP分别为1099198亿元和1131632亿元',
        },
        nominal,
        document,
      ),
    ).toBe(false);
  });

  it('accepts actual growth but not a constant-price GDP amount as growth', () => {
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: growth.code,
          value: 3,
          unit: '%',
          evidence: '2022年GDP比2021年实际增长3.0%',
        },
        growth,
        document,
      ),
    ).toBe(true);
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: growth.code,
          value: 1131632,
          unit: '亿元',
          evidence: '2021年和2022年的GDP分别为1099198亿元和1131632亿元',
        },
        growth,
        document,
      ),
    ).toBe(false);
  });

  it('rejects fabricated evidence and total GDP mistaken for a per-capita value', () => {
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: nominal.code,
          value: 999999,
          unit: '亿元',
          evidence: '2022年我国GDP为999999亿元',
        },
        nominal,
        document,
      ),
    ).toBe(false);
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: nominal.code,
          value: 2022,
          unit: '亿元',
          evidence: '2022年我国国内生产总值（GDP）为1204724亿元',
        },
        nominal,
        document,
      ),
    ).toBe(false);
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: perCapita.code,
          value: 1204724,
          unit: '亿元',
          evidence: '2022年我国国内生产总值（GDP）为1204724亿元',
        },
        perCapita,
        document,
      ),
    ).toBe(false);
  });

  it('infers unit from table header when the model omits unit', () => {
    const evidence = '单位：亿元\n年份 国内生产总值\n2023 1260582';
    const enriched = enrichExtractedUnitFromEvidence({
      indicatorCode: nominal.code,
      value: 1260582,
      period: '2023',
      evidence,
    });
    expect(enriched.unit).toBe('亿元');
    expect(validateExtractedIndicator(enriched, nominal, evidence)).toBe(true);
  });

  it('rejects filling catalog display unit when evidence is in CNY', () => {
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: nominal.code,
          value: 1204724,
          unit: '万亿美元',
          evidence: '2022年我国国内生产总值（GDP）为1204724亿元',
        },
        nominal,
        document,
      ),
    ).toBe(false);
  });

  it('rejects a value whose reported unit differs from its quoted source unit', () => {
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: nominal.code,
          value: 1204724,
          unit: '美元',
          evidence: '2022年我国国内生产总值（GDP）为1204724亿元',
        },
        nominal,
        document,
      ),
    ).toBe(false);
  });

  it('does not treat a forecast as an observed GDP amount', () => {
    const forecast = '预计2027年GDP为1500000亿元';
    expect(
      validateExtractedIndicator(
        {
          indicatorCode: nominal.code,
          value: 1500000,
          unit: '亿元',
          evidence: forecast,
        },
        nominal,
        forecast,
      ),
    ).toBe(false);
  });
});
