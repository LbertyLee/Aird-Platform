import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export type LlmUsageRecord = {
  model: string;
  promptTokens: number;
  completionTokens: number;
};

/** Collects provider-reported token use only inside an explicitly metered request. */
@Injectable()
export class LlmUsageMeterService {
  private readonly storage = new AsyncLocalStorage<LlmUsageRecord[]>();

  isMeasuring(): boolean {
    return this.storage.getStore() !== undefined;
  }

  async measure<T>(operation: () => Promise<T>): Promise<{ result: T; usage: LlmUsageRecord[] }> {
    const usage: LlmUsageRecord[] = [];
    const result = await this.storage.run(usage, operation);
    return { result, usage };
  }

  record(record: LlmUsageRecord): void {
    const usage = this.storage.getStore();
    if (!usage || (record.promptTokens === 0 && record.completionTokens === 0)) return;
    usage.push(record);
  }
}
