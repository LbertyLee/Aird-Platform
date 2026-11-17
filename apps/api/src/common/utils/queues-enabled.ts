/**
 * 是否启用 Redis + BullMQ 队列 Worker。
 * 只要配置了 REDIS_HOST 且未强制走内存降级即可（支持本地与远程 Redis）。
 */
export function isQueuesEnabled(): boolean {
  if (process.env.STORAGE_FALLBACK_TO_MEMORY === 'true' ||
      process.env.REDIS_FALLBACK_TO_MEMORY === 'true') return false;
  return Boolean(process.env.REDIS_HOST?.trim());
}
