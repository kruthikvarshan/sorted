import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/groupAnalyzer', () => ({ analyzeGroup: vi.fn() }));
const budget = await import('../../server/live/budget');
const hub = await import('../../server/live/hub');
const { analyzeGroup } = await import('../services/groupAnalyzer');

beforeEach(() => {
  budget.resetBudget(':memory:');
  hub.resetLive(':memory:');
  process.env.MODEL_API_KEY = 'test';
  process.env.META_BUDGET_SOFT_USD = '1';
  process.env.META_BUDGET_HARD_USD = '2';
  process.env.META_BUDGET_ROOM_DAY_USD = '0.5';
  vi.mocked(analyzeGroup).mockReset();
});
afterEach(() => {
  delete process.env.META_BUDGET_SOFT_USD;
  delete process.env.META_BUDGET_HARD_USD;
  delete process.env.META_BUDGET_ROOM_DAY_USD;
});

describe('the Meta credit safety net', () => {
  it('prices a response from its own usage numbers, web searches included', () => {
    expect(budget.costOf('/v1/chat/completions', { usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } })).toBeCloseTo(1.25);
    expect(budget.costOf('/v1/chat/completions', { usage: { prompt_tokens: 0, completion_tokens: 1_000_000 } })).toBeCloseTo(4.25);
    expect(budget.costOf('/v1/responses', { usage: { input_tokens: 0, output_tokens: 0 }, output: [{ type: 'web_search_call' }, { type: 'web_search_call' }] })).toBeCloseTo(0.005);
  });

  it('past the soft limit only background work waits; past the hard limit everything new waits, calmly', () => {
    budget.record('/v1/chat/completions', 1.1, { kind: 'interactive' });
    expect(() => budget.check({ kind: 'interactive' })).not.toThrow();
    expect(() => budget.check({ kind: 'background' })).toThrow(/read these a little later/);
    budget.record('/v1/chat/completions', 1, { kind: 'interactive' });
    expect(() => budget.check({ kind: 'interactive' })).toThrow(/resting for a bit/);
    expect(() => budget.check({ kind: 'interactive' })).not.toThrow(/token|credit|limit|error/i);
  });

  it('one group has a daily share; other groups are not affected', () => {
    budget.record('/v1/chat/completions', 0.6, { kind: 'interactive', roomId: 'busy' });
    expect(() => budget.check({ kind: 'interactive', roomId: 'busy' })).toThrow(/a lot in this group today/);
    expect(() => budget.check({ kind: 'interactive', roomId: 'quiet' })).not.toThrow();
  });

  it('a read that cannot start waits with a calm note instead of an error, and nothing is marked read', async () => {
    budget.record('/v1/chat/completions', 3, { kind: 'interactive' });
    const room = hub.createRoom('Flat');
    const k = hub.joinRoom(room.id, 'Kruthik').member!;
    hub.postMessage(room.id, k.token, 'rent 18000 to me');
    const entry = hub.roomEntry(room.id)!;
    await hub.analyse(entry);
    expect(analyzeGroup).not.toHaveBeenCalled();
    expect(entry.room.lastAnalysis?.error).toBeUndefined();
    expect(hub.readingStatus(entry).note).toMatch(/resting/);
    expect(entry.room.state.readThrough ?? 0).toBe(0);
  });

  it('a read that already started is never cut off halfway', async () => {
    budget.guardMetaCalls(() => 'https://meta.test/v1');
    const real = globalThis.fetch;
    let calls = 0;
    const answer = () => Promise.resolve(new Response(JSON.stringify({ usage: { prompt_tokens: 1_000_000, completion_tokens: 0 } }), { status: 200 }));
    const inner = vi.fn(answer);
    // The guard wraps whatever fetch was there; count calls that get through to "Meta".
    (globalThis as any).__groupOsMetaGuard = false;
    globalThis.fetch = inner as any;
    budget.guardMetaCalls(() => 'https://meta.test/v1');
    try {
      await budget.asWork({ kind: 'background', started: true }, async () => {
        for (let i = 0; i < 3; i++) await fetch('https://meta.test/v1/chat/completions').then(() => calls++);
      });
      expect(calls).toBe(3);
      // The started read finished (3 calls, $3.75); new work after it is refused, calmly.
      await expect(budget.asWork({ kind: 'background' }, () => fetch('https://meta.test/v1/chat/completions'))).rejects.toThrow(/resting for a bit/);
    } finally {
      globalThis.fetch = real;
      (globalThis as any).__groupOsMetaGuard = false;
    }
  });
});
