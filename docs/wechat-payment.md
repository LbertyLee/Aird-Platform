# 微信支付 Native 扫码支付

会员结算支持微信支付 Native 模式：用户在站内弹窗扫码，后端按订单金额（人民币分）创建交易；支付通知先验签再用 APIv3 密钥解密，并核对 appid、商户号、订单号、金额、币种和交易状态后幂等开通会员。用户也可主动查单；后台每分钟补偿未收到通知的交易、超时订单和待完成退款。退款使用固定退款单号，全额成功后才撤回未消费的会员时长；PROCESSING 状态由对账任务重试。

## 上线前需准备

- 商户号及已与商户号绑定、开通 Native 支付的微信公众号 AppID。
- 商户 API 证书 `apiclient_cert.pem` 和对应私钥 `apiclient_key.pem`。配置中的证书序列号必须与证书一致。
- APIv3 密钥：微信商户平台设置的 **32 字节**密钥，单独保存为 `apiv3_key.txt`，不要提交到 Git。
- 微信支付平台公钥 PEM 文件，例如 `wechatpay_public_key.pem`，其公钥 ID 必须对应 `PUB_KEY_ID_...`。这是微信平台公钥，不能用商户证书、商户私钥、`.p12` 或商户 API 证书里的公钥代替。
- 公网可访问的 HTTPS 通知 URL。生产站点反向代理需将 `/api/v1/payment/wechat/notify` 转发到 API。

`apiclient_cert.pem`、`apiclient_key.pem`、`apiclient_cert.p12` 是商户证书这一套材料，其中 `.p12` 是前两项的打包格式；它们不包含微信支付平台公钥。将 PEM 证书和私钥放入配置目录即可，`.p12` 可留作备份。公钥 PEM 应来自微信商户平台的「微信支付公钥」下载，路径按实际文件名配置。

## 安全文件与环境变量

将四个文件放在 `apps/api/config/wechat/`，并限制为仅 API 服务账户可读。目录已加入 Git 忽略、Docker 忽略和部署源码归档排除列表，不应提交或打包密钥。生产 API 容器以只读方式挂载该目录。

本地开发在 `apps/api/.env` 配置；Docker 部署在服务器 `deploy/.env` 配置（示例见 `deploy/.env.example`）。`docker-compose.yml` 与 `docker-compose.app.yml` 均已只读挂载微信配置目录，证书和密钥需单独放入服务器对应目录：

```dotenv
WECHAT_PAY_ENABLED=true
WECHAT_PAY_APP_ID=公众号AppID
WECHAT_PAY_MCH_ID=微信支付商户号
WECHAT_PAY_CERT_SERIAL=商户证书序列号
WECHAT_PAY_PUBLIC_KEY_ID=微信支付公钥ID
WECHAT_PAY_PRIVATE_KEY_PATH=config/wechat/apiclient_key.pem
WECHAT_PAY_CERT_PATH=config/wechat/apiclient_cert.pem
WECHAT_PAY_PUBLIC_KEY_PATH=config/wechat/wechatpay_public_key.pem
WECHAT_PAY_API_V3_KEY_PATH=config/wechat/apiv3_key.txt
WECHAT_PAY_NOTIFY_URL=https://你的正式域名/api/v1/payment/wechat/notify
```

API 启动时会验证密钥长度、商户证书与私钥配对、证书序列号和有效期、公钥格式及 HTTPS 通知地址。任何必需材料缺失或不匹配时，服务会保持微信支付关闭，不会回退为不验签入账。Native 扫码无需网页授权和用户 OAuth。

## 业务接口

1. `POST /api/v1/membership/orders/:id/pay`，请求 `{"channel":"wechat"}`，返回 `payMode: "wechat_native"` 与 `qrCode`。
2. 用户支付后，微信 POST 到 `/api/v1/payment/wechat/notify`；接口使用原始 HTTP body 验签，AES-256-GCM 解密后核对订单和金额，重复通知幂等处理。
3. `POST /api/v1/membership/orders/by-no/:orderNo/sync` 主动查单并同步会员权益。
4. `POST /api/v1/membership/orders/:id/cancel` 查单并关掉未支付交易；若创建支付请求的网络结果不确定，订单会保留待支付，防止出现本地关闭但微信仍可付款的情况。
5. 管理端既有退款接口可发起全额微信退款；退款未达到 SUCCESS 前不会撤回权益。

## 微信官方 API 核对表

以下为代码实际集成的 API，已对照微信支付商户文档中心核对（2026-11-06）。主动请求域名为 `https://api.mch.weixin.qq.com`；此表不表示已发起真实商户交易。

| 官方接口 | 方法与路径 | 本项目调用时机 | 代码入口 |
| --- | --- | --- | --- |
| [Native 下单](https://pay.weixin.qq.com/doc/v3/merchant/4012791877) | `POST /v3/pay/transactions/native` | 会员订单选择微信支付，获取 `code_url` 生成扫码二维码 | `WechatService.createNativePay` |
| [商户订单号查单](https://pay.weixin.qq.com/doc/v3/merchant/4012791880) | `GET /v3/pay/transactions/out-trade-no/{out_trade_no}?mchid=...` | 用户主动同步、每分钟补偿查单、关单前确认状态 | `WechatService.queryTrade` |
| [关闭订单](https://pay.weixin.qq.com/doc/v3/merchant/4012791881) | `POST /v3/pay/transactions/out-trade-no/{out_trade_no}/close` | 取消或超时关闭微信未支付交易 | `WechatService.closeTrade` |
| [退款申请](https://pay.weixin.qq.com/doc/v3/merchant/4012791883) | `POST /v3/refund/domestic/refunds` | 管理端全额退款，固定 `out_refund_no` 保证重试幂等 | `WechatService.refundTrade` |
| [查询单笔退款](https://pay.weixin.qq.com/doc/v3/merchant/4012791884) | `GET /v3/refund/domestic/refunds/{out_refund_no}` | 申请退款前查重；补偿任务查询退款状态，确认 `SUCCESS` 后撤回权益 | `WechatService.refundTrade` |
| [支付成功回调通知](https://pay.weixin.qq.com/doc/v3/merchant/4012791882) | 微信 → 商户 `POST /api/v1/payment/wechat/notify` | 微信主动通知；验签、AES-256-GCM 解密、金额核对及幂等入账 | `WechatController.notify` |

采用微信支付公钥模式：请求使用商户私钥进行 RSA-SHA256 签名，响应和通知使用微信支付公钥验签。退款结果目前通过每分钟主动查询确认，未接入退款通知回调。仅支持直连商户 Native 扫码及全额退款，不包含 JSAPI、H5、APP 支付、分账和自动续费。

## 正式启用前检查

确认商户平台已关联公众号 AppID、开通 Native 产品、HTTPS 通知地址可从公网访问，且平台公钥 ID 与 PEM 文件匹配。文件和 APIv3 密钥补齐后再设置 `WECHAT_PAY_ENABLED=true`，重启 API 并检查启动日志中的“微信 Native 支付已就绪”。先用一笔受控的低金额订单验证下单、扫码、通知、查单和退款全链路；当前代码测试不会访问真实微信商户或创建真实订单。
