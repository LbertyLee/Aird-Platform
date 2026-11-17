import { ConfigService } from '@nestjs/config';
import { ReportService } from './report.service';
import type { SourceEntity } from './research.types';

describe('ReportService', () => {
  it.each([undefined, 'custom-max'])('uses the reasoning model for reports (%s)', async (model) => {
    const service = new ReportService(new ConfigService({
      OPENAI_MODEL: 'regular-plus', OPENAI_REASONING_MODEL: model,
    }));
    const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: '报告 [S1]' } }] });
    Object.defineProperty(service, 'client', {
      value: { chat: { completions: { create } } },
    });
    const report = await service.generate('GDP', [{
      id: 'source-1', title: '官方数据', origin: 'upload', storageType: 'structured',
      sourceUrl: null, mimeType: 'text/csv', excerpt: 'GDP', recordCount: 1,
      createdAt: new Date().toISOString(), textContent: 'GDP 100',
    }]);
    expect(report.generatedBy).toBe('ai');
    expect(create.mock.calls[0][0].model).toBe(model ?? 'qwen3.8-max');
  });

  it('generates a traceable template when OpenAI is not configured', async () => {
    const service = new ReportService(new ConfigService({ AI_API_KEY: '' }));
    const source: SourceEntity = {
      id: 'source-1',
      title: 'GDP data.csv',
      origin: 'upload',
      storageType: 'structured',
      sourceUrl: null,
      mimeType: 'text/csv',
      excerpt: 'China 2024 100',
      recordCount: 1,
      createdAt: new Date().toISOString(),
      textContent: 'China 2024 100',
      structuredData: [{ country: 'China', year: 2024, value: 100 }],
    };

    const report = await service.generate('China GDP', [source]);

    expect(report.generatedBy).toBe('template');
    expect(report.markdown).toContain('[S1]');
    expect(report.markdown).toContain('GDP data.csv');
    expect(report.markdown).toContain('只汇总');
  });
});
