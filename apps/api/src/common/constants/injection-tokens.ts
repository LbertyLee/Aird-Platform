/**
 * DI 注入令牌常量，面向接口绑定实现。
 */
export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
/** 权益合并策略注入令牌 */
export const BENEFIT_MERGE_STRATEGY = Symbol('BENEFIT_MERGE_STRATEGY');
/** Redis 端口注入令牌 */
export const REDIS_PORT = Symbol('REDIS_PORT');
/** 支付网关注入令牌 */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
/** 通知端口注入令牌 */
export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');
