import { EvidenceService } from './evidence.service';

describe('analysis evidence preservation', () => {
  it('stores all SQL rows and the anchor even after large adjacent chunks', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'evidence' });
    const service = new EvidenceService({ queryEvidence: { create } } as never);
    const rows = Array.from({ length: 100 }, (_, year) => ({ year, value: year }));
    await service.saveSqlEvidence('query', { sql: 'SELECT', rows, fieldNames: ['value'] });
    expect(JSON.parse(create.mock.calls[0][0].data.content)).toHaveLength(100);
    const content = '说明'.repeat(2500) + 'GDP为100亿元';
    await service.saveVectorEvidence('query', [{ chunkId: 'chunk', sourceId: 'knowledge', sourceType: 'knowledge', score: 1, content }]);
    expect(create.mock.calls[1][0].data.content).toContain('GDP为100亿元');
  });
});
