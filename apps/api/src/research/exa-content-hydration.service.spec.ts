import {
  ExaContentHydrationService,
  extractEmbeddedArticlePlainText,
  hasFlattenedTableText,
  htmlToPlainText,
  isLowQualityPageText,
  isTitleOnly,
  needsFullText,
  reconstructFlattenedTables,
} from './exa-content-hydration.service';
import type { SourceEntity } from './research.types';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('exa content hydration helpers', () => {
  it('hydrates mixed historical providers with the corresponding contents API', async () => {
    const makeSource = (id: string, provider: string): SourceEntity => ({
      id, title: '年度统计公报', origin: 'exa', storageType: 'knowledge',
      sourceUrl: `https://example.com/${id}`, mimeType: 'text/html', excerpt: '',
      recordCount: 0, createdAt: new Date().toISOString(), textContent: '年度统计公报',
      metadata: { provider, contentMode: 'deferred' },
    });
    const sources = [makeSource('ai', 'deepseek-search'), makeSource('legacy', 'exa-search')];
    const text = `年度统计公报${'经济社会发展统计数据说明。'.repeat(100)}\n| 年份 | GDP |\n| --- | --- |\n| 2024 | 100 |`;
    const getContents = jest.fn().mockImplementation(async (urls: string[]) =>
      new Map(urls.map((url) => [url, { url, text }])));
    const updateSourceFullText = jest.fn().mockImplementation(async (id, body, metadata) => ({
      ...sources.find((source) => source.id === id), textContent: body, metadata,
    }));
    const service = new ExaContentHydrationService({
      configured: true, isConfigured: () => true, getContents,
    } as never, { updateSourceFullText } as never);
    const result = await service.ensureFullText(sources);
    expect(getContents).toHaveBeenCalledWith(['https://example.com/legacy']);
    expect(getContents).toHaveBeenCalledWith(['https://example.com/ai'], 50_000, 'deepseek');
    expect(result[0].metadata?.contentProvider).toBe('deepseek-fetch');
    expect(result[1].metadata?.contentProvider).toBe('exa-contents');
  });

  it('treats encoding damage as unusable even when years and GDP figures are present', () => {
    expect(
      isLowQualityPageText('left', `2024年GDP 100亿元 ${'\uFFFD'.repeat(200)}`),
    ).toBe(true);
  });
  it('preserves tables after nested article containers', () => {
    const text = htmlToPlainText(
      `<div id="article_content"><div>${'说明'.repeat(150)}</div><table><tr><td>2024</td><td>GDP 100亿元</td></tr></table></div>`,
    );
    expect(text).toContain('100亿元');
  });

  it('preserves table columns and combines multi-row headings for preview and extraction', () => {
    const text = htmlToPlainText(
      `<div id="article_content"><table><thead><tr><th rowspan="2">指标</th><th colspan="2">绝对额（亿元）</th><th colspan="2">同比增长（%）</th></tr><tr><th>四季度</th><th>全年</th><th>四季度</th><th>全年</th></tr></thead><tbody><tr><td>GDP</td><td>373726</td><td>1349084</td><td>5.4</td><td>5.0</td></tr><tr><td>第一产业</td><td>34050</td><td>91414</td><td>3.7</td><td>3.5</td></tr></tbody></table></div>`,
    );

    expect(text).toContain(
      '| 指标 | 绝对额（亿元） / 四季度 | 绝对额（亿元） / 全年 | 同比增长（%） / 四季度 | 同比增长（%） / 全年 |',
    );
    expect(text).toContain('| GDP | 373726 | 1349084 | 5.4 | 5.0 |');
    expect(text).toContain('| 第一产业 | 34050 | 91414 | 3.7 | 3.5 |');
  });

  it('detects Exa text with flattened table rows but does not flag Markdown tables', () => {
    expect(
      hasFlattenedTableText(
        '统计公报正文\n表3 2024年主要农产品产量\n产量（万吨）\n粮食\n51.60\n0.9',
      ),
    ).toBe(true);
    expect(
      hasFlattenedTableText(
        '| 指标 | 年末数（万人） | 比重（%） |\n| --- | --- | --- |\n| 常住人口 | 891.4 | 100 |',
      ),
    ).toBe(false);
  });

  it('reconstructs flattened table headings and numeric rows as Markdown', () => {
    const text = reconstructFlattenedTables(
      `统计公报摘要\n表1 2024年年末常住人口数及其构成\n指标\n年末数（万人）\n比重（%）\n常住人口\n891.4\n100\n其中：城镇\n634.6\n71.19\n乡村\n256.8\n28.81\n全年人口出生率为7.70%。`,
    );

    expect(text).toContain('| 指标 | 年末数（万人） | 比重（%） |');
    expect(text).toContain('| 常住人口 | 891.4 | 100 |');
    expect(text).toContain('| 其中：城镇 | 634.6 | 71.19 |');
    expect(text).toContain('| 乡村 | 256.8 | 28.81 |');
    expect(text).toContain('全年人口出生率为7.70%。');
  });

  it('refetches already hydrated Exa text when its table was flattened', async () => {
    const url = 'https://www.stats.gov.cn/example.html';
    const source: SourceEntity = {
      id: 'flattened-table-source',
      title: '2024年统计公报',
      origin: 'exa',
      storageType: 'knowledge',
      sourceUrl: url,
      mimeType: 'text/html',
      excerpt: '',
      recordCount: 0,
      createdAt: new Date().toISOString(),
      textContent: `统计公报根据资料公布${'根据统计资料'.repeat(200)}\n表3 2024年主要农产品产量\n产量（万吨）\n粮食\n51.60\n0.9`,
      metadata: { contentMode: 'full', contentProvider: 'exa-contents' },
    };
    const directText = `统计公报根据资料公布${'根据统计资料'.repeat(200)}\n\n| 指标 | 产量（万吨） | 同比增长（%） |\n| --- | --- | --- |\n| 粮食 | 51.60 | 0.9 |`;
    const updateSourceFullText = jest
      .fn()
      .mockImplementation(
        async (
          _id: string,
          text: string,
          metadata: SourceEntity['metadata'],
        ) => ({
          ...source,
          textContent: text,
          metadata,
        }),
      );
    const service = new ExaContentHydrationService(
      {
        configured: true,
        getContents: jest
          .fn()
          .mockResolvedValue(
            new Map([[url, { url, text: source.textContent }]]),
          ),
      } as never,
      { updateSourceFullText } as never,
    );
    jest
      .spyOn(service as never, 'fetchPageText' as never)
      .mockResolvedValue(directText as never);

    const result = await service.ensureFullText([source]);

    expect(updateSourceFullText).toHaveBeenCalledWith(
      source.id,
      directText,
      expect.objectContaining({ contentProvider: 'direct-http' }),
    );
    expect(result[0].textContent).toContain('| 粮食 | 51.60 | 0.9 |');
  });

  it('rehydrates a stored full Exa source when its table was flattened', () => {
    const source: SourceEntity = {
      id: 'flattened-full-source',
      title: '2024年统计公报',
      origin: 'exa',
      storageType: 'knowledge',
      sourceUrl: 'https://www.stats.gov.cn/example.html',
      mimeType: 'text/html',
      excerpt: '',
      recordCount: 0,
      createdAt: new Date().toISOString(),
      textContent:
        '表1 2024年年末常住人口数及其构成\n指标\n年末数（万人）\n比重（%）\n常住人口\n891.4\n100',
      metadata: { contentMode: 'full', contentProvider: 'exa-contents' },
    };

    expect(needsFullText(source)).toBe(true);
  });

  it('accepts short statistical notices and articles with login chrome', () => {
    expect(isLowQualityPageText('统计通知', '2024年江苏GDP为100亿元。')).toBe(
      false,
    );
    expect(
      isLowQualityPageText(
        '统计公报',
        `用户登录 立即注册 发布时间2024年 GDP为100亿元。${'统计说明'.repeat(80)}`,
      ),
    ).toBe(false);
  });
  it('detects title-only deferred Exa rows', () => {
    const source: SourceEntity = {
      id: '1',
      title: '国家统计局：什么是现价和不变价 - 国家统计局',
      origin: 'exa',
      storageType: 'knowledge',
      sourceUrl:
        'https://www.stats.gov.cn/zs/tjws/tjzb/202301/t20230101_1903788.html',
      mimeType: 'text/html',
      excerpt: '国家统计局：什么是现价和不变价 - 国家统计局',
      recordCount: 0,
      createdAt: new Date().toISOString(),
      textContent: '国家统计局：什么是现价和不变价 - 国家统计局',
      metadata: { contentMode: 'deferred' },
    };
    expect(isTitleOnly(source.title, source.textContent)).toBe(true);
    expect(needsFullText(source)).toBe(true);
  });

  it('detects a page title after the configured source prefix', () => {
    expect(
      isTitleOnly(
        '国家统计局：什么是现价和不变价 - 国家统计局',
        '什么是现价和不变价 - 国家统计局',
      ),
    ).toBe(true);
  });

  it('retries full-text hydration after the first provider response is empty', async () => {
    const url =
      'https://www.stats.gov.cn/zs/tjws/tjzb/202301/t20230101_1903788.html';
    const source: SourceEntity = {
      id: 'retry-source',
      title: '国家统计局：什么是现价和不变价 - 国家统计局',
      origin: 'exa',
      storageType: 'knowledge',
      sourceUrl: url,
      mimeType: 'text/html',
      excerpt: '',
      recordCount: 0,
      createdAt: new Date().toISOString(),
      textContent: '什么是现价和不变价 - 国家统计局',
      metadata: { contentMode: 'unavailable', extractionUnavailable: true },
    };
    const fullText =
      '比如2022年我国国内生产总值（GDP）为1204724亿元，2021年GDP为1149237亿元。';
    const getContents = jest
      .fn()
      .mockResolvedValueOnce(new Map())
      .mockResolvedValueOnce(new Map([[url, { url, text: fullText }]]));
    const updateSourceFullText = jest
      .fn()
      .mockImplementation(
        async (
          _id: string,
          text: string,
          metadata: SourceEntity['metadata'],
        ) => ({
          ...source,
          textContent: text,
          metadata,
        }),
      );
    const service = new ExaContentHydrationService(
      { configured: true, getContents } as never,
      { updateSourceFullText } as never,
    );
    jest
      .spyOn(service as never, 'fetchPageText' as never)
      .mockResolvedValue(null as never);

    const result = await service.ensureFullText([source]);

    expect(getContents).toHaveBeenCalledTimes(2);
    expect(updateSourceFullText).toHaveBeenCalledWith(
      source.id,
      fullText,
      expect.objectContaining({
        contentMode: 'full',
        extractionUnavailable: false,
      }),
    );
    expect(result[0].textContent).toBe(fullText);
    expect(result[0].metadata?.extractionUnavailable).toBe(false);
  });

  it('marks the returned source unavailable immediately after failed hydration', async () => {
    const source: SourceEntity = {
      id: 'unavailable-source',
      title: '统计通知',
      origin: 'exa',
      storageType: 'knowledge',
      sourceUrl: 'https://www.stats.gov.cn/notice.html',
      mimeType: 'text/html',
      excerpt: '',
      recordCount: 0,
      createdAt: new Date().toISOString(),
      textContent: '统计通知',
      metadata: { contentMode: 'deferred' },
    };
    const updateSourceMetadata = jest.fn().mockResolvedValue(undefined);
    const service = new ExaContentHydrationService(
      {
        configured: true,
        getContents: jest.fn().mockResolvedValue(new Map()),
      } as never,
      { updateSourceMetadata } as never,
    );
    jest
      .spyOn(service as never, 'fetchPageText' as never)
      .mockResolvedValue(null as never);
    const result = await service.ensureFullText([source]);
    expect(updateSourceMetadata).toHaveBeenCalledWith(
      source.id,
      expect.objectContaining({ extractionUnavailable: true }),
    );
    expect(result[0].metadata).toEqual(
      expect.objectContaining({
        contentMode: 'unavailable',
        extractionUnavailable: true,
      }),
    );
  });

  it('rehydrates when stored full text is login-page chrome', () => {
    const source: SourceEntity = {
      id: '2',
      title: '法媒文章：全球头号经济体究竟怎么“算”',
      origin: 'exa',
      storageType: 'knowledge',
      sourceUrl: 'http://szzklm.sz.gov.cn/gwzk/content/post_741874.html',
      mimeType: 'text/html',
      excerpt: '登录注册',
      recordCount: 0,
      createdAt: new Date().toISOString(),
      textContent:
        '法媒文章：全球头号经济体究竟怎么“算” -- -- 登录注册 关闭 用户登录 注册 登录 关闭 新用户注册 请输入验证码',
      metadata: { contentMode: 'full', contentProvider: 'direct-http' },
    };
    expect(isLowQualityPageText(source.title, source.textContent)).toBe(true);
    expect(needsFullText(source)).toBe(true);
  });

  it('marks damaged content unavailable when neither provider can recover it', async () => {
    const url = 'https://data.stats.gov.cn/broken';
    const damaged = `泉州2024年GDP 100亿元 ${'\uFFFD'.repeat(200)}`;
    const source: SourceEntity = {
      id: 'damaged-source',
      title: 'left',
      origin: 'exa',
      storageType: 'knowledge',
      sourceUrl: url,
      mimeType: 'text/html',
      excerpt: damaged,
      recordCount: 0,
      createdAt: new Date().toISOString(),
      textContent: damaged,
      metadata: { contentMode: 'full' },
    };
    const updateSourceFullText = jest.fn();
    const updateSourceMetadata = jest.fn();
    const service = new ExaContentHydrationService(
      {
        configured: true,
        getContents: async () => new Map([[url, { url, text: damaged }]]),
      } as never,
      { updateSourceFullText, updateSourceMetadata } as never,
    );
    jest
      .spyOn(service as never, 'fetchPageText' as never)
      .mockResolvedValue(damaged as never);
    expect(needsFullText(source)).toBe(true);
    const [result] = await service.ensureFullText([source]);
    expect(updateSourceFullText).not.toHaveBeenCalled();
    expect(result.metadata?.extractionUnavailable).toBe(true);
  });

  it('strips html and keeps GDP figures', () => {
    const text = htmlToPlainText(`
      <html><head><script>void 0</script><style>.a{}</style></head>
      <body><p>比如2022年我国国内生产总值（GDP）为1204724亿元</p>
      <p>2021年GDP为1149237亿元</p></body></html>
    `);
    expect(text).toContain('1204724亿元');
    expect(text).toContain('1149237亿元');
    expect(text).not.toContain('<p>');
  });

  it('extracts articleData.content from stats.gov.cn visualization pages', () => {
    const html = `
      <title>国际统计数据-主题可视化</title>
      <script>
        new topicVisualizationTwo("#app", {
          articleData: {
            title: "中国是世界经济增长的第一动力",
            content: "<div class=\\"view TRS_UEDITOR\\"><p>2013—2021年，中国经济年均增长6.6%，大大高于2.6%的同期世界平均增速。</p><p>2013—2021年，中国对世界经济增长的平均贡献率达到38.6%。</p></div>",
          },
          middleChartData: [],
        });
      </script>
    `;
    const text = htmlToPlainText(html);
    expect(text).toContain('中国是世界经济增长的第一动力');
    expect(text).toContain('6.6%');
    expect(text).toContain('38.6%');
    expect(extractEmbeddedArticlePlainText(html)).toContain('6.6%');
  });

  it('prefers CMS article containers over login chrome', () => {
    const fixture = join(process.cwd(), '../../.tmp-stash-ref/szzk_page.html');
    let html: string;
    try {
      html = readFileSync(fixture, 'utf8');
    } catch {
      html = `
        <div class="content"><span>用户登录</span><input placeholder="用户名"/></div>
        <div class="sub-text-biaoti">法媒文章：全球头号经济体究竟怎么“算”</div>
        <div class="sub-text-zhushi">信息来源：参考消息 发布时间：2021-11-08</div>
        <div class="sub-text"><p>按购买力平价计算中国已经是全球第一大经济体。美国的国内生产总值（GDP）依然高于中国。</p></div>
      `;
    }
    const text = htmlToPlainText(html);
    expect(text).toContain('购买力');
    expect(text).toMatch(/G\s*D\s*P|ＧＤＰ/);
    expect(text).not.toMatch(/用户登录[\s\S]{0,40}用户名/);
  });
});
