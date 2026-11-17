import { describe, expect, it } from 'vitest';
import { browsableExternalUrl } from './browsable-external-url';

describe('browsableExternalUrl', () => {
  it('adds www for bare *.gov.cn apex hosts', () => {
    expect(
      browsableExternalUrl(
        'https://stats.gov.cn/sj/zxfb/202401/t20240117_1946624.html',
      ),
    ).toBe(
      'https://www.stats.gov.cn/sj/zxfb/202401/t20240117_1946624.html',
    );
  });

  it('leaves www.stats.gov.cn on https', () => {
    expect(browsableExternalUrl('https://www.stats.gov.cn/')).toBe(
      'https://www.stats.gov.cn/',
    );
  });

  it('uses http for municipal *.*.gov.cn hosts whose https hangs', () => {
    expect(
      browsableExternalUrl(
        'https://szzklm.sz.gov.cn/gwzk/content/post_741874.html',
      ),
    ).toBe('http://szzklm.sz.gov.cn/gwzk/content/post_741874.html');
  });
});
