import { extractionExcerpt, extractionPassages } from './extraction-excerpt';

describe('long document extraction', () => {
  it('covers a late table even when earlier passages have more keyword hits', () => {
    const content =
      ('GDP 2024 中国 1亿元。' + '填'.repeat(3000)).repeat(15) +
      '\n单位：亿元\n年份 国内生产总值\n2023 123456\n';
    const passages = extractionPassages(content);
    expect(passages.some((passage) => passage.includes('2023 123456'))).toBe(
      true,
    );
    expect(passages.every((passage) => passage.length <= 18_000)).toBe(true);
    // Every position must be covered, including split boundaries.
    for (let index = 0; index < content.length; index += 1000) {
      expect(
        passages.some((passage) =>
          passage.includes(content.slice(index, index + 100)),
        ),
      ).toBe(true);
    }
  });
  it('retains metric data after the old prefix limit while keeping introductory context', () => {
    const content =
      '单位：亿元\n' +
      '普通文字说明'.repeat(4000) +
      '\n2024年中国GDP为100亿元。\n';
    const excerpt = extractionExcerpt(content, ['GDP', '2024']);
    expect(excerpt.length).toBeLessThanOrEqual(18_000);
    expect(excerpt).toContain('单位：亿元');
    expect(excerpt).toContain('GDP为100亿元');
  });

  it('keeps matching Markdown table headers and rows together in a long document', () => {
    const table = [
      '| 指标 | 年末数（万人） | 比重（%） |',
      '| --- | --- | --- |',
      '| 常住人口 | 891.4 | 100 |',
      '| 其中：城镇 | 634.6 | 71.19 |',
      '| 乡村 | 256.8 | 28.81 |',
    ].join('\n');
    const content = `引言包含数据口径说明。\n${'普通正文内容。'.repeat(1500)}\n${table}\n${'结尾说明。'.repeat(100)}`;
    const excerpt = extractionExcerpt(content, ['常住人口']);

    expect(excerpt).toContain('| 指标 | 年末数（万人） | 比重（%） |');
    expect(excerpt).toContain('| 常住人口 | 891.4 | 100 |');
    expect(excerpt).toContain('| 其中：城镇 | 634.6 | 71.19 |');
  });
});
