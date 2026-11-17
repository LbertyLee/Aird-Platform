import { KnowledgeLibraryService } from './knowledge-library.service';
import { UserKnowledgeController } from '../../research/user-knowledge.controller';

jest.mock('../../research/research.service', () => ({ ResearchService: class {} }));
jest.mock('./knowledge-item.service', () => ({ KnowledgeItemService: class {} }));
jest.mock('../ai-query/rag-query.service', () => ({ RagQueryService: class {} }));
jest.mock('../../infrastructure/ai/embedding.service', () => ({ EmbeddingService: class {} }));

describe('用户知识库文档分组', () => {
  const defaults = [
    { code: 'default', name: '默认分组' },
    { code: 'macro', name: '宏观研究' },
  ];
  let overrides: { libraryId: string; code: string; name: string; deletedAt: Date | null }[];
  let service: KnowledgeLibraryService;
  let prisma: any;

  beforeEach(() => {
    overrides = [];
    prisma = {
      dictionaryItem: { findMany: jest.fn(async () => defaults) },
      knowledgeLibrary: { findFirst: jest.fn(async () => ({ id: 'lib-a', createdBy: 'owner', deletedAt: null })) },
      knowledgeDocumentGroup: {
        findMany: jest.fn(async ({ where }) => overrides.filter((row) => row.libraryId === where.libraryId)),
        upsert: jest.fn(async ({ where, create, update }) => {
          let row = overrides.find((entry) => entry.libraryId === where.libraryId_code.libraryId && entry.code === where.libraryId_code.code);
          if (row) Object.assign(row, update);
          else { row = { deletedAt: null, ...create }; overrides.push(row!); }
          return row;
        }),
      },
      knowledgeItem: { updateMany: jest.fn(async () => ({ count: 2 })) },
      $queryRaw: jest.fn(async () => [{ id: 'lib-a' }]),
    };
    prisma.$transaction = jest.fn(async (callback) => callback(prisma));
    service = new KnowledgeLibraryService(prisma, { write: jest.fn() } as never);
  });

  it('创建并持久化独立分组，其他知识库不可见', async () => {
    const group = await service.saveDocumentGroup('lib-a', 'owner', '  季度报告  ');
    expect(group).toEqual({ code: expect.stringMatching(/^custom-/), name: '季度报告' });
    expect(await service.listGroupsForUser('lib-a')).toContainEqual(group);
    expect(await service.listGroupsForUser('lib-b')).toEqual(defaults);
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });

  it('重命名系统预设只覆盖当前库，保留分组编码和文档归属', async () => {
    await service.saveDocumentGroup('lib-a', 'owner', '经济研究', 'macro');
    expect(await service.listGroupsForUser('lib-a')).toContainEqual({ code: 'macro', name: '经济研究' });
    expect(await service.listGroupsForUser('lib-b')).toEqual(defaults);
    expect(prisma.knowledgeItem.updateMany).not.toHaveBeenCalled();
  });

  it('删除预设分组持久隐藏，并仅将该库文档移到未分组', async () => {
    expect(await service.deleteDocumentGroup('lib-a', 'owner', 'macro')).toEqual({ movedCount: 2 });
    expect(prisma.knowledgeItem.updateMany).toHaveBeenCalledWith({
      where: { libraryId: 'lib-a', groupCode: 'macro' }, data: { groupCode: null },
    });
    expect(await service.listGroupsForUser('lib-a')).toEqual([defaults[0]]);
    expect(await service.listGroupsForUser('lib-b')).toEqual(defaults);
    await expect(service.assertDocumentGroup('macro', 'lib-a')).rejects.toMatchObject({ code: 'KNOWLEDGE_GROUP_INVALID' });
  });

  it('拒绝使用其他库的自定义分组', async () => {
    const group = await service.saveDocumentGroup('lib-a', 'owner', '仅当前库');
    await expect(service.assertDocumentGroup(group.code, 'lib-a')).resolves.toBeUndefined();
    await expect(service.assertDocumentGroup(group.code, 'lib-b')).rejects.toMatchObject({ code: 'KNOWLEDGE_GROUP_INVALID' });
  });

  it.each(['', '   ', 'x'.repeat(65), '全部文档', '未分组'])('拒绝非法名称 %p', async (name) => {
    await expect(service.saveDocumentGroup('lib-a', 'owner', name)).rejects.toMatchObject({ code: 'KNOWLEDGE_GROUP_NAME_INVALID' });
    expect(prisma.knowledgeDocumentGroup.upsert).not.toHaveBeenCalled();
  });

  it('阻止同名分组（含首尾空格与大小写差异）', async () => {
    await expect(service.saveDocumentGroup('lib-a', 'owner', ' 宏观研究 ')).rejects.toMatchObject({ code: 'KNOWLEDGE_GROUP_NAME_EXISTS' });
    await service.saveDocumentGroup('lib-a', 'owner', 'Reports');
    await expect(service.saveDocumentGroup('lib-a', 'owner', 'reports')).rejects.toMatchObject({ code: 'KNOWLEDGE_GROUP_NAME_EXISTS' });
  });

  it('其他用户无法增删改知识库分组', async () => {
    for (const action of [
      () => service.saveDocumentGroup('lib-a', 'other-user', '新分组'),
      () => service.saveDocumentGroup('lib-a', 'other-user', '新名称', 'macro'),
      () => service.deleteDocumentGroup('lib-a', 'other-user', 'macro'),
    ]) await expect(action()).rejects.toMatchObject({ code: 'KNOWLEDGE_LIBRARY_FORBIDDEN' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('不能重命名或再次删除已删除分组', async () => {
    await service.deleteDocumentGroup('lib-a', 'owner', 'macro');
    await expect(service.saveDocumentGroup('lib-a', 'owner', '重新命名', 'macro')).rejects.toMatchObject({ code: 'KNOWLEDGE_GROUP_INVALID' });
    await expect(service.deleteDocumentGroup('lib-a', 'owner', 'macro')).rejects.toMatchObject({ code: 'KNOWLEDGE_GROUP_INVALID' });
  });

  it('查询带知识库范围时先验证用户可访问性', async () => {
    const controller = new UserKnowledgeController({} as never, {} as never, service, {} as never, {} as never);
    const access = jest.spyOn(service, 'assertUserCanDeposit').mockRejectedValue(new Error('forbidden'));
    await expect(controller.listGroups('lib-a', { userId: 'other' } as never)).rejects.toThrow('forbidden');
    expect(access).toHaveBeenCalledWith('lib-a', 'other');
    expect(prisma.dictionaryItem.findMany).not.toHaveBeenCalled();
  });
});
