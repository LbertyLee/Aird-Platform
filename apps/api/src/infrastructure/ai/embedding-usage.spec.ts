import { EmbeddingService } from './embedding.service';
import { LlmUsageMeterService } from './llm-usage-meter.service';

describe('provider reported embedding usage', () => {
  const make = (provider = 'openai') => {
    const values: Record<string, unknown> = { AI_API_KEY: 'test-key', EMBEDDING_BASE_URL: 'https://example.test', EMBEDDING_MODEL: 'embedding-model', EMBEDDING_DIM: 2, EMBEDDING_PROVIDER: provider, EMBEDDING_BATCH_SIZE: 1, EMBEDDING_CONCURRENCY: 2 };
    const meter = new LlmUsageMeterService();
    const service = new EmbeddingService({ get: (key: string) => values[key], getOrThrow: (key: string) => values[key] } as any, meter);
    return { service, meter };
  };
  it('collects actual batch usage and preserves vector order', async () => {
    const { service, meter } = make();
    (service as any).client = { embeddings: { create: jest.fn()
      .mockResolvedValueOnce({ model: 'embedding-model', usage: { prompt_tokens: 123, total_tokens: 123 }, data: [{ index: 0, embedding: [1, 0] }] })
      .mockResolvedValueOnce({ model: 'embedding-model', usage: { prompt_tokens: 456, total_tokens: 456 }, data: [{ index: 0, embedding: [0, 1] }] }) } };
    const measured = await meter.measure(() => service.embedMany(['a', 'b']));
    expect(measured.result).toEqual([[1, 0], [0, 1]]);
    expect(measured.usage.map((item) => item.promptTokens)).toEqual([123, 456]);
  });
  it('rejects absent usage in a billed scope instead of estimating tokens', async () => {
    const { service, meter } = make();
    (service as any).client = { embeddings: { create: jest.fn().mockResolvedValue({ data: [{ index: 0, embedding: [1, 0] }] }) } };
    await expect(meter.measure(() => service.embedMany(['text']))).rejects.toThrow('token usage');
  });
  it('waits for in-flight successful batches when another batch fails', async () => {
    const { service, meter } = make();
    (service as any).client = { embeddings: { create: jest.fn()
      .mockRejectedValueOnce(new Error('provider failed'))
      .mockImplementationOnce(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); return { usage: { prompt_tokens: 77 }, data: [{ index: 0, embedding: [1, 0] }] }; }) } };
    const measured = await meter.measure(async () => { try { await service.embedMany(['a', 'b']); } catch { return 'failed'; } });
    expect(measured.result).toBe('failed');
    expect(measured.usage).toEqual([{ model: 'embedding-model', promptTokens: 77, completionTokens: 0 }]);
  });
  it('collects DashScope input tokens', async () => {
    const { service, meter } = make('dashscope-multimodal');
    const mock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ usage: { input_tokens: 98 }, output: { embeddings: [{ embedding: [1, 0] }] } }) } as any);
    try {
      const measured = await meter.measure(() => service.embedMany(['text']));
      expect(measured.usage).toEqual([{ model: 'embedding-model', promptTokens: 98, completionTokens: 0 }]);
    } finally { mock.mockRestore(); }
  });
  it('uses DashScope total tokens when input and image tokens are also present', async () => {
    const { service, meter } = make('dashscope-multimodal');
    const mock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ usage: { input_tokens: 43, image_tokens: 1247, total_tokens: 1290 }, output: { embeddings: [{ embedding: [1, 0] }] } }) } as any);
    try {
      const measured = await meter.measure(() => service.embedMany(['text']));
      expect(measured.usage).toEqual([{ model: 'embedding-model', promptTokens: 1290, completionTokens: 0 }]);
    } finally { mock.mockRestore(); }
  });
});
