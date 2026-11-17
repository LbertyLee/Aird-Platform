import {
  matchDictionariesInText,
  matchIndicatorsInText,
  textContainsTerm,
} from './dataset-auto-link';

describe('dataset-auto-link', () => {
  it('matches CJK indicator names in document text', () => {
    const hits = matchIndicatorsInText('本文分析城镇调查失业率及 GDP 走势', [
      { id: '1', name: '城镇调查失业率', code: 'UR' },
      { id: '2', name: '居民消费价格指数', code: 'CPI' },
    ]);
    expect(hits.map((item) => item.id)).toEqual(['1']);
  });

  it('matches dictionary aliases and short ascii codes with boundary', () => {
    const text = '覆盖 CN / US 与制造业样本';
    expect(textContainsTerm(text, 'CN')).toBe(true);
    expect(textContainsTerm('ACNE factory', 'CN')).toBe(false);

    const hits = matchDictionariesInText(text, [
      {
        id: 'cn',
        name: '中国',
        code: 'CN',
        aliases: ['Mainland China'],
      },
      {
        id: 'mfg',
        name: '制造业',
        code: 'MFG',
        aliases: [],
      },
      {
        id: 'agri',
        name: '农业',
        code: 'AGR',
        aliases: [],
      },
    ]);
    expect(hits.map((item) => item.id).sort()).toEqual(['cn', 'mfg']);
  });
});
