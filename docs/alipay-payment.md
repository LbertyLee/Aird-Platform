# 支付宝会员支付

当前会员支付统一使用「电脑网站支付」（`alipay.trade.page.pay` / `FAST_INSTANT_TRADE_PAY`），返回签名表单由浏览器 POST 提交至支付宝收银台，并提供异步通知、主动查单、关单和全额退款。二维码展示由支付宝收银台负责，不调用当面付预下单接口。此流程不需要支付宝 OAuth；OAuth 授权地址与支付回调地址是两套功能。

结算页使用站内弹窗和 iframe 承载收银台，设置 `qr_pay_mode: "4"`、`qrcode_width: 220` 展示嵌入式二维码，不打开新的浏览器页面。弹窗打开期间每 3 秒向服务端查单，最长 10 分钟；关闭弹窗仅停止自动查询，不关闭订单，仍可手动查询或重新打开支付。支付成功以服务端验签通知或查单结果为准，iframe 加载完成不代表支付成功。

用户须先选择支付宝，再在支付方式区域点击“立即支付”。`GET /api/v1/membership/orders` 的每条订单增加 `expiresAt`（带时区的 ISO 8601 字符串），取订单创建时间加 30 分钟，与服务端支付校验、支付宝表单截止时间一致。页面和弹窗据此显示倒计时，刷新页面不会重置；到期禁用付款并移除二维码，保留查单入口，不直接将订单标记为已关闭，以便确认临界时间已完成的付款。

## 开放平台配置

当前部署使用同一站点 `https://aidatank.xyz`，API 通过 Nginx 的 `/api/` 反向代理到后端，支付宝后台填写：

- **授权回调地址**：本项目没有使用支付宝登录授权，因此这里无需填写支付接口。若开放平台强制要求，可填写业务上专门实现的 OAuth 地址；不要填写 `/payment/alipay/notify`。
- **交易异步通知地址**：`https://aidatank.xyz/api/v1/payment/alipay/notify`
- **电脑网站支付同步回跳地址**：`https://aidatank.xyz/api/v1/payment/alipay/return`
- **Web 回跳页面**：由后端验签后重定向到 `https://aidatank.xyz/settlement/return`

异步通知地址必须是公网 HTTPS，并允许支付宝以 `application/x-www-form-urlencoded` POST。支付宝公钥必须配置为开放平台显示的「支付宝公钥」，不能填应用公钥。

## 环境变量

在 `apps/api/.env` 配置：

```dotenv
ALIPAY_ENABLED=true
ALIPAY_APP_ID=应用的APPID
ALIPAY_SELLER_ID=签约主体的PID
ALIPAY_GATEWAY=https://openapi.alipay.com/gateway.do
ALIPAY_PRIVATE_KEY_PATH=config/alipay/app_private_key.pem
ALIPAY_PUBLIC_KEY_PATH=config/alipay/alipay_public_key.pem
API_PUBLIC_BASE_URL=https://aidatank.xyz
WEB_PUBLIC_BASE_URL=https://aidatank.xyz
PAYMENT_MOCK_ENABLED=false
```

也可以直接使用 `ALIPAY_PRIVATE_KEY` 和 `ALIPAY_PUBLIC_KEY`。密钥文件不要提交到 Git。服务启动时缺少支付宝公钥会禁用 SDK，避免未验签入账。

## 业务链路

1. 前端 `POST /api/v1/membership/orders` 创建待支付订单。
2. 前端 `POST /api/v1/membership/orders/:id/pay`，返回电脑网站支付表单；默认 `alipayMode: "page"`，兼容旧版 `qr` 参数但统一走网页支付。
3. 支付宝向 `/payment/alipay/notify` 通知；服务端校验签名、`app_id`、商户号和金额后幂等开通会员。
4. 电脑网页支付先回到 `/payment/alipay/return`，该接口验签后重定向到前端再主动查单。
5. 待支付订单可由用户调用 `POST /api/v1/membership/orders/:id/cancel` 关闭。表单仍可能有效且支付宝查不到交易时，服务端会等待过期，避免用户仍能付款而本地订单已关闭。
6. 管理端通过 `POST /api/v1/admin/membership/orders/:id/refund` 全额退款。退款请求号固定为 `RF + orderNo`，网络超时可安全重试；退款只撤回同一支付权益链的未消费时长。
7. 支付事件持久化到 `payment_operation_logs`，管理员可用 `GET /api/v1/admin/membership/payment-operation-logs` 分页查看，并按 `orderNo`、`action`、`status` 筛选。该事件日志与成功支付流水、退款流水及管理审计分开保存。

## 数据库部署

发布前执行：

```bash
pnpm --filter @agent/api prisma migrate deploy
pnpm --filter @agent/api prisma generate
```

迁移会保存下单时长、权益起止时间、退款请求时间和支付权益链。历史订单缺少可靠的权益快照时，系统会拒绝自动退款，需管理员先人工核对。

支付宝应用需签约并关联「电脑网站支付」产品能力，应用私钥须与该生产 APPID 后台的应用公钥配套。自营收款无需额外填写第三方应用授权令牌；仅服务商代商户调用时按授权模式配置。
