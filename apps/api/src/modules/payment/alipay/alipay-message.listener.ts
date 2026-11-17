import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { loadAlipayConfig } from './alipay.config';

/**
 * 开放平台 WebSocket 长连接（From 蚂蚁）目前仅提供 Java SDK。
 * 若应用订阅了 alipay.fund.trans.* 等 WebSocket 消息，需 Java 侧车转发至本服务 HTTP，
 * 或在开放平台将同一消息改为 HTTP 接入并走 {@link AlipayController}.
 */
@Injectable()
export class AlipayMessageListener implements OnModuleInit {
  private readonly logger = new Logger(AlipayMessageListener.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const cfg = loadAlipayConfig(this.configService);
    if (!cfg.enabled || !cfg.wsHost) return;
    this.logger.warn(
      `已配置 ALIPAY_WS_HOST=${cfg.wsHost}，但 Node 端暂无官方 WebSocket SDK。` +
        ' 电脑网站支付请使用 HTTP 异步通知；资金类 WebSocket 消息请使用 Java MsgClient 或改为 HTTP 订阅。',
    );
  }
}
