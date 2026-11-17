/** Encoding damage must not be treated as searchable evidence. */
export function hasEncodingDamage(text: string): boolean {
  const compact = text.replace(/\s/g, '');
  if (!compact) return false;
  const replacements = (compact.match(/\uFFFD/g) ?? []).length;
  const controls = (compact.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g) ?? []).length;
  return (replacements >= 3 && replacements / compact.length >= 0.01) ||
    (controls >= 3 && controls / compact.length >= 0.01);
}

/** Government archives often declare GB2312/GBK in HTTP headers or HTML meta. */
export function decodeExternalHtml(bytes: ArrayBuffer, contentType: string): string {
  const header = new TextDecoder('latin1').decode(bytes.slice(0, 8192));
  const charset = contentType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ??
    header.match(/<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i)?.[1];
  const encoding = charset && /^(?:gb2312|gbk|gb18030|x-gbk)$/i.test(charset)
    ? 'gb18030' : charset ?? 'utf-8';
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}
