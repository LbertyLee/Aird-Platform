import { decodeExternalHtml, hasEncodingDamage } from './external-text-quality';

describe('external text quality', () => {
  it('rejects replacement characters and control-heavy text without rejecting a stray symbol', () => {
    expect(hasEncodingDamage(`left ${'\uFFFD'.repeat(30)} 2024年GDP`)).toBe(true);
    expect(hasEncodingDamage(`GDP ${'\u0000'.repeat(8)}`)).toBe(true);
    expect(hasEncodingDamage('2024年泉州GDP 13094.87亿元，同比增长6.5%。')).toBe(false);
    expect(hasEncodingDamage(`2024年泉州经济统计公报 ${'正常正文'.repeat(50)} \uFFFD`)).toBe(false);
  });

  it.each(['text/html; charset=gb2312', 'text/html'])('decodes GBK archives with %s', (contentType) => {
    const prefix = Buffer.from('<meta charset="gb2312"><p>');
    // 泉州 in GBK, supplied as bytes rather than an extra encoding dependency.
    const bytes = Uint8Array.from([...prefix, 0xc8, 0xaa, 0xd6, 0xdd, ...Buffer.from('</p>')]);
    expect(decodeExternalHtml(bytes.buffer, contentType)).toContain('泉州');
  });
});
