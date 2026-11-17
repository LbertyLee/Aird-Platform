import { LlmUsageMeterService } from './llm-usage-meter.service';

describe('LlmUsageMeterService', () => {
  it('collects only usage produced in the active measurement scope', async () => {
    const service = new LlmUsageMeterService();
    service.record({ model: 'outside', promptTokens: 1, completionTokens: 1 });

    const measured = await service.measure(async () => {
      service.record({ model: 'qwen', promptTokens: 12, completionTokens: 4 });
      return 'done';
    });

    expect(measured).toEqual({
      result: 'done',
      usage: [{ model: 'qwen', promptTokens: 12, completionTokens: 4 }],
    });
  });
});
