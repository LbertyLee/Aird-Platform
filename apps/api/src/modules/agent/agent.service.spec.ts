import { CommonStatus } from '@prisma/client';
import { AgentService } from './agent.service';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { EntitlementResolver } from '../membership/entitlement.resolver';

describe('AgentService', () => {
  const agentFindMany = jest.fn();
  const agentFindFirst = jest.fn();
  const agentFindUnique = jest.fn();
  const agentCreate = jest.fn();
  const agentCount = jest.fn();
  const categoryFindMany = jest.fn();
  const categoryFindFirst = jest.fn();
  const userFindFirst = jest.fn();
  const resolveForUser = jest.fn();
  const service = new AgentService(
    {
      agent: {
        findMany: agentFindMany,
        findFirst: agentFindFirst,
        findUnique: agentFindUnique,
        create: agentCreate,
        count: agentCount,
      },
      dictionaryItem: {
        findMany: categoryFindMany,
        findFirst: categoryFindFirst,
      },
      user: { findFirst: userFindFirst },
    } as unknown as PrismaService,
    { resolveForUser } as unknown as EntitlementResolver,
  );

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns platform agents only for anonymous users', async () => {
    agentFindMany.mockResolvedValue([]);

    await service.listForUser();

    expect(agentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: CommonStatus.active,
          AND: [{ OR: [{ ownerId: null }] }],
        }),
      }),
    );
  });

  it('returns platform agents and only the requesting user personal agents', async () => {
    agentFindMany.mockResolvedValue([]);

    await service.listForUser('user-a');

    expect(agentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: [{ OR: [{ ownerId: null }, { ownerId: 'user-a' }] }],
        }),
      }),
    );
  });

  it('assigns the current user as owner when creating a personal agent', async () => {
    categoryFindFirst.mockResolvedValue({ id: 'category-learning' });
    userFindFirst.mockResolvedValue({
      username: 'user-a',
      profile: { displayName: '用户 A' },
    });
    agentCount.mockResolvedValue(0);
    resolveForUser.mockResolvedValue({ values: { max_agents: { n: 1 } } });
    agentCreate.mockResolvedValue({
      id: 'agent-a',
      name: '我的智能体',
      description: '用于测试',
      categoryCode: 'learning',
      author: '用户 A',
      ownerId: 'user-a',
      icon: null,
      iconColor: null,
      usageCount: 0,
      status: CommonStatus.active,
      sort: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    categoryFindMany.mockResolvedValue([
      { code: 'learning', name: '学习' },
    ]);

    await service.createForUser(
      {
        name: ' 我的智能体 ',
        description: ' 用于测试 ',
        categoryCode: 'learning',
      },
      'user-a',
    );

    expect(agentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'user-a',
          author: '用户 A',
          status: CommonStatus.active,
          categoryCode: 'learning',
        }),
      }),
    );
  });

  it('rejects a disabled or missing category', async () => {
    categoryFindFirst.mockResolvedValue(null);

    await expect(
      service.createForUser(
        {
          name: '我的智能体',
          description: '用于测试',
          categoryCode: 'disabled-category',
        },
        'user-a',
      ),
    ).rejects.toThrow('智能体分类不存在或已停用');
  });

  it('rejects an empty category when an admin updates an agent', async () => {
    agentFindUnique.mockResolvedValue({ id: 'agent-a' });
    categoryFindFirst.mockResolvedValue(null);

    await expect(
      service.updatePlatform('agent-a', { categoryCode: '' }),
    ).rejects.toThrow('智能体分类不存在或已停用');
  });
});
