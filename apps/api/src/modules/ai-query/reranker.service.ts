import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type RerankDocument = { id: string; text: string };
export type RerankResult = { id: string; score: number };

export interface RerankerProvider {
  isReady(): boolean;
  rerank(query: string, documents: RerankDocument[], topK: number): Promise<RerankResult[]>;
}

@Injectable()
export class RerankerService {
  private readonly logger = new Logger(RerankerService.name);
  private readonly provider: RerankerProvider;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.timeoutMs = Math.max(200, config.get<number>('RERANKER_TIMEOUT_MS') ?? 2500);
    this.provider = new RemoteRerankerProvider(config, this.logger);
  }

  isReady() { return this.provider.isReady(); }

  async rerank(query: string, documents: RerankDocument[], topK: number): Promise<RerankResult[]> {
    if (!documents.length || !this.provider.isReady()) return [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.provider.rerank(query, documents, topK),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('reranker timeout')), this.timeoutMs); }),
      ]);
    } catch (error) {
      this.logger.warn(`reranker fallback: ${String(error)}`);
      return [];
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

class RemoteRerankerProvider implements RerankerProvider {
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService, private readonly logger: Logger) {
    this.endpoint = config.get<string>('RERANKER_BASE_URL') ?? '';
    this.apiKey = config.get<string>('AI_API_KEY') ?? '';
    this.model = config.get<string>('RERANKER_MODEL') ?? 'rerank';
    this.timeoutMs = Math.max(200, config.get<number>('RERANKER_TIMEOUT_MS') ?? 2500);
  }

  isReady() { return Boolean(this.endpoint && this.apiKey); }

  async rerank(query: string, documents: RerankDocument[], topK: number): Promise<RerankResult[]> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, query, documents: documents.map((d) => d.text), top_n: topK }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error(`reranker http ${response.status}`);
    const body = (await response.json()) as { results?: Array<{ index?: number; relevance_score?: number; score?: number; id?: string }> };
    return (body.results ?? []).map((item) => ({
      id: item.id ?? documents[item.index ?? -1]?.id,
      score: Number(item.relevance_score ?? item.score ?? 0),
    })).filter((item): item is RerankResult => Boolean(item.id));
  }
}
