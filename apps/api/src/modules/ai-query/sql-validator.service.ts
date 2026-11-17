import { Injectable } from '@nestjs/common';

const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE)\b/i;

@Injectable()
export class SqlValidatorService {
  validate(sql: string): { valid: boolean; reason?: string } {
    const trimmed = sql.trim();
    if (!trimmed) return { valid: false, reason: 'SQL 为空' };
    if (FORBIDDEN.test(trimmed)) {
      return { valid: false, reason: '仅允许 SELECT 查询' };
    }
    const upper = trimmed.toUpperCase();
    if (!upper.startsWith('SELECT') && !upper.startsWith('WITH')) {
      return { valid: false, reason: 'SQL 必须以 SELECT 或 WITH 开头' };
    }
    if (!/\bLIMIT\b/i.test(trimmed)) {
      return { valid: false, reason: 'SQL 必须包含 LIMIT' };
    }
    return { valid: true };
  }
}
