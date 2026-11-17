import { Inject, Injectable } from '@nestjs/common';
import { BenefitValueType, SubscriptionStatus } from '@prisma/client';
import { BENEFIT_MERGE_STRATEGY } from '../../common/constants/injection-tokens';
import {
  BenefitBundle,
  BenefitValue,
  IBenefitMergeStrategy,
} from '../../domain/strategies/benefit-merge.strategy';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { formatValuesSummary } from './benefit-summary.util';

/**
 * 有效权益结果。
 */
export class EffectiveEntitlements {
  /** 用户 ID */
  userId!: string;
  /** 合并后的权益字典（默认档 + 个人 HigherWins） */
  values!: Record<string, unknown>;
  /** 合并后的权益摘要 */
  summary!: string;
  /** 参与合并的来源追踪 */
  sources!: Array<{ type: string; id: string; levelId: string }>;
}

/** 无付费订阅时的默认权益（不再维护「免费版」等级行） */
const DEFAULT_GUEST_BENEFITS: Array<{ benefitCode: string; valueJson: unknown }> = [
  { benefitCode: 'search_quota', valueJson: { n: 1 } },
  { benefitCode: 'export_quota', valueJson: { n: 5 } },
  { benefitCode: 'max_agents', valueJson: { n: 1 } },
  { benefitCode: 'storage_bytes', valueJson: { bytes: 1073741824 } },
];

/**
 * 汇总个人订阅，产出有效权益。
 */
@Injectable()
export class EntitlementResolver {
  /**
   * @param prisma Prisma
   * @param mergeStrategy 权益合并策略
   */
  constructor(
    private readonly prisma: PrismaService,
    @Inject(BENEFIT_MERGE_STRATEGY)
    private readonly mergeStrategy: IBenefitMergeStrategy,
  ) {}

  /**
   * 加载个人有效订阅并合并；无有效订阅回落内置默认权益。
   */
  async resolveForUser(userId: string): Promise<EffectiveEntitlements> {
    const now = new Date();
    const sources: BenefitBundle[] = [];
    const sourceMeta: EffectiveEntitlements['sources'] = [];

    sources.push(
      this.toBundle('default', 'builtin-default', DEFAULT_GUEST_BENEFITS),
    );
    sourceMeta.push({
      type: 'default',
      id: 'builtin-default',
      levelId: 'builtin-default',
    });

    const userSub = await this.prisma.userSubscription.findFirst({
      where: {
        userId,
        status: SubscriptionStatus.active,
        startAt: { lte: now },
        endAt: { gte: now },
        deletedAt: null,
      },
      include: { level: { include: { benefits: true } } },
      orderBy: { endAt: 'desc' },
    });
    if (userSub) {
      sources.push(
        this.toBundle('user', userSub.id, userSub.level.benefits),
      );
      sourceMeta.push({
        type: 'user',
        id: userSub.id,
        levelId: userSub.levelId,
      });
    }

    const merged = this.mergeStrategy.merge(sources);
    const values: Record<string, unknown> = {};
    for (const [code, value] of merged.values) {
      values[code] = value.raw;
    }

    return {
      userId,
      values,
      summary: formatValuesSummary(values),
      sources: sourceMeta,
    };
  }

  /**
   * 将等级权益转为 BenefitBundle。
   */
  private toBundle(
    sourceType: BenefitBundle['sourceType'],
    sourceId: string,
    benefits: Array<{ benefitCode: string; valueJson: unknown }>,
  ): BenefitBundle {
    const values = new Map<string, BenefitValue>();
    for (const b of benefits) {
      const value = new BenefitValue();
      value.code = b.benefitCode;
      value.raw = b.valueJson;
      value.valueType = this.guessType(b.valueJson);
      values.set(b.benefitCode, value);
    }
    return { sourceType, sourceId, values };
  }

  /**
   * 根据 JSON 形态推断权益类型。
   */
  private guessType(raw: unknown): BenefitValueType {
    if (typeof raw === 'object' && raw !== null) {
      const obj = raw as Record<string, unknown>;
      if ('bytes' in obj) return BenefitValueType.bytes;
      if ('enabled' in obj) return BenefitValueType.bool;
    }
    return BenefitValueType.int;
  }
}
