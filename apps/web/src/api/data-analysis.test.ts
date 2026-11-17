// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { http } from './http';
import { SearchJobEventDecoder } from './search-job-events';
import {
  SearchClientTimeoutError,
  searchDataAnalysisAsync,
  waitForSearchJob,
} from './data-analysis';

vi.mock('./http', () => ({ http: { get: vi.fn(), post: vi.fn() } }));
const snapshot = {
  jobId: 'job',
  status: 'running',
  query: '中文问题',
  createdAt: 'now',
  updatedAt: 'now',
};
const result = {
  runId: 'run',
  query: '中文问题',
  answer: '结果',
  mode: 'mixed',
  matchedLocally: false,
  usedExa: true,
  exaConfigured: true,
  cacheHit: false,
  cachedAt: null,
  plan: {
    countries: [],
    regions: [],
    entities: [],
    indicators: [],
    timeRanges: [],
    sources: [],
    intent: 'lookup',
    confidence: 1,
    explanation: '',
  },
  sources: [],
  stages: [],
};
function streamResponse(text: string) {
  const bytes = new TextEncoder().encode(text);
  return {
    headers: { 'content-type': 'text/event-stream' },
    data: new ReadableStream({
      start(controller) {
        // Split every byte, including inside Chinese UTF-8 sequences.
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    }),
  };
}

afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});
describe('search event decoding', () => {
  it('handles split CRLF, comments, multiline data and multiple snapshots', () => {
    const decoder = new SearchJobEventDecoder();
    const text = `: heartbeat\r\nevent: snapshot\r\ndata: ${JSON.stringify(snapshot)}\r\n\r\n`;
    expect([...text].flatMap((char) => decoder.push(char))).toEqual([snapshot]);
    expect(
      decoder.push(
        `event: snapshot\ndata: {\ndata: ${JSON.stringify(snapshot).slice(1)}\n\n`,
      ),
    ).toEqual([snapshot]);
  });
});
describe('SSE with polling fallback', () => {
  it('retries transient polling failures against the same job', async () => {
    vi.useFakeTimers();
    vi.mocked(http.get)
      .mockRejectedValueOnce(new Error('SSE disconnected'))
      .mockRejectedValueOnce({ response: { status: 504 } })
      .mockRejectedValueOnce({ code: 'ERR_NETWORK' })
      .mockResolvedValueOnce({
        data: { ...snapshot, status: 'completed', result },
      });
    const waiting = waitForSearchJob('job');
    await vi.advanceTimersByTimeAsync(6000);
    await expect(waiting).resolves.toEqual(result);
    expect(http.get).toHaveBeenCalledTimes(4);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('keeps waiting beyond ten minutes while the backend is running', async () => {
    vi.useFakeTimers();
    vi.mocked(http.get)
      .mockRejectedValueOnce(new Error('SSE disconnected'))
      .mockResolvedValue({ data: snapshot });
    const controller = new AbortController();
    const waiting = waitForSearchJob('job', { signal: controller.signal });
    let settled = false;
    const assertion = expect(waiting).rejects.toMatchObject({
      name: 'AbortError',
    });
    void waiting.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(601_000);
    expect(settled).toBe(false);
    controller.abort();
    await assertion;
  });

  it('stops retrying immediately when waiting is cancelled', async () => {
    vi.useFakeTimers();
    vi.mocked(http.get)
      .mockRejectedValueOnce(new Error('SSE disconnected'))
      .mockRejectedValue({ response: { status: 503 } });
    const controller = new AbortController();
    const waiting = waitForSearchJob('job', { signal: controller.signal });
    const assertion = expect(waiting).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(http.get).toHaveBeenCalledTimes(2);
  });
  it('returns a completed streamed result without polling', async () => {
    vi.mocked(http.get).mockResolvedValueOnce(
      streamResponse(
        `event: snapshot\ndata: ${JSON.stringify({ ...snapshot, status: 'completed', result })}\n\n`,
      ),
    );
    await expect(waitForSearchJob('job')).resolves.toEqual(result);
    expect(http.get).toHaveBeenCalledTimes(1);
  });
  it('accepts a streamed failure without polling it again', async () => {
    vi.mocked(http.get).mockResolvedValueOnce(
      streamResponse(
        `event: snapshot\ndata: ${JSON.stringify({ ...snapshot, status: 'failed', error: '证据不足' })}\n\n`,
      ),
    );
    const progress = vi.fn();
    await expect(
      waitForSearchJob('job', { onSnapshot: progress }),
    ).rejects.toThrow('证据不足');
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({ query: '中文问题' }),
    );
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('creates once and polls the same job after a transport failure', async () => {
    vi.mocked(http.post).mockResolvedValueOnce({
      data: { jobId: 'job', status: 'running' },
    });
    vi.mocked(http.get)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        data: { ...snapshot, status: 'completed', result },
      });
    await expect(searchDataAnalysisAsync('中文问题')).resolves.toEqual(result);
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenLastCalledWith(
      '/search/jobs/job',
      expect.anything(),
    );
  });

  it('falls back when the stream ends before a terminal snapshot', async () => {
    vi.mocked(http.get)
      .mockResolvedValueOnce(
        streamResponse(
          `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`,
        ),
      )
      .mockResolvedValueOnce({
        data: { ...snapshot, status: 'completed', result },
      });
    await expect(waitForSearchJob('job')).resolves.toEqual(result);
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('does not fall back on a missing or unauthorized job', async () => {
    vi.mocked(http.get).mockRejectedValueOnce({ response: { status: 404 } });
    await expect(waitForSearchJob('job')).rejects.toEqual({
      response: { status: 404 },
    });
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('cancels waiting immediately when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      waitForSearchJob('job', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(http.get).not.toHaveBeenCalled();
  });

  it('applies a total deadline to a stalled stream', async () => {
    vi.useFakeTimers();
    vi.mocked(http.get).mockImplementation(
      (_url, config) =>
        new Promise((_resolve, reject) => {
          config?.signal?.addEventListener?.('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    );
    const waiting = waitForSearchJob('job', { maxWaitMs: 100 });
    const assertion = expect(waiting).rejects.toBeInstanceOf(
      SearchClientTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('falls back after the stream idle deadline', async () => {
    vi.useFakeTimers();
    vi.mocked(http.get)
      .mockImplementationOnce(
        (_url, config) =>
          new Promise((_resolve, reject) => {
            config?.signal?.addEventListener?.('abort', () =>
              reject(new Error('idle timeout')),
            );
          }),
      )
      .mockResolvedValueOnce({
        data: { ...snapshot, status: 'completed', result },
      });
    const waiting = waitForSearchJob('job', { maxWaitMs: 60_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(waiting).resolves.toEqual(result);
    expect(http.get).toHaveBeenCalledTimes(2);
  });
});
