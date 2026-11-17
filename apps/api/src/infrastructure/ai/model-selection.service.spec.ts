import { ModelSelectionService } from './model-selection.service';

describe('ModelSelectionService', () => {
  it('reads enabled model options and rejects disabled/unknown models', async () => {
    const prisma = {
      searchModelConfig: {
        findMany: jest.fn().mockResolvedValue([{ value: 'qwen3.8-max', label: '复杂推理模型' }]),
        findUnique: jest.fn().mockImplementation(({ where }) => where.value === 'qwen3.8-max'
          ? Promise.resolve({ value: 'qwen3.8-max', status: 'active' })
          : Promise.resolve(null)),
      },
    };
    const service = new ModelSelectionService(prisma as never);

    await expect(service.list()).resolves.toEqual([{ value: 'qwen3.8-max', label: '复杂推理模型' }]);
    await expect(service.resolve('qwen3.8-max')).resolves.toBe('qwen3.8-max');
    await expect(service.resolve('disabled-model')).resolves.toBeUndefined();
  });

  it('keeps selected model scoped to the async task', async () => {
    const service = new ModelSelectionService({
      searchModelConfig: { findUnique: jest.fn().mockResolvedValue({ value: 'qwen3.8-max', status: 'active' }) },
    } as never);
    await service.run('qwen3.8-max', async () => {
      expect(service.current('default-model')).toBe('qwen3.8-max');
    });
    expect(service.current('default-model')).toBe('default-model');
  });
});
