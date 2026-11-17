import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { ResearchSearchJobSnapshot } from '@agent/contracts';
import { streamSearchJob } from './search-job-stream';

const initial: ResearchSearchJobSnapshot = {
  jobId: 'job', status: 'running', query: '问题', createdAt: 'now', updatedAt: 'now',
};
function response() {
  return Object.assign(new EventEmitter(), {
    status: jest.fn(), setHeader: jest.fn(), flushHeaders: jest.fn(),
    write: jest.fn().mockReturnValue(true), end: jest.fn(),
  });
}
describe('search SSE snapshots', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('sends the initial snapshot and closes immediately for a terminal job', () => {
    const res = response();
    const load = jest.fn();
    streamSearchJob(res as unknown as Response, { ...initial, status: 'failed' }, load);
    expect(res.write).toHaveBeenCalledWith(expect.stringContaining('event: snapshot'));
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });

  it('deduplicates snapshots, sends heartbeat and closes on completion', async () => {
    const res = response();
    const load = jest.fn().mockResolvedValue(initial);
    streamSearchJob(res as unknown as Response, initial, load);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(res.write.mock.calls.filter(([data]) => data.startsWith('event:'))).toHaveLength(1);
    expect(res.write).toHaveBeenCalledWith(': heartbeat\n\n');
    load.mockResolvedValue({ ...initial, status: 'completed' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('stops reading storage after client disconnect', async () => {
    const res = response();
    const load = jest.fn().mockResolvedValue(initial);
    streamSearchJob(res as unknown as Response, initial, load);
    res.emit('close');
    await jest.advanceTimersByTimeAsync(100_000);
    expect(load).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('ends slow consumer subscriptions without accumulating frames', () => {
    const res = response();
    res.write.mockReturnValue(false);
    streamSearchJob(res as unknown as Response, initial, jest.fn());
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
