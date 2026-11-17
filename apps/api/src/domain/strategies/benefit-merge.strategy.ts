import { Injectable } from '@nestjs/common';
import { BenefitValueType } from '@prisma/client';

/**
 * 单项权益值。
 */
export class BenefitValue {
  /** 权益码 */
  code!: string;
  /** 值类型 */
  valueType!: BenefitValueType;
  /** 原始 JSON 值 */
  raw!: unknown;

  /**
   * 以数值读取（int/bytes）。
   */
  asNumber(): number {
    if (typeof this.raw === 'object' && this.raw !== null) {
      const obj = this.raw as Record<string, unknown>;
      if (typeof obj.n === 'number') return obj.n;
      if (typeof obj.bytes === 'number') return obj.bytes;
      if (typeof obj.bytes === 'string') return Number(obj.bytes);
    }
    if (typeof this.raw === 'number') return this.raw;
    return 0;
  }

  /**
   * 以布尔读取。
   */
  asBoolean(): boolean {
    if (typeof this.raw === 'object' && this.raw !== null) {
      const obj = this.raw as Record<string, unknown>;
      if (typeof obj.enabled === 'boolean') return obj.enabled;
    }
    return Boolean(this.raw);
  }
}

/**
 * 一组权益来源包。
 */
export class BenefitBundle {
  /** 来源类型 */
  sourceType!: 'user' | 'default';
  /** 来源订阅或默认档 ID */
  sourceId!: string | null;
  /** 权益码到值 */
  values!: Map<string, BenefitValue>;
}

/**
 * 多来源权益合并策略端口。
 * 使用抽象类以便 Nest emitDecoratorMetadata 可反射类型。
 */
export abstract class IBenefitMergeStrategy {
  /**
   * 将多组权益合并为最终有效权益。
   */
  abstract merge(sources: BenefitBundle[]): BenefitBundle;
}

/**
 * 取更高额度合并（一期默认）：int/bytes 取 max，bool 取 OR。
 */
@Injectable()
export class HigherWinsMergeStrategy implements IBenefitMergeStrategy {
  /**
   * 合并多来源权益。
   */
  merge(sources: BenefitBundle[]): BenefitBundle {
    const values = new Map<string, BenefitValue>();
    for (const source of sources) {
      for (const [code, value] of source.values) {
        const existing = values.get(code);
        if (!existing) {
          values.set(code, value);
          continue;
        }
        if (
          value.valueType === BenefitValueType.bool ||
          existing.valueType === BenefitValueType.bool
        ) {
          const enabled = existing.asBoolean() || value.asBoolean();
          const merged = new BenefitValue();
          merged.code = code;
          merged.valueType = BenefitValueType.bool;
          merged.raw = { enabled };
          values.set(code, merged);
          continue;
        }
        if (value.asNumber() > existing.asNumber()) {
          values.set(code, value);
        }
      }
    }
    return {
      sourceType: 'default',
      sourceId: null,
      values,
    };
  }
}
