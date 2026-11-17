import { IngestionService } from './ingestion.service';

describe('learning admission and deduplication', () => {
  let prisma: any;
  let producer: any;
  let membership: any;
  let service: IngestionService;
  const input = { knowledgeItemId: 'k', fileKey: 'file', fileSize: 4, buffer: Buffer.from('test'), actorId: 'admin' };
  beforeEach(() => {
    prisma = {
      knowledgeVersion: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'v' }), update: jest.fn() },
      ingestionJob: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 'j' }), update: jest.fn() },
      knowledgeItem: { findUniqueOrThrow: jest.fn().mockResolvedValue({ sourceType: 'research_upload', submittedBy: 'owner' }) },
      $transaction: jest.fn(async (items) => Promise.all(items)),
    };
    producer = { enqueue: jest.fn() };
    membership = { assertCanLearnKnowledge: jest.fn() };
    service = new IngestionService(prisma, producer, {} as any, membership);
  });
  it('checks the owner balance before creating a job', async () => {
    membership.assertCanLearnKnowledge.mockRejectedValue(new Error('insufficient'));
    await expect(service.startKnowledgeIngestion(input)).rejects.toThrow('insufficient');
    expect(membership.assertCanLearnKnowledge).toHaveBeenCalledWith('owner');
    expect(prisma.ingestionJob.create).not.toHaveBeenCalled();
  });
  it('reuses an active job without a second balance check', async () => {
    prisma.ingestionJob.findFirst.mockResolvedValue({ id: 'active', knowledgeVersionId: 'v' });
    expect(await service.startKnowledgeIngestion(input)).toMatchObject({ jobId: 'active', deduplicated: true });
    expect(membership.assertCanLearnKnowledge).not.toHaveBeenCalled();
    expect(producer.enqueue).not.toHaveBeenCalled();
  });
  it('marks an enqueue failure as failed so that it can be retried', async () => {
    producer.enqueue.mockRejectedValue(new Error('redis down'));
    await expect(service.startKnowledgeIngestion(input)).rejects.toThrow('redis down');
    expect(prisma.ingestionJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }));
    expect(prisma.knowledgeVersion.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }));
  });
});
