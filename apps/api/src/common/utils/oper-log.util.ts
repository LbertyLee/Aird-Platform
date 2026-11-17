import type { Request } from 'express';
import {
  OPER_BUSINESS_DELETE,
  OPER_BUSINESS_INSERT,
  OPER_BUSINESS_OTHER,
  OPER_BUSINESS_UPDATE,
  OPER_LOG_MAX_TEXT,
  OPER_LOG_SENSITIVE_KEYS,
} from '../constants/oper-log.constants';

/**
 * 从 HTTP 方法推断业务类型。
 */
export function resolveBusinessTypeByMethod(method: string): number {
  switch (method.toUpperCase()) {
    case 'POST':
      return OPER_BUSINESS_INSERT;
    case 'PUT':
    case 'PATCH':
      return OPER_BUSINESS_UPDATE;
    case 'DELETE':
      return OPER_BUSINESS_DELETE;
    default:
      return OPER_BUSINESS_OTHER;
  }
}

/**
 * 规范化客户端 IP：剥离 IPv6 映射前缀，并将回环地址统一为 127.0.0.1。
 */
export function normalizeClientIp(ip: string): string {
  let value = (ip ?? '').trim();
  if (!value) return '';
  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1);
  }
  // IPv4-mapped IPv6，如 ::ffff:192.168.1.1
  if (value.toLowerCase().startsWith('::ffff:')) {
    value = value.slice(7);
  }
  // 本机回环（IPv6 / IPv4）
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') {
    return '127.0.0.1';
  }
  return value;
}

/**
 * 解析客户端 IP。
 */
export function resolveClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return normalizeClientIp(forwarded.split(',')[0]?.trim() ?? '');
  }
  if (Array.isArray(forwarded) && forwarded[0]) {
    return normalizeClientIp(forwarded[0].split(',')[0]?.trim() ?? '');
  }
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return normalizeClientIp(realIp);
  }
  return normalizeClientIp(req.ip ?? req.socket.remoteAddress ?? '');
}

/**
 * 简单内网 IP 判定，用于操作地点占位。
 */
export function resolveOperLocation(ip: string): string {
  if (!ip) return '';
  const normalized = normalizeClientIp(ip);
  if (
    normalized === '127.0.0.1' ||
    normalized.startsWith('192.168.') ||
    normalized.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(normalized)
  ) {
    return '内网IP';
  }
  return '';
}

/**
 * 脱敏并序列化对象为日志字符串。
 */
export function serializeOperLogPayload(value: unknown): string {
  if (value === undefined || value === null) return '';
  try {
    const sanitized = sanitizeOperLogValue(value);
    const text = JSON.stringify(sanitized);
    return truncateOperLogText(text);
  } catch {
    return truncateOperLogText(String(value));
  }
}

/**
 * 截断日志文本到最大长度。
 */
export function truncateOperLogText(text: string): string {
  if (text.length <= OPER_LOG_MAX_TEXT) return text;
  return `${text.slice(0, OPER_LOG_MAX_TEXT - 3)}...`;
}

/**
 * 提取请求参数（query + body + 上传文件元信息）。
 */
export function buildOperParams(req: Request): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (req.query && Object.keys(req.query).length > 0) {
    payload.query = req.query;
  }
  if (req.body && Object.keys(req.body).length > 0) {
    payload.body = req.body;
  }
  if (req.params && Object.keys(req.params).length > 0) {
    payload.params = req.params;
  }

  const file = (req as Request & { file?: Express.Multer.File }).file;
  if (file) {
    payload.file = {
      fieldname: file.fieldname,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    };
  }

  const files = (req as Request & { files?: Express.Multer.File[] }).files;
  if (Array.isArray(files) && files.length > 0) {
    payload.files = files.map((item) => ({
      fieldname: item.fieldname,
      originalname: item.originalname,
      mimetype: item.mimetype,
      size: item.size,
    }));
  }

  return payload;
}

function sanitizeOperLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeOperLogValue(item));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (OPER_LOG_SENSITIVE_KEYS.has(key.toLowerCase())) {
        result[key] = '***';
        continue;
      }
      result[key] = sanitizeOperLogValue(nested);
    }
    return result;
  }
  return value;
}

/**
 * 从异常对象提取错误消息。
 */
export function resolveErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return truncateOperLogText(String(error ?? '未知错误'));
  }
  const candidate = error as {
    message?: unknown;
    response?: { message?: unknown };
  };
  const message = candidate.response?.message ?? candidate.message;
  if (Array.isArray(message)) {
    return truncateOperLogText(message.join('; '));
  }
  if (typeof message === 'string') {
    return truncateOperLogText(message);
  }
  return truncateOperLogText(JSON.stringify(message ?? error));
}
