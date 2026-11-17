import {
  alignExternalResultUrl,
  browsableExternalUrl,
  externalUrlLookupVariants,
  preferredHostsByApex,
} from './external-search-domain';

describe('browsableExternalUrl', () => {
  it('adds www for bare stats.gov.cn', () => {
    expect(
      browsableExternalUrl(
        'https://stats.gov.cn/sj/zxfb/202401/t20240118_1946691.html',
      ),
    ).toBe(
      'https://www.stats.gov.cn/sj/zxfb/202401/t20240118_1946691.html',
    );
  });

  it('keeps www.stats.gov.cn on https', () => {
    expect(
      browsableExternalUrl(
        'https://www.stats.gov.cn/sj/zxfb/202401/t20240118_1946691.html',
      ),
    ).toBe(
      'https://www.stats.gov.cn/sj/zxfb/202401/t20240118_1946691.html',
    );
  });

  it('downgrades municipal *.*.gov.cn https to http', () => {
    expect(
      browsableExternalUrl(
        'https://szzklm.sz.gov.cn/gwzk/content/post_741874.html',
      ),
    ).toBe('http://szzklm.sz.gov.cn/gwzk/content/post_741874.html');
  });
});

describe('alignExternalResultUrl', () => {
  it('rewrites bare stats.gov.cn onto the configured www host', () => {
    const preferred = preferredHostsByApex([
      { websiteUrl: 'https://www.stats.gov.cn' },
    ]);
    expect(
      alignExternalResultUrl(
        'https://stats.gov.cn/sj/zxfb/202401/t20240117_1946624.html',
        preferred,
      ),
    ).toBe(
      'https://www.stats.gov.cn/sj/zxfb/202401/t20240117_1946624.html',
    );
  });

  it('adds www for bare gov.cn even without preferred hosts', () => {
    expect(
      alignExternalResultUrl(
        'https://stats.gov.cn/sj/zxfb/202401/t20240118_1946691.html',
      ),
    ).toBe(
      'https://www.stats.gov.cn/sj/zxfb/202401/t20240118_1946691.html',
    );
  });

  it('keeps urls that already match the preferred host', () => {
    const preferred = preferredHostsByApex([
      { websiteUrl: 'www.stats.gov.cn' },
    ]);
    expect(
      alignExternalResultUrl(
        'https://www.stats.gov.cn/sj/zxfb/202401/t20240117_1946624.html',
        preferred,
      ),
    ).toBe(
      'https://www.stats.gov.cn/sj/zxfb/202401/t20240117_1946624.html',
    );
  });
});

describe('externalUrlLookupVariants', () => {
  it('includes both www and apex forms', () => {
    const variants = externalUrlLookupVariants(
      'https://stats.gov.cn/sj/zxfb/202401/t20240118_1946691.html',
    );
    expect(variants).toEqual(
      expect.arrayContaining([
        'https://stats.gov.cn/sj/zxfb/202401/t20240118_1946691.html',
        'https://www.stats.gov.cn/sj/zxfb/202401/t20240118_1946691.html',
      ]),
    );
  });
});
