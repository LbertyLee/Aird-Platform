import { WorldBankDataService } from './world-bank-data.service';
import type { ResearchQueryPlan } from '@agent/contracts';

const plan: ResearchQueryPlan = { countries: ['美国'], regions: [], entities: [], indicators: ['GDP'], timeRanges: ['2021-2025'], sources: ['World Bank'], intent: 'lookup', confidence: 1, explanation: 'test' };
const payload = [{ total: 1 }, [{ indicator: { id: 'NY.GDP.MKTP.CD', value: 'GDP (current US$)' }, country: { value: 'United States' }, countryiso3code: 'USA', date: '2025', value: 30769700000000 }]];
const success = () => new Response(JSON.stringify(payload));

describe('World Bank timeout recovery', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  async function run() {
    const pending = new WorldBankDataService().fetch(plan, '美国近5年GDP');
    await jest.runAllTimersAsync();
    return pending;
  }
  it('recovers a transient connection timeout into official observations', async () => {
    const api = jest.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError')).mockResolvedValueOnce(success());
    const data = await run();
    expect(api).toHaveBeenCalledTimes(2);
    expect(data[0].structuredData[0]).toMatchObject({ year: 2025, value: 30769700000000, unit: '美元' });
    expect(api.mock.calls.every((call) => call[1]?.signal instanceof AbortSignal)).toBe(true);
  });
  it('retries a response body timeout and truncated JSON', async () => {
    const api = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => { throw new DOMException('body aborted', 'AbortError'); } } as unknown as Response)
      .mockResolvedValueOnce(new Response('[truncated'))
      .mockResolvedValueOnce(success());
    expect(await run()).toHaveLength(1);
    expect(api).toHaveBeenCalledTimes(3);
  });
  it('stops after three attempts with backoff only between requests', async () => {
    const started = Date.now();
    const api = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network unavailable'));
    expect(await run()).toEqual([]);
    expect(api).toHaveBeenCalledTimes(3);
    expect(Date.now() - started).toBe(1500);
  });
  it.each([408, 429, 503])('retries HTTP %s and releases its response body', async (status) => {
    const bad = new Response('upstream unavailable', { status, headers: { 'retry-after': '100' } });
    const cancel = jest.spyOn(bad.body!, 'cancel');
    const started = Date.now();
    const api = jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(bad).mockResolvedValueOnce(success());
    expect(await run()).toHaveLength(1);
    expect(api).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(Date.now() - started).toBe(2000);
  });
  it('does not retry permanent client errors', async () => {
    const api = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad request', { status: 400 }));
    expect(await run()).toEqual([]);
    expect(api).toHaveBeenCalledTimes(1);
  });
  it('keeps a legitimate empty series empty without retrying or inventing years', async () => {
    const api = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify([{ total: 0 }, null])));
    expect(await run()).toEqual([]);
    expect(api).toHaveBeenCalledTimes(1);
  });
});
