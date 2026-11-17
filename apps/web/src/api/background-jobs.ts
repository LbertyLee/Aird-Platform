import { http } from './http';

const TASK_TTL_MS = 2 * 60 * 60 * 1000;
type PendingTask = { requestId: string; jobId?: string; createdAt: number };
const pending = new Map<string, PendingTask>();

export class BackgroundJobFailedError extends Error {}

/** Keep task references isolated across accounts, including after a reload. */
export function taskStorageKey(key: string) {
  let owner = 'anonymous';
  try {
    owner =
      JSON.parse(localStorage.getItem('aird-user-session') || 'null')?.profile
        ?.id || owner;
  } catch {
    /* Storage may be disabled. In-memory recovery still works. */
  }
  return `research:task:${owner}:${key}`;
}

function stableInput(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableInput);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, stableInput(item)]),
    );
  }
  return value;
}

function newRequestId() {
  // getRandomValues also works on HTTP deployments where randomUUID is unavailable.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function isTransientTaskError(error: unknown) {
  const e = error as { response?: { status?: number }; code?: string } | null;
  const status = e?.response?.status;
  if (status) return [408, 429, 500, 502, 503, 504].includes(status);
  return ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET'].includes(
    e?.code || '',
  );
}

export function taskSleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Only use for reads, or submissions protected by a server idempotency key. */
export async function retryTaskRequest<T>(
  request: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let failures = 0;
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    try {
      return await request();
    } catch (error) {
      if (signal?.aborted || !isTransientTaskError(error)) throw error;
      await taskSleep(
        Math.min(2000 * 2 ** Math.min(failures++, 3), 10_000),
        signal,
      );
    }
  }
}

/** Save before submitting so even a lost POST response can safely be retried. */
export async function resumeTask<T>(
  identity: unknown,
  create: (requestId: string) => Promise<{ jobId: string }>,
  wait: (jobId: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const key = taskStorageKey(JSON.stringify(stableInput(identity)));
  let record = pending.get(key);
  if (!record) {
    try {
      record = JSON.parse(sessionStorage.getItem(key) || 'null') || undefined;
    } catch {
      /* optional storage */
    }
  }
  if (
    !record?.requestId ||
    !Number.isFinite(record.createdAt) ||
    Date.now() - record.createdAt > TASK_TTL_MS
  ) {
    record = { requestId: newRequestId(), createdAt: Date.now() };
  }
  const task = record;
  const save = () => {
    pending.set(key, task);
    try {
      sessionStorage.setItem(key, JSON.stringify(task));
    } catch {
      /* optional storage */
    }
  };
  const clear = () => {
    // An older waiter must not remove the reference to a newer attempt.
    if (pending.get(key)?.requestId !== task.requestId) return;
    pending.delete(key);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* optional storage */
    }
  };
  save();
  try {
    if (!task.jobId) {
      const created = await retryTaskRequest(
        () => create(task.requestId),
        signal,
      );
      task.jobId = created.jobId;
      save();
    }
    const result = await wait(task.jobId);
    clear();
    return result;
  } catch (error) {
    const status = (error as { response?: { status?: number } })?.response
      ?.status;
    if (
      error instanceof BackgroundJobFailedError ||
      (status &&
        status >= 400 &&
        status < 500 &&
        status !== 408 &&
        status !== 429)
    )
      clear();
    throw error;
  }
}

export function runWorkJob<T>(
  kind: 'analysis' | 'report',
  input: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return resumeTask(
    { kind, input },
    async (requestId) =>
      (
        await http.post<{ jobId: string }>(`/work-jobs/${kind}`, input, {
          signal,
          timeout: 30_000,
          headers: { 'X-Request-Id': requestId },
        })
      ).data,
    async (jobId) => {
      while (true) {
        const { data } = await retryTaskRequest(
          () =>
            http.get<{
              jobId: string;
              status: 'running' | 'completed' | 'failed';
              result?: T;
              error?: string;
            }>(`/work-jobs/${encodeURIComponent(jobId)}`, {
              signal,
              timeout: 30_000,
            }),
          signal,
        );
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        if (data.status === 'failed')
          throw new BackgroundJobFailedError(
            data.error || '任务执行失败，请重试。',
          );
        if (data.status === 'completed') {
          if (data.result === undefined)
            throw new BackgroundJobFailedError(
              '任务已完成但未返回结果，请重试。',
            );
          return data.result;
        }
        await taskSleep(2000, signal);
      }
    },
    signal,
  );
}
