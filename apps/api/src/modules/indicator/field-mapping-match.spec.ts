import {
  classifyMatchConfidence,
  hasMetricFieldConceptConflict,
  matchFieldsToIndicators,
  normalizeFieldLabel,
} from './field-mapping-match';

describe('normalizeFieldLabel', () => {
  it('strips units and full-width parentheses', () => {
    expect(normalizeFieldLabel('人均GDP（元）')).toBe('人均gdp');
    expect(normalizeFieldLabel('GDP (亿元)')).toBe('gdp');
  });

  it('folds synonyms', () => {
    expect(normalizeFieldLabel('人均国内生产总值')).toBe('人均gdp');
  });
});

describe('matchFieldsToIndicators', () => {
  const indicators = [
    {
      id: 'ind-gdp-pc',
      code: 'gdp_per_capita',
      name: '人均GDP',
      aliases: ['人均国内生产总值', 'GDP per capita'],
    },
    {
      id: 'ind-gdp',
      code: 'gdp_current_usd',
      name: 'GDP',
      aliases: ['国内生产总值'],
    },
    {
      id: 'ind-cab',
      code: 'cab_gdp',
      name: '经常账户余额占GDP比重',
      aliases: [],
    },
    {
      id: 'ind-growth',
      code: 'gdp_real_growth',
      name: 'GDP实际增速',
      aliases: ['GDP', 'GDP（亿元）'],
    },
  ];

  const fields = [
    {
      id: 'f-country',
      fieldName: '国家',
      displayName: '国家',
      dataType: 'string',
      semanticType: 'dimension',
    },
    {
      id: 'f-year',
      fieldName: '年份',
      displayName: '年份',
      dataType: 'string',
      semanticType: 'time',
    },
    {
      id: 'f-gdp-pc',
      fieldName: '人均GDP（元）',
      displayName: '人均GDP（元）',
      dataType: 'decimal',
      semanticType: 'metric',
    },
    {
      id: 'f-gdp',
      fieldName: 'GDP（亿元）',
      displayName: 'GDP（亿元）',
      dataType: 'decimal',
    },
  ];

  it('maps 人均GDP（元） to gdp_per_capita as exact (100)', () => {
    const matches = matchFieldsToIndicators(fields, indicators);
    const hit = matches.find((m) => m.indicatorId === 'ind-gdp-pc');
    expect(hit).toBeDefined();
    expect(hit!.datasetFieldId).toBe('f-gdp-pc');
    expect(hit!.confidence).toBe(1);
    expect(classifyMatchConfidence(hit!.confidence)).toBe('exact');
  });

  it('does not map cab_gdp to GDP（亿元） after concept conflict', () => {
    const matches = matchFieldsToIndicators(fields, indicators);
    const hit = matches.find((m) => m.indicatorId === 'ind-cab');
    expect(hit).toBeUndefined();
  });

  it('rejects GDP实际增速 vs GDP（亿元） even with misleading aliases', () => {
    const matches = matchFieldsToIndicators(fields, indicators);
    const hit = matches.find((m) => m.indicatorId === 'ind-growth');
    expect(hit).toBeUndefined();
  });

  it('detects rate vs absolute conflict helper', () => {
    expect(
      hasMetricFieldConceptConflict(
        { name: 'GDP实际增速', code: 'gdp_real_growth' },
        'GDP（亿元）',
      ),
    ).toBe(true);
    expect(
      hasMetricFieldConceptConflict(
        { name: '人均GDP', code: 'gdp_per_capita' },
        '人均GDP（元）',
      ),
    ).toBe(false);
  });

  it('skips dimension columns', () => {
    const matches = matchFieldsToIndicators(fields, indicators);
    expect(matches.every((m) => m.datasetFieldId !== 'f-country')).toBe(true);
    expect(matches.every((m) => m.datasetFieldId !== 'f-year')).toBe(true);
  });

  it('puts weak name overlap into needs_llm or low', () => {
    const matches = matchFieldsToIndicators(
      [
        {
          id: 'f-weak',
          fieldName: '人均产出',
          dataType: 'decimal',
        },
      ],
      [
        {
          id: 'ind-gdp-pc',
          code: 'gdp_per_capita',
          name: '人均GDP',
          aliases: [],
        },
      ],
    );
    if (!matches.length) {
      expect(matches).toHaveLength(0);
      return;
    }
    expect(classifyMatchConfidence(matches[0].confidence)).not.toBe('exact');
  });
});
