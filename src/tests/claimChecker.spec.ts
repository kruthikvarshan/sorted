import { afterEach, describe, expect, it, vi } from 'vitest';
import { Proposal } from '../engine/eventReducer';
import { applyChecks, buildCheckPrompt, checkClaims, parseChecks } from '../services/claimChecker';
import { extractWithMeta } from '../services/metaToolPipeline';
import { Message } from '../types/groupOs';

const msg = (id: string, speakerName: string, content: string): Message => ({ id, conversationId: 'w', speakerId: `u_${speakerName}`, speakerName, timestamp: '9:00', content, type: 'text', createdAt: 0 });
const CHAT = [msg('m1', 'Rohit', 'WiFi ka bill 1200 aaya'), msg('m2', 'Zoya', 'haan 2400, main meter reading check karungi')];

const wifiTotalWrong: Proposal = { kind: 'decision', topic: 'WiFi bill total', value: '2400', status: 'confirmed', evidence: [{ messageId: 'm2', quote: 'haan 2400' }] };
const wifiTotalRight: Proposal = { kind: 'decision', topic: 'WiFi bill total', value: '1200', status: 'confirmed', evidence: [{ messageId: 'm1', quote: 'WiFi ka bill 1200 aaya' }] };
const meter: Proposal = { kind: 'commitment', ownerName: 'Zoya', description: 'Check the meter reading', status: 'accepted', evidence: [{ messageId: 'm2', quote: 'main meter reading check karungi', translation: "I'll check the meter reading" }] };

describe('what the fact-checker is shown', () => {
  const [system, user] = buildCheckPrompt([wifiTotalWrong, meter]);
  it('is told to be strict about subject, number and person, and to judge only from the quotes', () => {
    expect(system.content).toMatch(/SUPPORT the claim: the same subject/);
    expect(system.content).toMatch(/Judge only from the quotes/);
  });
  it('gets each numbered claim with only its own quotes and meanings', () => {
    expect(user.content).toContain('0. Decision "WiFi bill total" is "2400" (confirmed)');
    expect(user.content).toContain('- "haan 2400"');
    expect(user.content).toContain('1. Zoya promised: Check the meter reading (accepted)');
    expect(user.content).toContain("(meaning: I'll check the meter reading)");
    expect(user.content).not.toContain('WiFi ka bill 1200'); // another claim's quote is not leaked into these
  });
});

describe('reading and applying the verdicts', () => {
  it('parses fenced JSON and ignores entries it cannot use', () => {
    const checks = parseChecks('```json\n{"results":[{"id":0,"verdict":"unsupported","reason":"about electricity"},{"id":9,"verdict":"supported"},{"id":1,"verdict":"maybe"}]}\n```', 2);
    expect(checks).toEqual([{ id: 0, verdict: 'unsupported', reason: 'about electricity' }]);
    expect(parseChecks('not json', 2)).toBeNull();
    expect(parseChecks('{"results":"x"}', 2)).toBeNull();
  });

  it('drops only what is unsupported, and says why', () => {
    const out = applyChecks([wifiTotalWrong, wifiTotalRight, meter], [
      { id: 0, verdict: 'unsupported', reason: 'the quote is about the electricity bill' },
      { id: 1, verdict: 'supported', reason: '' },
      { id: 2, verdict: 'unclear', reason: 'ambiguous' },
    ]);
    expect(out.kept).toEqual([wifiTotalRight, meter]); // unclear is kept
    expect(out.dropped).toEqual([expect.objectContaining({ reason: expect.stringMatching(/do not support this: the quote is about the electricity bill/) })]);
  });

  it('distrusts the checker when it rejects almost everything, and keeps all', () => {
    const many = [wifiTotalWrong, wifiTotalRight, meter, wifiTotalWrong, meter];
    const checks = many.map((_, id) => ({ id, verdict: 'unsupported' as const, reason: 'x' }));
    const out = applyChecks(many, checks);
    expect(out.kept).toHaveLength(5);
    expect(out.ignored).toBe(true);
  });

  it('keeps everything when there are no usable verdicts', () => {
    expect(applyChecks([wifiTotalWrong], null).kept).toEqual([wifiTotalWrong]);
  });
});

describe('the pass inside extraction', () => {
  afterEach(() => vi.unstubAllGlobals());
  const toolReply = (calls: Proposal[]) => ({
    ok: true, status: 200,
    json: async () => ({
      choices: [{ message: { role: 'assistant', content: null, tool_calls: calls.map((p, i) => ({ id: `c${i}`, type: 'function', function: {
        name: p.kind === 'decision' ? 'record_decision' : 'record_commitment',
        arguments: JSON.stringify(p.kind === 'decision' ? { topic: p.topic, value: p.value, status: p.status, evidence: p.evidence } : { ownerName: (p as any).ownerName, description: (p as any).description, status: (p as any).status, evidence: p.evidence }),
      } })) }, finish_reason: 'tool_calls' }],
    }),
  });
  const textReply = (content: string) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });
  const run = (replies: object[], verifyClaims: boolean) => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_u: string, init: any) => { bodies.push(JSON.parse(init.body)); return replies[Math.min(bodies.length - 1, replies.length - 1)]; }));
    return { bodies, go: () => extractWithMeta('k', CHAT, [], { verifyClaims }) };
  };

  it('removes a result whose quote is about something else, and reports it as ignored', async () => {
    const { bodies, go } = run([
      toolReply([wifiTotalWrong, wifiTotalRight, meter]),
      textReply(JSON.stringify({ results: [{ id: 0, verdict: 'unsupported', reason: 'the quote is about the electricity bill' }, { id: 1, verdict: 'supported', reason: '' }, { id: 2, verdict: 'supported', reason: '' }] })),
    ], true);
    const result = await go();
    expect(bodies).toHaveLength(2);
    expect(result.proposals.map(p => (p.kind === 'decision' ? p.value : p.kind))).toEqual(['1200', 'commitment']);
    expect(result.rejected[0].reason).toMatch(/do not support this/);
    expect(result.checked).toMatchObject({ claims: 3, dropped: 1, ignored: false, failed: false });
  });

  it('does not run at all unless asked', async () => {
    const { bodies, go } = run([toolReply([wifiTotalWrong])], false);
    const result = await go();
    expect(bodies).toHaveLength(1);
    expect(result.checked).toBeUndefined();
  });

  it('keeps every result when the checker call fails, and says it failed', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_u: string, init: any) => {
      bodies.push(init.body);
      return bodies.length === 1 ? toolReply([wifiTotalWrong, meter]) : { ok: false, status: 500, text: async () => 'boom' };
    }));
    const result = await extractWithMeta('k', CHAT, [], { verifyClaims: true });
    expect(result.proposals).toHaveLength(2);
    expect(result.checked).toMatchObject({ failed: true, dropped: 0 });
  });

  it('keeps everything when the checker replies with something unreadable', async () => {
    const { go } = run([toolReply([wifiTotalWrong, meter]), textReply('Looks fine to me!')], true);
    const result = await go();
    expect(result.proposals).toHaveLength(2);
    expect(result.checked).toMatchObject({ failed: true });
  });

  it('checkClaims reports an API error instead of throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'bad key' } }) }));
    expect(await checkClaims('k', [wifiTotalWrong])).toMatchObject({ success: false, error: 'bad key' });
  });
});
