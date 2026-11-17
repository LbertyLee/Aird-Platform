import { BadRequestException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

/** Scope idempotency to both the authenticated owner and the submitted input. */
export function backgroundJobId(
  userId: string,
  input: unknown,
  requestId?: string,
) {
  if (!requestId) return randomUUID();
  if (!/^[\w-]{1,100}$/.test(requestId)) {
    throw new BadRequestException('无效的任务请求标识。');
  }
  return createHash('sha256')
    .update(JSON.stringify([userId, requestId, canonical(input)]))
    .digest('hex');
}
