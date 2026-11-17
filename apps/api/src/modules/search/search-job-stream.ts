import type { Response } from 'express';
import type { ResearchSearchJobSnapshot } from '@agent/contracts';

/** Snapshots are replaceable: reconnecting clients only need the latest state. */
export function streamSearchJob(
  response: Response,
  initial: ResearchSearchJobSnapshot,
  load: () => Promise<ResearchSearchJobSnapshot>,
) {
  response.status(200);
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();

  let closed = false;
  let lastPayload = '';
  let heartbeatAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    closed = true;
    clearTimeout(timer);
    clearTimeout(lifetime);
    response.off('close', cleanup);
  };
  const finish = () => {
    cleanup();
    response.end();
  };
  // Bound each subscription; the client falls back to short HTTP requests.
  const lifetime = setTimeout(finish, 60_000);
  response.once('close', cleanup);

  const send = (snapshot: ResearchSearchJobSnapshot) => {
    if (closed) return false;
    const payload = JSON.stringify(snapshot);
    if (payload !== lastPayload) {
      lastPayload = payload;
      // Slow consumers should reconnect instead of growing a response buffer.
      if (!response.write(`event: snapshot\ndata: ${payload}\n\n`)) {
        finish();
        return false;
      }
    }
    if (snapshot.status !== 'running') {
      finish();
      return false;
    }
    return true;
  };
  const tick = async () => {
    try {
      if (!send(await load())) return;
      if (Date.now() - heartbeatAt >= 15_000) {
        heartbeatAt = Date.now();
        if (!response.write(': heartbeat\n\n')) return finish();
      }
      if (!closed) timer = setTimeout(() => void tick(), 1000);
    } catch {
      if (!closed) finish();
    }
  };
  if (send(initial)) timer = setTimeout(() => void tick(), 1000);
}
