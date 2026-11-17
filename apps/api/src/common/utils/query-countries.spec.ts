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
});
