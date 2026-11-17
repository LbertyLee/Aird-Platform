// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { http } from './http';
import { BackgroundJobFailedError, runWorkJob } from './background-jobs';
import { searchDataAnalysisAsync } from './data-analysis';

vi.mock('./http', () => ({ http: { get: vi.fn(), post: vi.fn() } }));
afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
});

describe('resumable background operations', () => {
  it('resumes analysis after cancellation without submitting another job', async () => {
    vi.useFakeTimers();
    const input = {
      runId: 'resume-analysis',
      query: '问题',
      sourceIds: ['one'],
    };
    vi.mocked(http.post).mockResolvedValueOnce({
      data: { jobId: 'analysis-job' },
    });
    vi.mocked(http.get).mockResolvedValueOnce({ data: { status: 'running' } });
    const controller = new AbortController();
    const waiting = runWorkJob('analysis', input, controller.signal);
    const assertion = expect(waiting).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    expect(sessionStorage.length).toBe(1);
    vi.mocked(http.get).mockResolvedValueOnce({
      data: { status: 'completed', result: { id: 'saved' } },
    });
    await expect(runWorkJob('analysis', input)).resolves.toEqual({
      id: 'saved',
    });
    expect(http.post).toHaveBeenCalledTimes(1);
    expect(http.get).toHaveBeenLastCalledWith(
      '/work-jobs/analysis-job',
      expect.anything(),
    );
    expect(sessionStorage.length).toBe(0);
  });

  it('retries a lost creation response with the same idempotency key', async () => {
    vi.useFakeTimers();
    vi.mocked(http.post)
      .mockRejectedValueOnce({ response: { status: 504 } })
      .mockResolvedValueOnce({ data: { jobId: 'report-job' } });
    vi.mocked(http.get)
      .mockRejectedValueOnce({ code: 'ECONNABORTED' })
      .mockResolvedValueOnce({
        data: { status: 'completed', result: { title: '报告' } },
      });
    const waiting = runWorkJob('report', {
      query: 'lost-response',
      sourceIds: ['one'],
    });
    await vi.advanceTimersByTimeAsync(4000);
    await expect(waiting).resolves.toEqual({ title: '报告' });
    const calls = vi.mocked(http.post).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][2]?.headers?.['X-Request-Id']).toBe(
      calls[1][2]?.headers?.['X-Request-Id'],
    );
  });

  it('restores a saved task reference after a page reload', async () => {
    // Seed persisted state without an in-memory entry, as after a reload.
    const input = { query: 'saved-report' };
    sessionStorage.setItem(
      'research:task:anonymous:{"input":{"query":"saved-report"},"kind":"report"}',
      JSON.stringify({
        requestId: 'saved-request',
        jobId: 'saved-job',
        createdAt: Date.now(),
      }),
    );
    vi.mocked(http.get).mockResolvedValueOnce({
      data: { status: 'completed', result: 'report' },
    });
    await expect(runWorkJob('report', input)).resolves.toBe('report');
    expect(http.post).not.toHaveBeenCalled();
    expect(http.get).toHaveBeenCalledWith(
      '/work-jobs/saved-job',
      expect.anything(),
    );
  });

  it('surfaces real failures and allows a fresh attempt', async () => {
    const input = { query: 'failed-report' };
    vi.mocked(http.post).mockResolvedValue({ data: { jobId: 'report-job' } });
    vi.mocked(http.get).mockResolvedValueOnce({
      data: { status: 'failed', error: '证据不足' },
    });
    await expect(runWorkJob('report', input)).rejects.toBeInstanceOf(
      BackgroundJobFailedError,
    );
    vi.mocked(http.get).mockResolvedValueOnce({
      data: { status: 'completed', result: 'done' },
    });
    await expect(runWorkJob('report', input)).resolves.toBe('done');
    const calls = vi.mocked(http.post).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][2]?.headers?.['X-Request-Id']).not.toBe(
      calls[1][2]?.headers?.['X-Request-Id'],
    );
  });

  it('reconnects search to the original job and treats a new user search separately', async () => {
    vi.useFakeTimers();
    vi.mocked(http.post)
      .mockResolvedValueOnce({ data: { jobId: 'search-job' } })
      .mockResolvedValueOnce({ data: { jobId: 'new-job' } });
    vi.mocked(http.get)
      .mockRejectedValueOnce(new Error('SSE offline'))
      .mockResolvedValueOnce({ data: { status: 'running' } });
    const controller = new AbortController();
    const waiting = searchDataAnalysisAsync(
      'resume-search',
      undefined,
      'mixed',
      controller.signal,
      undefined,
      undefined,
      1,
    );
    const assertion = expect(waiting).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    vi.mocked(http.get)
      .mockRejectedValueOnce(new Error('SSE offline'))
      .mockResolvedValueOnce({
        data: { status: 'completed', result: { runId: 'saved' } },
      });
    await expect(
      searchDataAnalysisAsync(
        'resume-search',
        undefined,
        'mixed',
        undefined,
        undefined,
        undefined,
        1,
      ),
    ).resolves.toEqual({ runId: 'saved' });
    expect(http.post).toHaveBeenCalledTimes(1);
    vi.mocked(http.get)
      .mockRejectedValueOnce(new Error('SSE offline'))
      .mockResolvedValueOnce({
        data: { status: 'completed', result: { runId: 'new' } },
      });
    await searchDataAnalysisAsync(
      'resume-search',
      undefined,
      'mixed',
      undefined,
      undefined,
      undefined,
      2,
    );
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it('does not retry ownership failures or submit when already cancelled', async () => {
    vi.mocked(http.post).mockResolvedValueOnce({
      data: { jobId: 'restricted' },
    });
    vi.mocked(http.get).mockRejectedValueOnce({ response: { status: 403 } });
    await expect(
      runWorkJob('analysis', { runId: 'restricted' }),
    ).rejects.toMatchObject({ response: { status: 403 } });
    expect(http.get).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort();
    await expect(
      runWorkJob('analysis', { runId: 'cancelled' }, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(http.post).toHaveBeenCalledTimes(1);
  });
});
