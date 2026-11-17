import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { toPrivateKeyPem, toPublicKeyPem } from './alipay-key.util';

export type AlipayRuntimeConfig = {
  enabled: boolean;
  appId: string;
  gateway: string;
  privateKey: string;
  alipayPublicKey: string | null;
  notifyUrl: string;
  /** 传给 alipay.trade.page.pay 的 return_url（建议指向 API 验签端点） */
  returnUrl: string;
  /** 验签通过后重定向的用户端地址 */
  webReturnUrl: string;
  keyType: 'PKCS1' | 'PKCS8';
  wsHost: string | null;
};

function readKeyMaterial(
  config: ConfigService,
  inlineKey: string,
  pathKey: string,
): string {
  const inline = config.get<string>(inlineKey)?.trim();
  if (inline) return inline;
  const rel = config.get<string>(pathKey)?.trim();
  if (!rel) return '';
  const abs = resolve(process.cwd(), rel);
  if (!existsSync(abs)) return '';
  return readFileSync(abs, 'utf8');
}

function defaultPrivateKeyPath(): string {
  const dir = resolve(process.cwd(), 'config/alipay');
  if (!existsSync(dir)) return '';
  const files = readdirSync(dir);
  const priv = files.find(
    (name) => name.includes('私钥') || name.toLowerCase().includes('private'),
  );
  return priv ? resolve(dir, priv) : '';
}

/**
 * 从环境变量与 config/alipay 目录加载支付宝沙箱/生产配置。
 */
export function loadAlipayConfig(config: ConfigService): AlipayRuntimeConfig {
  const enabled =
    config.get<string>('ALIPAY_ENABLED', 'false').toLowerCase() === 'true';
  const appId = config.get<string>('ALIPAY_APP_ID', '').trim();
  const gateway =
    config.get<string>('ALIPAY_GATEWAY', 'https://openapi.alipaydev.com/gateway.do') ??
    'https://openapi.alipaydev.com/gateway.do';

  let privateRaw = readKeyMaterial(
    config,
    'ALIPAY_PRIVATE_KEY',
    'ALIPAY_PRIVATE_KEY_PATH',
  );
  if (!privateRaw) {
    const fallback = defaultPrivateKeyPath();
    if (fallback && existsSync(fallback)) {
      privateRaw = readFileSync(fallback, 'utf8');
    }
  }

  let publicRaw = readKeyMaterial(
    config,
    'ALIPAY_PUBLIC_KEY',
    'ALIPAY_PUBLIC_KEY_PATH',
  );

  const apiPublicBase = (
    config.get<string>('API_PUBLIC_BASE_URL') ?? ''
  ).replace(/\/$/, '');
  const webPublicBase = (
    config.get<string>('WEB_PUBLIC_BASE_URL') ?? ''
  ).replace(/\/$/, '');

  const notifyUrl =
    config.get<string>('ALIPAY_NOTIFY_URL')?.trim() ||
    (apiPublicBase
      ? `${apiPublicBase}/api/v1/payment/alipay/notify`
      : '');
  const returnUrl =
    config.get<string>('ALIPAY_RETURN_URL')?.trim() ||
    (apiPublicBase
      ? `${apiPublicBase}/api/v1/payment/alipay/return`
      : '');
  const webReturnUrl =
    config.get<string>('ALIPAY_WEB_RETURN_URL')?.trim() ||
    (webPublicBase ? `${webPublicBase}/settlement/return` : '');

  const keyType =
    config.get<string>('ALIPAY_KEY_TYPE', 'PKCS8') === 'PKCS1'
      ? 'PKCS1'
      : 'PKCS8';

  const wsHost = config.get<string>('ALIPAY_WS_HOST')?.trim() || null;

  const privateKey = privateRaw ? toPrivateKeyPem(privateRaw) : '';
  const alipayPublicKey = publicRaw ? toPublicKeyPem(publicRaw) : null;

  return {
    enabled:
      enabled &&
      Boolean(appId && privateKey && notifyUrl && returnUrl && webReturnUrl),
    appId,
    gateway,
    privateKey,
    alipayPublicKey,
    notifyUrl,
    returnUrl,
    webReturnUrl,
    keyType,
    wsHost,
  };
}
