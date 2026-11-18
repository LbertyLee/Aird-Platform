import { DashboardService } from './dashboard.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { IRedisPort } from '../../infrastructure/redis/redis.service';

describe('DashboardService activity trends', () => {
  const query = {
    startDate: '2026-11-11',
    endDate: '2026-11-13',
    timezone: 'Asia/Shanghai',
  };

  function setup(initialRows: Record<string, unknown>[] = []) {
    const rows = [...initialRows];
    const prisma = {
      dashboardDailyStat: {
        findMany: jest.fn(async () => rows),
        upsert: jest.fn(async ({ create }) => {
          const index = rows.findIndex(
            (row) => String(row.statDate) === String(create.statDate),
          );
          if (index >= 0) rows[index] = create;
          else rows.push(create);
          return create;
        }),
      },
      user: { count: jest.fn().mockResolvedValue(11) },
      $queryRawUnsafe: jest.fn(async (sql: string) => {
        if (sql.includes('DISTINCT user_id')) {
          return [{ day: '2026-11-11', cnt: 1n }, { day: '2026-11-13', cnt: 2n }];
        }
        if (sql.includes('ResearchRun')) {
          return [{ day: '2026-11-11', cnt: 6n }, { day: '2026-11-13', cnt: 2n }];
        }
        return []; // Existing users search without any new registrations.
      }),
      $transaction: jest.fn(async (operations) => Promise.all(operations)),
    };
    const redis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      del: jest.fn(),
    };
    const service = new DashboardService(
      prisma as unknown as PrismaService,
      redis as unknown as IRedisPort,
    );
    return { service, prisma, redis };
  }

  it('returns active users independently of registrations, searches and total users', async () => {
    const { service, prisma, redis } = setup();
    const result = await service.getTrends(query);
    expect(result.points).toEqual([
      { date: '2026-11-11', userTotal: 11, newUserCount: 0, searchCount: 6, activeUserCount: 1 },
      { date: '2026-11-12', userTotal: 11, newUserCount: 0, searchCount: 0, activeUserCount: 0 },
      { date: '2026-11-13', userTotal: 11, newUserCount: 0, searchCount: 2, activeUserCount: 2 },
    ]);
    const activityCall = prisma.$queryRawUnsafe.mock.calls.find(([sql]) => sql.includes('DISTINCT user_id'));
    expect(activityCall).toEqual([
      expect.stringContaining('user_id IS NOT NULL'),
      new Date('2026-11-10T16:00:00Z'),
      new Date('2026-11-13T16:00:00Z'),
      'Asia/Shanghai',
    ]);
    expect(redis.set).toHaveBeenCalledWith(
      'dashboard:trends:v2:Asia/Shanghai:2026-11-11:2026-11-13',
      JSON.stringify(result),
      60,
    );
  });

  it('rebuilds recent legacy snapshots without active user counts', async () => {
    const initialRows = ['11', '12', '13'].map((day) => ({
      statDate: new Date(`2026-11-${day}`),
      userTotal: 11,
      searchCount: 0,
      metrics: { newUserCount: 0, aggregatedAt: new Date().toISOString() },
    }));
    const { service, prisma } = setup(initialRows);
    const result = await service.getTrends(query);
    expect(prisma.dashboardDailyStat.upsert).toHaveBeenCalledTimes(3);
    expect(result.points[0].activeUserCount).toBe(1);
  });

  it('reuses fresh snapshots with active user counts, including zero', async () => {
    const initialRows = ['11', '12', '13'].map((day) => ({
      statDate: new Date(`2026-11-${day}`),
      userTotal: 11,
      searchCount: 0,
      metrics: { newUserCount: 0, activeUserCount: 0, aggregatedAt: new Date().toISOString() },
    }));
    const { service, prisma } = setup(initialRows);
    const result = await service.getTrends(query);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(result.points.map((point) => point.activeUserCount)).toEqual([0, 0, 0]);
  });

  it('invalidates the new trend cache when explicitly refreshed', async () => {
    const { service, redis } = setup();
    await service.refreshAggregate(query);
    expect(redis.del).toHaveBeenCalledWith('dashboard:trends:v2:Asia/Shanghai:2026-11-11:2026-11-13');
  });
});
