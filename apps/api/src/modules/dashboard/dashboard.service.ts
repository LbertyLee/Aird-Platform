import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  InvoiceStatus,
  OrderStatus,
  Prisma,
  SubscriptionStatus,
  UserStatus,
} from '@prisma/client';
import type {
  DashboardMetricDefinition,
  DashboardTrends,
  PlatformOverview,
} from '@agent/contracts';
import { REDIS_PORT } from '../../common/constants/injection-tokens';
import { IRedisPort } from '../../infrastructure/redis/redis.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  addDays,
  dateOnlyToPrismaDate,
  eachDateInclusive,
  isDateOnly,
  normalizeDashboardTimezone,
  prismaDateToDateOnly,
  zonedDayRangeUtc,
  zonedInclusiveRangeUtc,
  zonedToday,
} from './dashboard-timezone.util';
import { DashboardRangeQueryDto } from './dto/dashboard.dto';

/** 单次查询最大跨度（天），保护聚合性能 */
const MAX_RANGE_DAYS = 90;

/** 未接入指标：接口返回 null，前端空态占位 */
const METRIC_DATA_VOLUME_AVAILABLE = false;
const METRIC_AGENT_TASK_AVAILABLE = false;

/**
 * 异常告警项。
 */
export class DashboardAlert {
  @ApiProperty({
    enum: ['info', 'warning', 'error'],
    description: '告警级别',
  })
  level!: 'info' | 'warning' | 'error';

  @ApiProperty({ description: '告警编码' })
  code!: string;

  @ApiProperty({ description: '告警标题' })
  title!: string;

  @ApiProperty({ description: '告警说明' })
  message!: string;

  @ApiProperty({ description: '数量' })
  count!: number;
}

/**
 * 平台总览指标（Swagger）。
 */
export class PlatformOverviewDto {
  @ApiProperty({ nullable: true, type: Number, description: '用户量' })
  userTotal!: number | null;

  @ApiProperty({ nullable: true, type: Number, description: '检索量（区间合计）' })
  searchCount!: number | null;

  @ApiProperty({
    nullable: true,
    type: String,
    description: '数据量；未接入为 null',
  })
  dataVolume!: string | null;

  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Agent 任务量；未接入为 null',
  })
  agentTaskCount!: number | null;

  @ApiProperty({ description: '业务时区' })
  timezone!: string;

  @ApiProperty({ description: '筛选开始日' })
  startDate!: string;

  @ApiProperty({ description: '筛选结束日' })
  endDate!: string;

  @ApiProperty({ description: '统计基准日' })
  statDate!: string;

  @ApiProperty({ description: '生成时间' })
  generatedAt!: string;

  @ApiProperty({
    description: '指标可用性',
    type: 'object',
    additionalProperties: { type: 'boolean' },
  })
  available!: PlatformOverview['available'];

  @ApiProperty({
    type: 'array',
    items: { type: 'object' },
    description: '数据口径',
  })
  metricDefinitions!: DashboardMetricDefinition[];

  @ApiProperty({ type: [DashboardAlert], description: '异常告警列表' })
  alerts!: DashboardAlert[];

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: '扩展指标',
  })
  extraMetrics!: Record<string, unknown>;
}

/**
 * 日趋势点（Swagger）。
 */
export class DashboardTrendPointDto {
  @ApiProperty()
  date!: string;

  @ApiProperty({ nullable: true, type: Number })
  userTotal!: number | null;

  @ApiProperty({ nullable: true, type: Number })
  searchCount!: number | null;

  @ApiPropertyOptional({ nullable: true, type: Number })
  newUserCount!: number | null;
}

/**
 * 日趋势响应（Swagger）。
 */
export class DashboardTrendsDto {
  @ApiProperty()
  timezone!: string;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiProperty()
  generatedAt!: string;

  @ApiProperty({ type: [DashboardTrendPointDto] })
  points!: DashboardTrendPointDto[];

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  metricDefinitions!: DashboardMetricDefinition[];
}

/**
 * 聚合结果（Swagger）。
 */
export class DashboardAggregateResultDto {
  @ApiProperty()
  timezone!: string;

  @ApiProperty()
  startDate!: string;

  @ApiProperty()
  endDate!: string;

  @ApiProperty()
  upsertedDays!: number;
}

type SqlRelation = {
  table: string;
  column: string;
  extraWhere: string;
};

/**
 * 运营看板门面：时间筛选、口径说明、日聚合与趋势、短缓存。
 */
@Injectable()
export class DashboardService {
  private readonly cacheTtlSec = 60;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_PORT) private readonly redis: IRedisPort,
  ) {}

  /**
   * 平台总览：区间汇总 + 告警；未接入指标返回 null。
   */
  async getPlatformOverview(
    query: DashboardRangeQueryDto = {},
  ): Promise<PlatformOverview> {
    const range = this.resolveRange(query);
    const cacheKey = `dashboard:overview:v3:${range.timezone}:${range.startDate}:${range.endDate}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as PlatformOverview;
    }

    await this.aggregateRange(range.startDate, range.endDate, range.timezone);

    const [
      userTotal,
      searchCount,
      disabledUsers,
      pendingOrders,
      expiringUserSubs,
      pendingInvoices,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.countSearches(range.startDate, range.endDate, range.timezone),
      this.prisma.user.count({
        where: { deletedAt: null, status: UserStatus.disabled },
      }),
      this.prisma.membershipOrder.count({
        where: { deletedAt: null, status: OrderStatus.pending },
      }),
      this.countExpiringSubs(range.timezone),
      this.prisma.invoice.count({
        where: { status: InvoiceStatus.pending },
      }),
    ]);

    const overview: PlatformOverview = {
      userTotal,
      searchCount,
      dataVolume: null,
      agentTaskCount: null,
      timezone: range.timezone,
      startDate: range.startDate,
      endDate: range.endDate,
      statDate: range.endDate,
      generatedAt: new Date().toISOString(),
      available: {
        userTotal: true,
        searchCount: true,
        dataVolume: METRIC_DATA_VOLUME_AVAILABLE,
        agentTaskCount: METRIC_AGENT_TASK_AVAILABLE,
      },
      metricDefinitions: this.buildMetricDefinitions(),
      alerts: this.buildAlerts({
        disabledUsers,
        pendingOrders,
        expiring: expiringUserSubs,
        pendingInvoices,
      }),
      extraMetrics: {
        rangeDays:
          eachDateInclusive(range.startDate, range.endDate).length,
      },
    };

    await this.redis.set(cacheKey, JSON.stringify(overview), this.cacheTtlSec);
    return overview;
  }

  /**
   * 日趋势：用户量 / 检索量按日序列；缺口为 null（空态）。
   */
  async getTrends(query: DashboardRangeQueryDto = {}): Promise<DashboardTrends> {
    const range = this.resolveRange(query);
    const cacheKey = `dashboard:trends:v1:${range.timezone}:${range.startDate}:${range.endDate}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached) as DashboardTrends;
    }

    await this.aggregateRange(range.startDate, range.endDate, range.timezone);

    const rows = await this.prisma.dashboardDailyStat.findMany({
      where: {
        statDate: {
          gte: dateOnlyToPrismaDate(range.startDate),
          lte: dateOnlyToPrismaDate(range.endDate),
        },
      },
      orderBy: { statDate: 'asc' },
    });
    const byDate = new Map(
      rows.map((row) => [prismaDateToDateOnly(row.statDate), row]),
    );

    const points = eachDateInclusive(range.startDate, range.endDate).map(
      (date) => {
        const row = byDate.get(date);
        if (!row) {
          return {
            date,
            userTotal: null,
            searchCount: null,
            newUserCount: null,
          };
        }
        const metrics = (row.metrics ?? {}) as Record<string, unknown>;
        const newUserRaw = metrics.newUserCount;
        return {
          date,
          userTotal: row.userTotal,
          searchCount: row.searchCount,
          newUserCount:
            typeof newUserRaw === 'number' && Number.isFinite(newUserRaw)
              ? newUserRaw
              : null,
        };
      },
    );

    const result: DashboardTrends = {
      timezone: range.timezone,
      startDate: range.startDate,
      endDate: range.endDate,
      generatedAt: new Date().toISOString(),
      points,
      metricDefinitions: this.buildMetricDefinitions(),
    };

    await this.redis.set(cacheKey, JSON.stringify(result), this.cacheTtlSec);
    return result;
  }

  /**
   * 强制按日聚合并失效缓存。
   */
  async refreshAggregate(
    query: DashboardRangeQueryDto = {},
  ): Promise<DashboardAggregateResultDto> {
    const range = this.resolveRange(query);
    const upsertedDays = await this.aggregateRange(
      range.startDate,
      range.endDate,
      range.timezone,
      true,
    );
    await this.bustCache(range.timezone, range.startDate, range.endDate);
    return {
      timezone: range.timezone,
      startDate: range.startDate,
      endDate: range.endDate,
      upsertedDays,
    };
  }

  /**
   * 解析并校验时间范围；默认近 7 天（含今日）。
   */
  private resolveRange(query: DashboardRangeQueryDto): {
    timezone: string;
    startDate: string;
    endDate: string;
  } {
    const timezone = normalizeDashboardTimezone(query.timezone);
    const today = zonedToday(timezone);
    const endDate = query.endDate?.trim() || today;
    const startDate = query.startDate?.trim() || addDays(endDate, -6);

    if (!isDateOnly(startDate) || !isDateOnly(endDate)) {
      throw new BadRequestException('日期格式须为 YYYY-MM-DD');
    }
    if (startDate > endDate) {
      throw new BadRequestException('开始日期不能晚于结束日期');
    }
    const days =
      (Date.parse(`${endDate}T00:00:00Z`) -
        Date.parse(`${startDate}T00:00:00Z`)) /
        86_400_000 +
      1;
    if (days > MAX_RANGE_DAYS) {
      throw new BadRequestException(`时间跨度不能超过 ${MAX_RANGE_DAYS} 天`);
    }
    if (endDate > today) {
      throw new BadRequestException('结束日期不能晚于今天');
    }

    return { timezone, startDate, endDate };
  }

  /**
   * 按日 upsert：检索量对账 ResearchRun；用户量对账 users 累计（截至当日结束）。
   */
  private async aggregateRange(
    startDate: string,
    endDate: string,
    timezone: string,
    force = false,
  ): Promise<number> {
    if (!force && (await this.isAggregateFresh(startDate, endDate, timezone))) {
      return 0;
    }

    const dates = eachDateInclusive(startDate, endDate);
    const { start, endExclusive } = zonedInclusiveRangeUtc(
      startDate,
      endDate,
      timezone,
    );

    const [searchBuckets, newUserBuckets, userTotalByDay] = await Promise.all([
      this.groupCountByZonedDay(
        {
          table: '"ResearchRun"',
          column: '"createdAt"',
          extraWhere: 'TRUE',
        },
        start,
        endExclusive,
        timezone,
      ),
      this.groupCountByZonedDay(
        {
          table: 'users',
          column: 'created_at',
          extraWhere: 'deleted_at IS NULL',
        },
        start,
        endExclusive,
        timezone,
      ),
      this.computeUserTotalsByDay(dates, timezone),
    ]);

    await this.prisma.$transaction(
      dates.map((date) => {
        const searchCount = searchBuckets.get(date) ?? 0;
        const newUserCount = newUserBuckets.get(date) ?? 0;
        const userTotal = userTotalByDay.get(date) ?? 0;
        const metrics = {
          newUserCount,
          searchSource: 'ResearchRun',
          userSource: 'users',
          aggregatedAt: new Date().toISOString(),
        } satisfies Prisma.InputJsonValue;

        return this.prisma.dashboardDailyStat.upsert({
          where: { statDate: dateOnlyToPrismaDate(date) },
          create: {
            statDate: dateOnlyToPrismaDate(date),
            userTotal,
            searchCount,
            dataVolume: 0n,
            agentTaskCount: 0,
            timezone,
            metrics,
          },
          update: {
            userTotal,
            searchCount,
            timezone,
            metrics,
          },
        });
      }),
    );

    return dates.length;
  }

  /**
   * 区间快照是否在短缓存窗口内（避免 overview/trends 并发重复聚合）。
   */
  private async isAggregateFresh(
    startDate: string,
    endDate: string,
    timezone: string,
  ): Promise<boolean> {
    const dates = eachDateInclusive(startDate, endDate);
    const rows = await this.prisma.dashboardDailyStat.findMany({
      where: {
        statDate: {
          gte: dateOnlyToPrismaDate(startDate),
          lte: dateOnlyToPrismaDate(endDate),
        },
        timezone,
      },
      select: { statDate: true, metrics: true },
    });
    if (rows.length !== dates.length) return false;
    const now = Date.now();
    return rows.every((row) => {
      const aggregatedAt = (row.metrics as Record<string, unknown> | null)
        ?.aggregatedAt;
      if (typeof aggregatedAt !== 'string') return false;
      const ts = Date.parse(aggregatedAt);
      return Number.isFinite(ts) && now - ts < 55_000;
    });
  }

  /**
   * 截至各日结束时刻仍有效的用户累计（可与用户表按创建时间对账）。
   */
  private async computeUserTotalsByDay(
    dates: string[],
    timezone: string,
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    await Promise.all(
      dates.map(async (date) => {
        const { endExclusive } = zonedDayRangeUtc(date, timezone);
        const count = await this.prisma.user.count({
          where: {
            createdAt: { lt: endExclusive },
            OR: [{ deletedAt: null }, { deletedAt: { gte: endExclusive } }],
          },
        });
        map.set(date, count);
      }),
    );
    return map;
  }

  /**
   * 区间检索合计（与日趋势之和一致）。
   */
  private async countSearches(
    startDate: string,
    endDate: string,
    timezone: string,
  ): Promise<number> {
    const { start, endExclusive } = zonedInclusiveRangeUtc(
      startDate,
      endDate,
      timezone,
    );
    return this.prisma.researchRun.count({
      where: {
        createdAt: { gte: start, lt: endExclusive },
      },
    });
  }

  /**
   * 按业务时区日历日 GROUP BY 计数。
   * 表名/列名仅来自白名单常量。
   */
  private async groupCountByZonedDay(
    relation: SqlRelation,
    start: Date,
    endExclusive: Date,
    timezone: string,
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ day: string; cnt: bigint | number }>
    >(
      `
      SELECT to_char(
               (${relation.column} AT TIME ZONE 'UTC') AT TIME ZONE $3,
               'YYYY-MM-DD'
             ) AS day,
             COUNT(*)::bigint AS cnt
      FROM ${relation.table}
      WHERE ${relation.column} >= $1
        AND ${relation.column} < $2
        AND (${relation.extraWhere})
      GROUP BY 1
      ORDER BY 1
      `,
      start,
      endExclusive,
      timezone,
    );

    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.day, Number(row.cnt));
    }
    return map;
  }

  private async countExpiringSubs(timezone: string): Promise<number> {
    const today = zonedToday(timezone);
    const { start } = zonedDayRangeUtc(today, timezone);
    const in7 = addDays(today, 7);
    const { endExclusive } = zonedDayRangeUtc(in7, timezone);
    return this.prisma.userSubscription.count({
      where: {
        deletedAt: null,
        status: SubscriptionStatus.active,
        endAt: { gte: start, lt: endExclusive },
      },
    });
  }

  private buildAlerts(input: {
    disabledUsers: number;
    pendingOrders: number;
    expiring: number;
    pendingInvoices: number;
  }): DashboardAlert[] {
    const alerts: DashboardAlert[] = [];
    if (input.disabledUsers > 0) {
      alerts.push({
        level: 'warning',
        code: 'DISABLED_USERS',
        title: '禁用用户',
        message: `当前有 ${input.disabledUsers} 个禁用账号`,
        count: input.disabledUsers,
      });
    }
    if (input.pendingOrders > 0) {
      alerts.push({
        level: 'warning',
        code: 'PENDING_ORDERS',
        title: '待支付订单',
        message: `有 ${input.pendingOrders} 笔会员订单待支付`,
        count: input.pendingOrders,
      });
    }
    if (input.expiring > 0) {
      alerts.push({
        level: 'error',
        code: 'SUB_EXPIRING',
        title: '即将到期订阅',
        message: `未来 7 天内有 ${input.expiring} 个订阅即将到期`,
        count: input.expiring,
      });
    }
    if (input.pendingInvoices > 0) {
      alerts.push({
        level: 'info',
        code: 'PENDING_INVOICES',
        title: '待开票',
        message: `有 ${input.pendingInvoices} 张发票待开具`,
        count: input.pendingInvoices,
      });
    }
    return alerts;
  }

  private buildMetricDefinitions(): DashboardMetricDefinition[] {
    return [
      {
        key: 'userTotal',
        label: '用户量',
        unit: '人',
        definition:
          '截至统计日结束仍有效的用户数（创建时间早于日末，且未删除或删除时间不早于日末）。总览取实时未删除用户数，可与用户列表对账。',
        available: true,
        source: 'users',
      },
      {
        key: 'searchCount',
        label: '检索量',
        unit: '次',
        definition:
          '业务时区日历日内 ResearchRun 创建次数；区间合计等于各日之和，可与研究检索运行明细对账。',
        available: true,
        source: 'ResearchRun',
      },
      {
        key: 'dataVolume',
        label: '数据量',
        unit: '-',
        definition: '数据资产计量尚未接入，暂以空态占位。',
        available: METRIC_DATA_VOLUME_AVAILABLE,
        source: null,
      },
      {
        key: 'agentTaskCount',
        label: 'Agent 任务量',
        unit: '次',
        definition: 'Agent 任务计量尚未接入，暂以空态占位。',
        available: METRIC_AGENT_TASK_AVAILABLE,
        source: null,
      },
    ];
  }

  private async bustCache(
    timezone: string,
    startDate: string,
    endDate: string,
  ): Promise<void> {
    await Promise.all([
      this.redis.del(
        `dashboard:overview:v3:${timezone}:${startDate}:${endDate}`,
      ),
      this.redis.del(
        `dashboard:trends:v1:${timezone}:${startDate}:${endDate}`,
      ),
      this.redis.del('dashboard:overview:v2'),
    ]);
  }
}
