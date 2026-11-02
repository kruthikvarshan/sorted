import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyProposals, Proposal } from '../engine/eventReducer';
import { extractWithMeta } from '../services/metaToolPipeline';
import { GroupIntelligenceState, Message } from '../types/groupOs';

const msg = (id: string, speakerName: string, content: string): Message => ({
  id, conversationId: 'w', speakerId: `u_${speakerName}`, speakerName, timestamp: '9:00', content, type: 'text', createdAt: 0,
});
const CHAT = [
  msg('r1', 'Aman', 'haan pakka, 9000 each'),
  msg('w1', 'Rohit', 'WiFi ka bill 1200 aaya, split karna hai?'),
  msg('w2', 'Zoya', 'haan 300 each, main pay kar deti hoon'),
];
const empty = (): GroupIntelligenceState => ({ decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [] });

// The group already holds "Rent share per person: 9000 each" (confirmed, said by Aman).
const rentKnown = (): GroupIntelligenceState =>
  applyProposals(
    empty(),
    [{ kind: 'decision', topic: 'Rent share per person', value: '9000 each', status: 'confirmed', evidence: [{ messageId: 'r1', quote: 'haan pakka, 9000 each' }] }],
    { conversationId: 'w', messages: CHAT, actor: 'model', actorLabel: 't', now: '9:00' }
  ).state;

const decisionCall = (id: string, topic: string, value: string, extra: object = {}) => ({
  id, type: 'function',
  function: { name: 'record_decision', arguments: JSON.stringify({ topic, value, status: 'proposed', evidence: [{ messageId: 'w2', quote: 'haan 300 each' }], ...extra }) },
});
const reply = (calls: object[] | null, content: string | null = null) => ({
  ok: true, status: 200,
  json: async () => ({ choices: [{ message: { role: 'assistant', content, tool_calls: calls ?? undefined }, finish_reason: calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
});

describe('asking "is this the same thing?" before raising a conflict', () => {
  afterEach(() => vi.unstubAllGlobals());

  const run = (responses: object[]) => {
    const bodies: any[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_u: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return responses[Math.min(bodies.length - 1, responses.length - 1)];
    });
    vi.stubGlobal('fetch', fetchMock);
    return { bodies, go: () => extractWithMeta('k', CHAT, [], { state: rentKnown() }) };
  };

  it('holds a would-be contradiction, and a more specific topic from the model avoids the false conflict', async () => {
    const { bodies, go } = run([
      reply([decisionCall('c1', 'Rent share per person', '300 each')]),
      reply([decisionCall('c2', 'WiFi bill share', '300 each')]),
    ]);
    const result = await go();

    const verdict = JSON.parse(bodies[1].messages.find((m: any) => m.role === 'tool').content);
    expect(verdict.status).toBe('needs_review');
    expect(verdict.reason).toMatch(/"Rent share per person" is "9000 each"/);
    expect(verdict.reason).toMatch(/more specific topic/);

    const topics = result.proposals.map(p => (p.kind === 'decision' ? p.topic : ''));
    expect(topics).toEqual(['WiFi bill share']);
    // Applying it now raises no conflict against rent.
    const applied = applyProposals(rentKnown(), result.proposals, { conversationId: 'w', messages: CHAT, actor: 'model', actorLabel: 't', now: '9:01' }).state;
    expect(applied.conflicts).toHaveLength(0);
    expect(applied.decisions.find(d => d.topic === 'Rent share per person')?.status).toBe('confirmed');
    expect(result.rounds).toBe(2);
  });

  it('still raises the conflict when the model says it really is the same subject', async () => {
    const { go } = run([
      reply([decisionCall('c1', 'Rent share per person', '300 each')]),
      reply([decisionCall('c2', 'Rent share per person', '300 each', { sameSubject: true })]),
    ]);
    const result = await go();
    expect(result.proposals).toHaveLength(1);
    const applied = applyProposals(rentKnown(), result.proposals, { conversationId: 'w', messages: CHAT, actor: 'model', actorLabel: 't', now: '9:01' }).state;
    expect(applied.conflicts).toHaveLength(1);
    expect(applied.decisions[0].status).toBe('conflicted');
  });

  it('keeps the contradiction if the model never clarifies, rather than silently dropping it', async () => {
    const { go } = run([reply([decisionCall('c1', 'Rent share per person', '300 each')]), reply(null, 'Done.')]);
    const result = await go();
    expect(result.proposals).toHaveLength(1);
  });

  it('adds no extra round when nothing contradicts', async () => {
    const { bodies, go } = run([reply([decisionCall('c1', 'WiFi bill share', '300 each')])]);
    const result = await go();
    expect(bodies).toHaveLength(1);
    expect(result.proposals).toHaveLength(1);
  });

  it('does not question an explicit, agreed change (that is a supersession, not a conflict)', async () => {
    const agreed = decisionCall('c1', 'Rent share per person', '8000 each', {
      status: 'confirmed',
      evidence: [{ messageId: 'r1', quote: 'haan pakka, 9000 each' }],
    });
    const { bodies, go } = run([reply([agreed])]);
    const result = await go();
    expect(bodies).toHaveLength(1); // Aman changing his own confirmed value goes straight through
    expect(result.proposals).toHaveLength(1);
  });
});

describe('the same message filed under two topics (the live Flat 7B failure)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const run = (responses: object[]) => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_u: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return responses[Math.min(bodies.length - 1, responses.length - 1)];
    }));
    return { bodies, go: () => extractWithMeta('k', CHAT, [], { state: rentKnown() }) };
  };
  const rentWrong = () => decisionCall('r', 'Rent share per person', '300 each');
  const wifiRight = () => decisionCall('w', 'WiFi bill share', '300 each');

  it('drops the misfiled copy when the right topic was already recorded in the same reading', async () => {
    const { bodies, go } = run([reply([wifiRight(), rentWrong()])]);
    const result = await go();
    expect(result.proposals.map(p => (p.kind === 'decision' ? p.topic : ''))).toEqual(['WiFi bill share']);
    expect(bodies).toHaveLength(1); // no extra question was needed
    const applied = applyProposals(rentKnown(), result.proposals, { conversationId: 'w', messages: CHAT, actor: 'model', actorLabel: 't', now: '9:01' }).state;
    expect(applied.conflicts).toHaveLength(0);
  });

  it('drops it when the right topic arrives after the held one', async () => {
    const { go } = run([reply([rentWrong(), wifiRight()])]);
    const result = await go();
    expect(result.proposals.map(p => (p.kind === 'decision' ? p.topic : ''))).toEqual(['WiFi bill share']);
  });

  it('asks again, explicitly, if the model goes quiet with a question unanswered', async () => {
    const { bodies, go } = run([reply([rentWrong()]), reply(null, 'Done.'), reply([decisionCall('w2', 'WiFi bill share', '300 each')])]);
    const result = await go();
    const lastUser = bodies[2].messages.filter((m: any) => m.role === 'user').at(-1).content as string;
    expect(lastUser).toMatch(/You have not answered for: "Rent share per person: 300 each"/);
    expect(lastUser).toMatch(/sameSubject true/);
    expect(result.proposals.map(p => (p.kind === 'decision' ? p.topic : ''))).toEqual(['WiFi bill share']);
  });

  it('still keeps the contradiction if the model is asked twice and never answers', async () => {
    const { go } = run([reply([rentWrong()]), reply(null, 'Done.'), reply(null, 'Done.')]);
    expect((await go()).proposals).toHaveLength(1);
  });
});
