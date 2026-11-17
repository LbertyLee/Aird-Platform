import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { sms } from 'tencentcloud-sdk-nodejs';
import { REDIS_PORT } from '../../common/constants/injection-tokens';
import { BusinessException } from '../../common/exceptions/business.exception';
import { IRedisPort } from '../../infrastructure/redis/redis.service';

const SmsClient = sms.v20210111.Client;

export type SmsScene = 'login' | 'register';

/**
 * 短信验证码：生成、发送（腾讯云 SMS）、Redis 校验。
 */
@Injectable()
export class SmsVerificationService {
  private readonly logger = new Logger(SmsVerificationService.name);
  private readonly codeTtlSec: number;
  private readonly sendIntervalSec: number;
  private readonly sdkAppId: string;
  private readonly signName: string;
  private readonly templateId: string;
  private readonly region: string;
  private readonly secretId: string;
  private readonly secretKey: string;
  private readonly previewCode: string | null;
  private readonly client: InstanceType<typeof SmsClient> | null;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_PORT) private readonly redis: IRedisPort,
  ) {
    this.codeTtlSec = this.config.get<number>('TENCENT_SMS_CODE_TTL_SEC') ?? 300;
    this.sendIntervalSec =
      this.config.get<number>('TENCENT_SMS_SEND_INTERVAL_SEC') ?? 60;
    this.sdkAppId = this.config.get<string>('TENCENT_SMS_SDK_APP_ID') ?? '';
    this.signName = this.config.get<string>('TENCENT_SMS_SIGN_NAME') ?? '';
    this.templateId = this.config.get<string>('TENCENT_SMS_TEMPLATE_ID') ?? '';
    this.region =
      this.config.get<string>('TENCENT_SMS_REGION') ?? 'ap-guangzhou';
    this.secretId = this.config.get<string>('TENCENT_SMS_SECRET_ID') ?? '';
    this.secretKey = this.config.get<string>('TENCENT_SMS_SECRET_KEY') ?? '';
    const smsReady =
      Boolean(this.secretId) &&
      Boolean(this.secretKey) &&
      Boolean(this.sdkAppId) &&
      Boolean(this.signName) &&
      Boolean(this.templateId);

    const preview = (this.config.get<string>('TENCENT_SMS_PREVIEW_CODE') ?? '').trim();
    const forcePreview =
      this.config.get<string>('TENCENT_SMS_FORCE_PREVIEW') === 'true';
    if (forcePreview) {
      this.previewCode = preview || '1111';
    } else if (!smsReady) {
      // 未配齐腾讯云 SMS 时，各环境均可用固定验证码（默认 1111）
      this.previewCode = preview || '1111';
    } else if (preview) {
      this.previewCode = preview;
    } else {
      this.previewCode = null;
    }

    this.client = smsReady
      ? new SmsClient({
          credential: {
            secretId: this.secretId,
            secretKey: this.secretKey,
          },
          region: this.region,
          profile: {
            httpProfile: { endpoint: 'sms.tencentcloudapi.com' },
          },
        })
      : null;
  }

  /** 是否走预览固定验证码（未配置完整腾讯云 SMS，或强制预览） */
  isPreviewMode(): boolean {
    const forcePreview =
      this.config.get<string>('TENCENT_SMS_FORCE_PREVIEW') === 'true';
    if (forcePreview) return Boolean(this.previewCode);
    return !this.client && Boolean(this.previewCode);
  }

  private codeKey(phone: string) {
    return `auth:sms:code:${phone}`;
  }

  private rateKey(phone: string) {
    return `auth:sms:rate:${phone}`;
  }

  private assertPhone(phone: string) {
    const normalized = phone.trim();
    if (!/^1[3-9]\d{9}$/.test(normalized)) {
      throw new BusinessException('INVALID_PHONE', '手机号格式不正确', 400);
    }
    return normalized;
  }

  private generateCode(): string {
    return String(randomInt(1000, 10000));
  }

  /**
   * 发送验证码；登录/注册场景由调用方做业务校验。
   */
  async sendCode(phone: string, scene: SmsScene): Promise<void> {
    const normalized = this.assertPhone(phone);
    void scene;

    if (this.isPreviewMode()) {
      await this.redis.set(
        this.codeKey(normalized),
        this.previewCode!,
        this.codeTtlSec,
      );
      return;
    }

    if (!this.client) {
      throw new BusinessException(
        'SMS_NOT_CONFIGURED',
        '短信服务未配置，请联系管理员配置腾讯云 SMS',
        503,
      );
    }

    const cooling = await this.redis.get(this.rateKey(normalized));
    if (cooling) {
      throw new BusinessException(
        'SMS_RATE_LIMIT',
        '发送过于频繁，请稍后再试',
        429,
      );
    }

    const code = this.generateCode();
    const response = await this.client.SendSms({
      SmsSdkAppId: this.sdkAppId,
      SignName: this.signName,
      TemplateId: this.templateId,
      TemplateParamSet: [code],
      PhoneNumberSet: [`+86${normalized}`],
    });

    const status = response.SendStatusSet?.[0];
    if (!status || status.Code !== 'Ok') {
      this.logger.warn(
        `Tencent SMS failed: ${status?.Code ?? 'unknown'} ${status?.Message ?? ''}`,
      );
      throw new BusinessException(
        'SMS_SEND_FAILED',
        status?.Message ?? '短信发送失败，请稍后重试',
        502,
      );
    }

    await this.redis.set(this.codeKey(normalized), code, this.codeTtlSec);
    await this.redis.set(this.rateKey(normalized), '1', this.sendIntervalSec);
  }

  /**
   * 校验验证码并删除（一次性）。
   */
  async verifyAndConsume(phone: string, code: string): Promise<void> {
    const normalized = this.assertPhone(phone);
    const input = code.trim();

    if (this.isPreviewMode()) {
      if (input !== this.previewCode) {
        throw new BusinessException('INVALID_CODE', '验证码错误', 400);
      }
      return;
    }

    const stored = await this.redis.get(this.codeKey(normalized));
    if (!stored) {
      throw new BusinessException(
        'CODE_EXPIRED',
        '验证码已过期，请重新获取',
        400,
      );
    }
    if (stored !== input) {
      throw new BusinessException('INVALID_CODE', '验证码错误', 400);
    }
    await this.redis.del(this.codeKey(normalized));
  }
}
