import { SearchOrchestratorService } from './search-orchestrator.service';
import { SearchOrchestratorController } from './search-orchestrator.controller';
import type { Response } from 'express';
import type { AuthUserContext } from '../../common/types/auth-user.context';

jest.mock('../../infrastructure/milvus/milvus.service', () => ({
  MilvusService: class {},
  COL_KNOWLEDGE_CHUNKS: 'knowledge_chunks',
}));
jest.mock('../ai-query/ai-query.service', () => ({ AiQueryService: class {} }));
jest.mock('../external-search/external-search.service', () => ({
  ExternalSearchService: class {},
}));
jest.mock('../data-analysis/data-analysis.service', () => ({
  DataAnalysisService: class {},
}));

function serviceFixture() {
  const storage = new Map<string, string>();
  const service = Object.create(
    SearchOrchestratorService.prototype,
  ) as SearchOrchestratorService;
  const queue = { add: jest.fn().mockResolvedValue({}) };
  const membership = { assertCanSearch: jest.fn().mockResolvedValue({}) };
  Object.assign(service, {
    membership,
    searchQueue: queue,
    searchJobTtlSeconds: 7200,
    redis: {
      get: async (key: string) => storage.get(key) ?? null,
      setIfAbsent: async (key: string, value: string) => {
        if (storage.has(key)) return false;
        storage.set(key, value);
        return true;
      },
      set: async (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
  return { service, storage, queue, membership };
}

describe('asynchronous search jobs', () => {
  it('reuses a submission after a lost response without duplicate execution or billing checks', async () => {
    const { service, queue, membership } = serviceFixture();
    const first = await service.startSearchJob(
      'owner',
      '中文问题',
      undefined,
      'mixed',
      'request',
    );
    const second = await service.startSearchJob(
      'owner',
      '中文问题',
      undefined,
      'mixed',
      'request',
    );
    expect(second.jobId).toBe(first.jobId);
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(membership.assertCanSearch).toHaveBeenCalledTimes(1);
    const fresh = await service.startSearchJob(
      'owner',
      '中文问题',
      undefined,
      'mixed',
      'new-request',
    );
    expect(fresh.jobId).not.toBe(first.jobId);
  });
  it('persists and queues a job without executing search in the request', async () => {
    const { service, queue } = serviceFixture();
    const execute = jest.spyOn(service, 'runSearchJobBackground');
    const job = await service.startSearchJob('owner', '中文问题');
    expect(queue.add).toHaveBeenCalledWith(
      'search',
      expect.objectContaining({ jobId: job.jobId, userId: 'owner' }),
      expect.objectContaining({ jobId: job.jobId, attempts: 1 }),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(await service.getSearchJob('owner', job.jobId)).toMatchObject({
      status: 'running',
      query: '中文问题',
    });
    expect(await service.getSearchJob('owner', job.jobId)).not.toHaveProperty(
      'userId',
    );
    await expect(
      service.getSearchJob('someone-else', job.jobId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('reports queue submission failures instead of returning a running job', async () => {
    const { service, queue, storage } = serviceFixture();
    queue.add.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(
      service.startSearchJob('owner', '中文问题'),
    ).rejects.toMatchObject({ status: 503 });
    expect(JSON.parse([...storage.values()][0]).status).toBe('failed');
  });

  it('checks ownership before writing SSE response headers', async () => {
    const { service } = serviceFixture();
    const controller = new SearchOrchestratorController(service);
    const response = { setHeader: jest.fn(), flushHeaders: jest.fn() };
    await expect(
      controller.events(
        { userId: 'other' } as AuthUserContext,
        'missing',
        response as unknown as Response,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.flushHeaders).not.toHaveBeenCalled();
  });
});
