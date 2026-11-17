import { KnowledgeAuditStatus, KnowledgeVisibility } from '@prisma/client';
import { KnowledgeItemService } from './knowledge-item.service';

describe('公开知识自动审核', () => {
  it('恢复历史待审核文件，只有成功取得状态变更的实例启动学习', async () => {
    const prisma: any = {
      knowledgeItem: {
        findMany: jest.fn().mockResolvedValueOnce([{ id: 'a', submittedBy: 'user' }, { id: 'b', submittedBy: 'user' }]).mockResolvedValueOnce([]),
        updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }),
      },
      knowledgeAuditRecord: { create: jest.fn() },
    };
    prisma.$transaction = jest.fn(async (fn) => fn(prisma));
    const service = new KnowledgeItemService(prisma, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const publish = jest.spyOn(service as any, 'publishAndIngest').mockResolvedValue(undefined);
    await (service as any).recoverPendingPublicItems();
    expect(prisma.knowledgeItem.findMany.mock.calls[0][0].where).toMatchObject({
      auditStatus: KnowledgeAuditStatus.pending,
      OR: [{ library: { visibility: KnowledgeVisibility.public, deletedAt: null } }, { libraryId: null, visibility: KnowledgeVisibility.public }],
    });
    expect(prisma.knowledgeAuditRecord.create).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith('a', 'user');
  });
});
