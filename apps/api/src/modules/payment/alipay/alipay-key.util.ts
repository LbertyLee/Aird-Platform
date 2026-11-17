/**
 * 将开放平台下载的单行 Base64 密钥转为 PEM，供 alipay-sdk 使用。
 */
function chunkBase64(body: string, lineLen = 64): string {
  const normalized = body.replace(/\s/g, '');
  const lines: string[] = [];
  for (let i = 0; i < normalized.length; i += lineLen) {
    lines.push(normalized.slice(i, i + lineLen));
  }
  return lines.join('\n');
}

export function toPrivateKeyPem(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('BEGIN')) return trimmed;
  const body = trimmed.replace(/\s/g, '');
  const isPkcs8 = body.startsWith('MIIEvg') || body.startsWith('MIIEvQ');
  const header = isPkcs8 ? 'PRIVATE KEY' : 'RSA PRIVATE KEY';
  return `-----BEGIN ${header}-----\n${chunkBase64(body)}\n-----END ${header}-----`;
}

export function toPublicKeyPem(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('BEGIN')) return trimmed;
  const body = trimmed.replace(/\s/g, '');
  return `-----BEGIN PUBLIC KEY-----\n${chunkBase64(body)}\n-----END PUBLIC KEY-----`;
}
