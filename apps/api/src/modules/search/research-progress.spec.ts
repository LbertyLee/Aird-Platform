import { reportResearchProgress, withResearchProgress } from './research-progress';

describe('concurrent search progress isolation', () => {
  it('keeps reports within the initiating search context', async () => {
    const first = jest.fn().mockResolvedValue(undefined);
    const second = jest.fn().mockResolvedValue(undefined);
    await Promise.all([
      withResearchProgress(first, async () => {
        await new Promise((resolve) => setImmediate(resolve));
        await reportResearchProgress({ stage: 'planning', message: 'first' });
      }),
      withResearchProgress(second, async () => {
        await reportResearchProgress({ stage: 'searching', message: 'second' });
      }),
    ]);
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith({ stage: 'planning', message: 'first' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith({ stage: 'searching', message: 'second' });
    await reportResearchProgress({ stage: 'writing', message: 'outside' });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
