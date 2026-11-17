import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { LlmUsageMeterService } from './llm-usage-meter.service';

type EmbeddingProvider = 'openai' | 'dashscope-multimodal';

/**
 * Embedding 客户端：
 * - openai：OpenAI 兼容接口（硅基流动等）
 * - dashscope-multimodal：阿里云百炼多模态（Qwen3-VL-Embedding）
 */
@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly client: OpenAI | null;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly provider: EmbeddingProvider;
  private readonly timeoutMs: number;
  /** OpenAI 兼容接口单次 input 条数上限（DashScope text-embedding-v4 等为 10） */
  private readonly batchSize: number;
  /** 并行 embedding 请求数上限，避免打满上游限流 */
  private readonly concurrency: number;
  readonly dim: number;

  /**
   * @param config 环境配置
   */
  constructor(private readonly config: ConfigService, private readonly usageMeter: LlmUsageMeterService) {
    this.apiKey = this.config.get<string>('AI_API_KEY') || '';
    this.baseURL = this.config.getOrThrow<string>('EMBEDDING_BASE_URL');
    this.model = this.config.getOrThrow<string>('EMBEDDING_MODEL');
    this.dim = this.config.getOrThrow<number>('EMBEDDING_DIM');
    this.timeoutMs = Math.max(1_000, this.config.get<number>('EMBEDDING_TIMEOUT_MS') ?? 30_000);
    this.batchSize = Math.min(
      64,
      Math.max(1, this.config.get<number>('EMBEDDING_BATCH_SIZE') ?? 10),
    );
    this.concurrency = Math.min(
      8,
      Math.max(1, this.config.get<number>('EMBEDDING_CONCURRENCY') ?? 2),
    );
    this.provider = this.resolveProvider();
    this.client =
      this.apiKey && this.provider === 'openai'
        ? new OpenAI({ apiKey: this.apiKey, baseURL: this.baseURL, timeout: this.timeoutMs })
        : null;
    if (!this.apiKey) {
      this.logger.warn('AI_API_KEY empty — embedding disabled');
    } else {
      this.logger.log(
        `Embedding ready → provider=${this.provider} model=${this.model} dim=${this.dim} batch=${this.batchSize} concurrency=${this.concurrency}`,
      );
    }
  }

  /**
   * 是否已配置可用。
   */
  isReady(): boolean {
    if (!this.apiKey) return false;
    return this.provider === 'dashscope-multimodal' || Boolean(this.client);
  }

  /** 当前系统 Embedding 模型名（来自 EMBEDDING_MODEL） */
  getModelName(): string {
    return this.model;
  }

  /**
   * 单条文本向量化。
   */
  async embed(text: string): Promise<number[]> {
    const [vec] = await this.embedMany([text]);
    return vec;
  }

  /**
   * 批量文本向量化。
   */
  async embedMany(texts: string[]): Promise<number[][]> {
    if (!this.isReady()) {
      throw new Error(
        'Embedding service not configured (missing AI_API_KEY)',
      );
    }
    const cleaned = texts.map((t) => t.trim() || ' ');
    if (this.provider === 'dashscope-multimodal') {
      return this.embedManyDashScope(cleaned);
    }
    return this.embedManyOpenAi(cleaned);
  }

  private async embedManyOpenAi(texts: string[]): Promise<number[][]> {
    const batches = this.chunk(texts, this.batchSize);
    const nested = await this.mapWithConcurrency(batches, this.concurrency, (batch) =>
      this.embedOpenAiBatch(batch),
    );
    return nested.flat();
  }

  private async embedOpenAiBatch(texts: string[]): Promise<number[][]> {
    const res = await this.client!.embeddings.create({
      model: this.model,
      input: texts,
    });
    this.recordUsage(res.model || this.model, res.usage?.prompt_tokens ?? res.usage?.total_tokens);
    return res.data
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }

  private resolveProvider(): EmbeddingProvider {
    const configured = (
      this.config.get<string>('EMBEDDING_PROVIDER') || ''
    ).toLowerCase();
    if (
      configured === 'dashscope-multimodal' ||
      configured === 'dashscope_multimodal'
    ) {
      return 'dashscope-multimodal';
    }
    if (configured === 'openai') return 'openai';
    // Qwen3-VL-Embedding 不走 OpenAI 兼容接口
    if (/qwen3-vl-embedding/i.test(this.model)) {
      return 'dashscope-multimodal';
    }
    return 'openai';
  }

  private async embedManyDashScope(texts: string[]): Promise<number[][]> {
    return this.mapWithConcurrency(texts, this.concurrency, (text) =>
      this.embedOneDashScope(text),
    );
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      out.push(items.slice(i, i + size));
    }
    return out;
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    if (!items.length) return [];
    const results = new Array<R>(items.length);
    let cursor = 0;
    const workerCount = Math.min(concurrency, items.length);
    const outcomes = await Promise.allSettled(
      Array.from({ length: workerCount }, async () => {
        while (true) {
          const index = cursor++;
          if (index >= items.length) break;
          results[index] = await fn(items[index]);
        }
      }),
    );
    // 等待所有在途请求返回，失败批次也不能丢失其他请求的实际用量。
    const failed = outcomes.find((item) => item.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    return results;
  }

  private async embedOneDashScope(text: string): Promise<number[]> {
    const endpoint = `${this.baseURL.replace(/\/$/, '')}/services/embeddings/multimodal-embedding/multimodal-embedding`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input: {
          contents: [{ text }],
        },
        parameters: {
          dimension: this.dim,
        },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const payload = (await response.json()) as {
      code?: string;
      message?: string;
      usage?: { input_tokens?: number; total_tokens?: number };
      output?: {
        embeddings?: Array<{ embedding?: number[]; type?: string }>;
      };
    };

    if (!response.ok || payload.code) {
      throw new Error(
        `DashScope embedding failed: ${payload.code || response.status} ${payload.message || response.statusText}`,
      );
    }

    this.recordUsage(this.model, payload.usage?.total_tokens ?? payload.usage?.input_tokens);

    const embedding = payload.output?.embeddings?.[0]?.embedding;
    if (!embedding?.length) {
      throw new Error('DashScope embedding returned empty vector');
    }
    if (embedding.length !== this.dim) {
      throw new Error(
        `DashScope embedding dim mismatch: expected ${this.dim}, got ${embedding.length}`,
      );
    }
    return embedding;
  }

  private recordUsage(model: string, tokens: unknown): void {
    if (!Number.isSafeInteger(tokens) || Number(tokens) < 0) {
      // 非计费检索仍可兼容不返回 usage 的供应商；学习计费禁止估算。
      if (this.usageMeter.isMeasuring()) throw new Error('Embedding provider did not return valid token usage');
      return;
    }
    this.usageMeter.record({ model, promptTokens: Number(tokens), completionTokens: 0 });
  }
}
