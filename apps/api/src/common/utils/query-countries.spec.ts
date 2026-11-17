import { countryCode, inferQueryCountries } from './query-countries';

describe('country recognition beyond the configured catalog', () => {
  it('recognizes the five requested countries in Chinese and English', () => {
    expect(
      inferQueryCountries('中国 美国，法国，英国 俄罗斯 近5年GDP'),
    ).toEqual(['中国', '美国', '法国', '英国', '俄罗斯']);
    expect(
      inferQueryCountries(
        'China, United States, France, UK, Russian Federation GDP',
      ),
    ).toEqual(['中国', '美国', '法国', '英国', '俄罗斯']);
    expect(countryCode('Russian Federation')).toBe('RUS');
  });
  it('keeps Indonesia distinct from India and requires English word boundaries', () => {
    expect(inferQueryCountries('印度尼西亚工业数据')).toEqual(['印度尼西亚']);
    expect(inferQueryCountries('industry and business')).toEqual([]);
  });

  it.each([
    ['比较中美 GDP', ['中国', '美国']],
    ['中美两国和英法德经济对比', ['中国', '美国', '法国', '英国', '德国']],
    ['日韩与中国比较', ['中国', '日本', '韩国']],
    ['俄印巴三国 GDP', ['俄罗斯', '印度', '巴西']],
    ['中越泰经济对比', ['中国', '越南', '泰国']],
  ])('recognizes compact country comparisons in %s', (query, expected) => {
    expect(inferQueryCountries(query)).toEqual(expected);
  });

  it('does not treat a single shorthand character as a country', () => {
    expect(inferQueryCountries('中部地区GDP增长')).toEqual([]);
  });
});
