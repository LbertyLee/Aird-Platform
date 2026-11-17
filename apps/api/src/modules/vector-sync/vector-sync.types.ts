/** 向量同步任务载荷 */
export type VectorSyncJob =
  | { action: 'upsert'; entity: 'indicator'; id: string }
  | { action: 'delete'; entity: 'indicator'; id: string }
  | { action: 'upsert'; entity: 'dictionary'; id: string }
  | { action: 'delete'; entity: 'dictionary'; id: string }
  | { action: 'upsert'; entity: 'knowledge'; id: string }
  | { action: 'delete'; entity: 'knowledge'; id: string };

/** BullMQ 队列名 */
export const VECTOR_SYNC_QUEUE = 'vector-sync';
