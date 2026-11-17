import { validateEnvironment } from './env.validation';

describe('environment validation', () => {
  it('preserves WeChat Pay configuration for the payment service', () => {
    const wechatConfig = {
      WECHAT_PAY_ENABLED: 'true',
      WECHAT_PAY_APP_ID: 'app-id',
      WECHAT_PAY_MCH_ID: 'merchant-id',
      WECHAT_PAY_CERT_SERIAL: 'MERCHANT_CERT_SERIAL',
      WECHAT_PAY_PUBLIC_KEY_ID: 'PUB_KEY_ID_TEST',
      WECHAT_PAY_PRIVATE_KEY_PATH: 'config/wechat/apiclient_key.pem',
      WECHAT_PAY_CERT_PATH: 'config/wechat/apiclient_cert.pem',
      WECHAT_PAY_PUBLIC_KEY_PATH: 'config/wechat/wechatpay_public_key.pem',
      WECHAT_PAY_API_V3_KEY_PATH: 'config/wechat/apiv3_key.txt',
      WECHAT_PAY_NOTIFY_URL: 'https://example.test/api/v1/payment/wechat/notify',
    };
    const env = validateEnvironment({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
      MINIO_ENDPOINT: 'http://localhost:9000',
      MINIO_ACCESS_KEY: 'agent',
      MINIO_SECRET_KEY: 'local-secret',
      MINIO_BUCKET: 'files',
      JWT_SECRET: 'x'.repeat(32),
      ...wechatConfig,
    });

    expect(env).toMatchObject(wechatConfig);
  });
});
