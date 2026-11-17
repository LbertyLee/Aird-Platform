jest.mock('../../infrastructure/milvus/milvus.service', () => ({
  MilvusService: class {}, COL_KNOWLEDGE_CHUNKS: 'knowledge_chunks',
}));
import { LlmUsageMeterService } from '../../infrastructure/ai/llm-usage-meter.service';
import { IngestionProcessor } from './ingestion.processor';

describe('ingestion billing lifecycle', () => {
  let processor: IngestionProcessor;
  let prisma: any;
  let membership: any;
  let run: jest.SpyInstance;
  let meter: LlmUsageMeterService;
  const job = (attemptsMade = 0) => ({
    data: { jobId: 'j', targetType: 'knowledge', targetId: 'k', versionId: 'v' },
    opts: { attempts: 3 }, attemptsMade,
  }) as any;
  beforeEach(() => {
    prisma = {
      ingestionJob: { findUniqueOrThrow: jest.fn().mockResolvedValue({ status: 'pending' }), update: jest.fn() },
      knowledgeItem: { findUniqueOrThrow: jest.fn().mockResolvedValue({ sourceType: 'research_upload', submittedBy: 'owner' }), update: jest.fn() },
      knowledgeVersion: { update: jest.fn() },
    };
    membership = { consumeKnowledgeLearningPoints: jest.fn(), assertCanLearnKnowledge: jest.fn() };
    meter = new LlmUsageMeterService();
    processor = new IngestionProcessor(prisma, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, membership, meter);
    jest.spyOn(processor as any, 'completeKnowledge').mockResolvedValue(undefined);
    run = jest.spyOn(processor as any, 'processKnowledge').mockImplementation(async () => { meter.record({ model: 'embedding-model', promptTokens: 321, completionTokens: 0 }); });
  });
  it('charges the uploader actual token usage after learning and marks success', async () => {
    await processor.process(job());
    expect(membership.consumeKnowledgeLearningPoints).toHaveBeenCalledWith('owner', expect.stringContaining('j:'), [{ model: 'embedding-model', promptTokens: 321, completionTokens: 0 }]);
    expect(membership.consumeKnowledgeLearningPoints.mock.invocationCallOrder[0]).toBeGreaterThan(run.mock.invocationCallOrder[0]);
    expect(prisma.ingestionJob.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'succeeded' }) }));
  });
  it('settles actual use even when processing fails and retries', async () => {
    run.mockRejectedValue(new Error('parse failed'));
    await expect(processor.process(job())).rejects.toThrow('parse failed');
    expect(prisma.ingestionJob.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'pending' }) }));
  });
  it('marks a final processing failure without inventing token charges', async () => {
    run.mockRejectedValue(new Error('parse failed'));
    await expect(processor.process(job(2))).rejects.toThrow('parse failed');
    expect(membership.consumeKnowledgeLearningPoints).toHaveBeenCalledWith('owner', expect.any(String), []);
    expect(prisma.knowledgeVersion.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }));
  });
  it('does not parse if admission is rejected', async () => {
    membership.assertCanLearnKnowledge.mockRejectedValue(new Error('insufficient'));
    await expect(processor.process(job())).rejects.toThrow('insufficient');
    expect(run).not.toHaveBeenCalled();
  });
  it('does not charge a completed task again', async () => {
    prisma.ingestionJob.findUniqueOrThrow.mockResolvedValue({ status: 'succeeded' });
    await processor.process(job());
    expect(run).not.toHaveBeenCalled();
    expect(membership.consumeKnowledgeLearningPoints).not.toHaveBeenCalled();
  });
  it('does not charge the uploader for admin source documents', async () => {
    prisma.knowledgeItem.findUniqueOrThrow.mockResolvedValue({ sourceType: 'admin_upload', submittedBy: 'admin' });
    await processor.process(job());
    expect(membership.consumeKnowledgeLearningPoints).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalled();
  });
  it('recovers pending billing without repeating successfully completed learning', async () => {
    const state = { reference: 'j:original', payerId: 'owner', usage: [{ model: 'embedding-model', promptTokens: 500, completionTokens: 0 }], operationSucceeded: true };
    prisma.ingestionJob.findUniqueOrThrow.mockResolvedValue({ status: 'failed', billingState: state });
    await processor.process(job());
    expect(run).not.toHaveBeenCalled();
    expect(membership.consumeKnowledgeLearningPoints).toHaveBeenCalledWith('owner', 'j:original', state.usage);
  });
  it('persists usage before a rejected settlement', async () => {
    membership.consumeKnowledgeLearningPoints.mockRejectedValue(new Error('insufficient'));
    await expect(processor.process(job())).rejects.toThrow('insufficient');
    expect(prisma.ingestionJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ billingState: expect.objectContaining({ operationSucceeded: true, usage: [{ model: 'embedding-model', promptTokens: 321, completionTokens: 0 }] }) }) }));
  });

});
