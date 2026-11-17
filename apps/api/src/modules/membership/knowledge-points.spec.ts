import { MembershipService } from './membership.service';

describe('knowledge learning points', () => {
  let service: MembershipService;
  let balance: number;
  let ledgers: Map<string, any>;
  let tx: any;
  beforeEach(() => {
    balance = 5;
    ledgers = new Map();
    tx = {
      $queryRaw: jest.fn(async () => [{ balance }]),
      pointAccount: {
        upsert: jest.fn(),
        update: jest.fn(async ({ data }) => { balance = data.balance; }),
      },
      pointLedger: {
        findUnique: jest.fn(async ({ where }) => ledgers.get(where.userId_reference.reference) ?? null),
        create: jest.fn(async ({ data }) => { ledgers.set(data.reference, data); return data; }),
      },
    };
    service = new MembershipService(
      { ...tx, $transaction: async (fn: any) => fn(tx) } as any,
      {} as any, {} as any, {} as any, {} as any,
      { get: () => 'embedding-model' } as any, {} as any,
    );
    jest.spyOn(service, 'getPointRulesConfig').mockResolvedValue({ modelPricing: { 'embedding-model': { inputYuanPerMillionTokens: 3, outputYuanPerMillionTokens: 6 } }, yuanPerPoint: 0.001 } as any);
    jest.spyOn(service, 'getPointSummary').mockImplementation(async () => ({ balance }) as any);
  });

  it('charges once per job and records balance after debit', async () => {
    await service.consumeKnowledgeLearningPoints('u', 'job', [{ model: 'embedding-model', promptTokens: 1000, completionTokens: 0 }]);
    await service.consumeKnowledgeLearningPoints('u', 'job', [{ model: 'embedding-model', promptTokens: 1000, completionTokens: 0 }]);
    expect(balance).toBe(2);
    expect(tx.pointLedger.create).toHaveBeenCalledTimes(1);
    expect(ledgers.get('knowledge:job')).toMatchObject({ amount: -3, balanceAfter: 2, source: 'consume' });
    expect(tx.$queryRaw).toHaveBeenCalled();
  });

  it('rejects insufficient balance before writing a ledger', async () => {
    balance = 2;
    await expect(service.assertCanLearnKnowledge('u')).resolves.toBeUndefined();
    await expect(service.consumeKnowledgeLearningPoints('u', 'job', [{ model: 'embedding-model', promptTokens: 1000, completionTokens: 0 }])).rejects.toThrow();
    expect(balance).toBe(2);
    expect(ledgers.size).toBe(0);
  });

  it('charges according to actual model tokens rather than a fixed amount', async () => {
    await service.consumeKnowledgeLearningPoints('u', 'small', [{ model: 'embedding-model', promptTokens: 100, completionTokens: 0 }]);
    expect(balance).toBe(4);
    await service.consumeKnowledgeLearningPoints('u', 'large', [{ model: 'embedding-model', promptTokens: 1000, completionTokens: 0 }]);
    expect(balance).toBe(1);
  });
  it('aggregates input and output charges before rounding', async () => {
    await service.consumeKnowledgeLearningPoints('u', 'mixed', [
      { model: 'embedding-model', promptTokens: 100, completionTokens: 100 },
      { model: 'embedding-model', promptTokens: 100, completionTokens: 0 },
    ]);
    expect(balance).toBe(3);
  });
  it('does not charge when no tokens were consumed', async () => {
    await service.consumeKnowledgeLearningPoints('u', 'empty', []);
    expect(balance).toBe(5);
    expect(ledgers.size).toBe(0);
  });
  it('rejects missing prices instead of silently skipping the charge', async () => {
    await expect(service.consumeKnowledgeLearningPoints('u', 'missing', [{ model: 'unknown', promptTokens: 100, completionTokens: 0 }])).rejects.toThrow();
    expect(ledgers.size).toBe(0);
  });
  it.each([-1, 1.5, NaN])('rejects invalid token usage %s', async (tokens) => {
    await expect(service.consumeKnowledgeLearningPoints('u', 'invalid', [{ model: 'embedding-model', promptTokens: tokens, completionTokens: 0 }])).rejects.toThrow();
    expect(ledgers.size).toBe(0);
  });
});
