import { WorkJobsService } from './work-jobs.service';
import type { WorkJobData } from './work-job.types';

jest.mock('../../infrastructure/milvus/milvus.service', () => ({
  MilvusService: class {},
  COL_KNOWLEDGE_CHUNKS: 'knowledge_chunks',
}));
jest.mock('../analysis/analysis-session.service', () => ({
  AnalysisSessionService: class {},
}));
jest.mock('../../research/research.service', () => ({
  ResearchService: class {},
}));

function fixture(queued = true) {
  const storage = new Map<string, string>();
  const jobs = Object.create(WorkJobsService.prototype) as WorkJobsService;
  const queue = { add: jest.fn().mockResolvedValue({}) };
  const analysis = {
    create: jest.fn().mockResolvedValue({ id: 'session', observations: [1] }),
  };
  const research = {
    generateReport: jest.fn().mockResolvedValue({ title: '报告' }),
  };
  Object.assign(jobs, {
    queue: queued ? queue : undefined,
    analysis,
    research,
    logger: { error: jest.fn() },
    redis: {
      get: async (key: string) => storage.get(key) ?? null,
      set: async (key: string, value: string) => {
        storage.set(key, value);
      },
      setIfAbsent: async (key: string, value: string) => {
        if (storage.has(key)) return false;
        storage.set(key, value);
        return true;
      },
    },
  });
  return { jobs, queue, analysis, research };
}
const work = {
  kind: 'analysis' as const,
  input: { runId: 'run', query: '中文问题', sourceIds: ['source'] },
};

describe('resumable analysis and report jobs', () => {
  it('returns before computation and deduplicates simultaneous submissions', async () => {
    const { jobs, queue, analysis } = fixture();
    const [a, b] = await Promise.all([
      jobs.start('owner', work, 'request'),
      jobs.start('owner', work, 'request'),
    ]);
    expect(a.jobId).toBe(b.jobId);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(analysis.create).not.toHaveBeenCalled();
    const data = queue.add.mock.calls[0][1] as WorkJobData;
    await jobs.execute(data);
    expect(await jobs.get('owner', a.jobId)).toMatchObject({
      status: 'completed',
      result: { id: 'session' },
    });
    expect(await jobs.get('owner', a.jobId)).not.toHaveProperty('userId');
    await expect(jobs.get('other', a.jobId)).rejects.toMatchObject({
      status: 404,
    });
    await jobs.execute(data);
    await jobs.start('owner', work, 'request');
    expect(analysis.create).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('persists model failures as terminal states', async () => {
    const { jobs, queue, research } = fixture();
    research.generateReport.mockRejectedValueOnce(new Error('模型调用失败'));
    const { jobId } = await jobs.start('owner', {
      kind: 'report',
      input: { query: '中文问题', sourceIds: ['source'] },
    });
    await jobs.execute(queue.add.mock.calls[0][1] as WorkJobData);
    expect(await jobs.get('owner', jobId)).toMatchObject({
      status: 'failed',
      error: '模型调用失败',
    });
  });

  it('does not leave queue submission failures running forever', async () => {
    const { jobs, queue } = fixture();
    queue.add.mockRejectedValueOnce(new Error('offline'));
    const { jobId } = await jobs.start('owner', work);
    expect(await jobs.get('owner', jobId)).toMatchObject({ status: 'failed' });
  });

  it('finishes in the background when queues are disabled', async () => {
    const { jobs, analysis } = fixture(false);
    let finish!: (value: unknown) => void;
    analysis.create.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { jobId } = await jobs.start('owner', work);
    expect(await jobs.get('owner', jobId)).toMatchObject({ status: 'running' });
    finish({ id: 'saved' });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await jobs.get('owner', jobId)).toMatchObject({
      status: 'completed',
      result: { id: 'saved' },
    });
  });
});
