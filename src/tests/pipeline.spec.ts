import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyProposals,
  quoteIsVerbatim,
  resolveConflict,
  validateProposal,
  Proposal,
} from '../engine/eventReducer';
import { heuristicProposals } from '../engine/localHeuristics';
import { ReconciliationEngine } from '../engine/reconciliationEngine';
import { extractWithMeta } from '../services/metaToolPipeline';
import { MetaModelService } from '../services/metaModelService';
import {
  INITIAL_COMMITMENTS,
  INITIAL_CONFLICTS,
  INITIAL_DECISIONS,
  INITIAL_EVIDENCE,
  INITIAL_NOTIFICATIONS,
  INITIAL_PERSONAL_TASKS,
  INITIAL_USER_PREFERENCES,
} from '../data/seedData';
import { GroupIntelligenceState, Message } from '../types/groupOs';
import { runAllAcceptanceTests } from './stateEngine.test';

const msg = (id: string, speakerName: string, content: string, conversationId = 'ws_t'): Message => ({
  id,
  conversationId,
  speakerId: `u_${speakerName.toLowerCase()}`,
  speakerName,
  timestamp: '10:00 AM',
  content,
  type: 'text',
  createdAt: 0,
});

const CHAT: Message[] = [
  msg('m1', 'Alex', "Let's leave for Goa on Friday morning."),
  msg('m2', 'Sam', 'Agreed, Friday morning works. I will book the villa tonight.'),
  msg('m3', 'Priya', "Sorry, I can't leave Friday. Saturday is the earliest."),
];

const empty = (): GroupIntelligenceState => ({
  decisions: [],
  commitments: [],
  conflicts: [],
  evidenceMap: {},
  history: [],
});

const ctx = (messages: Message[]) => ({
  conversationId: 'ws_t',
  messages,
  actor: 'model' as const,
  actorLabel: 'Meta test',
  now: '10:00 AM',
});

const decision = (
  value: string,
  status: 'proposed' | 'confirmed',
  messageId: string,
  quote: string,
  topic = 'Departure Date'
): Proposal => ({ kind: 'decision', topic, value, status, evidence: [{ messageId, quote }] });

describe('quote verification', () => {
  it('accepts verbatim text regardless of case, spacing and curly quotes', () => {
    expect(quoteIsVerbatim('i CAN’T leave friday', "Sorry, I can't leave Friday. Saturday is the earliest.")).toBe(true);
  });
  it('rejects paraphrases and invented words', () => {
    expect(quoteIsVerbatim('Priya refuses to travel on Friday', CHAT[2].content)).toBe(false);
  });
  it('rejects trivially short quotes', () => {
    expect(quoteIsVerbatim('ok', 'ok sounds good to me')).toBe(false);
  });
});

describe('validated reducer', () => {
  it('rejects unknown message ids and fabricated quotes without touching state', () => {
    const { state, results } = applyProposals(
      empty(),
      [
        decision('Friday', 'confirmed', 'm_nope', "Let's leave for Goa on Friday"),
        decision('Friday', 'confirmed', 'm1', 'Everyone paid ₹5000 already'),
      ],
      ctx(CHAT)
    );
    expect(results.every(r => !r.accepted)).toBe(true);
    expect(state.decisions).toHaveLength(0);
    expect(state.evidenceMap).toEqual({});
  });

  it('stores evidence ids that resolve in the evidence map (clickable citations)', () => {
    const { state } = applyProposals(
      empty(),
      [decision('Friday morning', 'proposed', 'm1', "Let's leave for Goa on Friday morning")],
      ctx(CHAT)
    );
    const d = state.decisions[0];
    expect(d.supportingEvidenceIds).toHaveLength(1);
    const ev = state.evidenceMap[d.supportingEvidenceIds[0]];
    expect(ev.messageId).toBe('m1');
    expect(ev.verificationStatus).toBe('supported');
  });

  it('is idempotent: re-running on the same messages creates no duplicates', () => {
    const proposals = [
      decision('Friday morning', 'proposed', 'm1', "Let's leave for Goa on Friday morning"),
      {
        kind: 'commitment',
        ownerName: 'Sam',
        description: 'Book the villa tonight',
        status: 'accepted',
        evidence: [{ messageId: 'm2', quote: 'I will book the villa tonight' }],
      } as Proposal,
    ];
    const once = applyProposals(empty(), proposals, ctx(CHAT)).state;
    const twice = applyProposals(once, proposals, ctx(CHAT)).state;
    expect(twice.decisions).toHaveLength(1);
    expect(twice.commitments).toHaveLength(1);
    expect(twice.decisions[0].history).toHaveLength(1);
  });

  it('never silently overwrites a confirmed decision: raises a conflict and keeps history', () => {
    let state = applyProposals(
      empty(),
      [decision('Friday morning', 'confirmed', 'm2', 'Agreed, Friday morning works')],
      ctx(CHAT)
    ).state;

    const res = applyProposals(
      state,
      [decision('Saturday', 'proposed', 'm3', 'Saturday is the earliest')],
      ctx(CHAT)
    );
    state = res.state;

    const d = state.decisions[0];
    expect(d.currentValue).toBe('Friday morning');
    expect(d.status).toBe('conflicted');
    expect(d.contradictingEvidenceIds).toHaveLength(1);
    expect(res.results[0].outcome).toBe('conflict_raised');
    expect(state.conflicts).toHaveLength(1);
    expect(state.conflicts[0].resolutionOptions?.map(o => o.actionType)).toEqual(['keep_current', 'adopt_proposal', 'different_subject']);
    expect(d.history.at(-1)?.reason).toMatch(/was already confirmed. The confirmed value was kept/);

    // Re-running does not stack duplicate conflicts.
    const again = applyProposals(
      state,
      [decision('Saturday', 'proposed', 'm3', 'Saturday is the earliest')],
      ctx(CHAT)
    ).state;
    expect(again.conflicts).toHaveLength(1);
  });

  it('resolving by adoption changes the value only through an explicit user action', () => {
    let state = applyProposals(
      empty(),
      [
        decision('Friday morning', 'confirmed', 'm2', 'Agreed, Friday morning works'),
        decision('Saturday', 'proposed', 'm3', 'Saturday is the earliest'),
      ],
      ctx(CHAT)
    ).state;
    const conflictId = state.conflicts[0].id;
    state = resolveConflict(state, conflictId, 'adopt_proposal', { now: '11:00 AM', actorLabel: 'Alex' });

    const d = state.decisions[0];
    expect(d.currentValue).toBe('Saturday');
    expect(d.status).toBe('confirmed');
    expect(d.history.at(-1)).toMatchObject({ previousValue: 'Friday morning', newValue: 'Saturday', actorType: 'user' });
    expect(state.conflicts[0].status).toBe('resolved');
  });

  it('advances commitment status forward only', () => {
    const base = (status: 'accepted' | 'completed'): Proposal => ({
      kind: 'commitment',
      ownerName: 'Sam',
      description: 'Book the villa tonight',
      status,
      evidence: [{ messageId: 'm2', quote: 'I will book the villa tonight' }],
    });
    let state = applyProposals(empty(), [base('completed')], ctx(CHAT)).state;
    state = applyProposals(state, [base('accepted')], ctx(CHAT)).state;
    expect(state.commitments).toHaveLength(1);
    expect(state.commitments[0].status).toBe('completed');
  });

  it('flag_conflict against a confirmed decision marks it conflicted without changing its value', () => {
    const state = applyProposals(
      empty(),
      [
        decision('Friday morning', 'confirmed', 'm2', 'Agreed, Friday morning works'),
        {
          kind: 'conflict',
          topic: 'Departure Date',
          description: "Priya can't leave Friday",
          evidence: [{ messageId: 'm3', quote: "I can't leave Friday" }],
        },
      ],
      ctx(CHAT)
    ).state;
    expect(state.decisions[0]).toMatchObject({ currentValue: 'Friday morning', status: 'conflicted' });
    expect(state.conflicts[0].relatedDecisionIds).toContain(state.decisions[0].id);
  });

  it('validateProposal requires evidence', () => {
    const byId = new Map(CHAT.map(m => [m.id, m]));
    const r = validateProposal({ kind: 'conflict', topic: 't', description: 'd', evidence: [] }, byId);
    expect(r.ok).toBe(false);
  });
});

describe('local heuristic fallback', () => {
  it('only produces proposals whose quotes verify, and never fabricates a conflict between topics', () => {
    const chat = [
      msg('a', 'Ananya', 'Agreed on 8k budget cap per person.'),
      msg('b', 'Sneha', 'I took responsibility for booking the cottage. Done!'),
      msg('c', 'Rohan', 'My manager denied Friday leave, I cannot travel Thursday night.'),
    ];
    const proposals = heuristicProposals(chat);
    const { state, results } = applyProposals(empty(), proposals, ctx(chat));
    expect(results.every(r => r.accepted)).toBe(true);
    expect(state.commitments[0]).toMatchObject({ ownerName: 'Sneha', status: 'completed' });
    expect(state.conflicts.length).toBeGreaterThan(0);
    expect(state.decisions.every(d => d.status !== 'conflicted')).toBe(true);
  });

  it('does not treat "I have a question" as a commitment', () => {
    const proposals = heuristicProposals([msg('q', 'Dev', 'I have a question about the Wi-Fi password.')]);
    expect(proposals.filter(p => p.kind === 'commitment')).toHaveLength(0);
  });
});

describe('reconciliation engine regressions', () => {
  it('confirming Saturday keeps every existing commitment', () => {
    const res = ReconciliationEngine.confirmSaturdayDeparture(
      INITIAL_DECISIONS,
      INITIAL_COMMITMENTS,
      INITIAL_CONFLICTS,
      INITIAL_EVIDENCE,
      INITIAL_PERSONAL_TASKS,
      INITIAL_NOTIFICATIONS,
      INITIAL_USER_PREFERENCES.u_alex
    );
    expect(res.commitments).toHaveLength(INITIAL_COMMITMENTS.length);
    expect(INITIAL_COMMITMENTS.length).toBeGreaterThan(0);
  });

  const run = (conversationId: string, speakerName: string, content: string) =>
    ReconciliationEngine.processNewMessage(
      msg('m_x', speakerName, content, conversationId),
      INITIAL_DECISIONS,
      INITIAL_COMMITMENTS,
      INITIAL_CONFLICTS,
      INITIAL_EVIDENCE,
      INITIAL_PERSONAL_TASKS,
      INITIAL_NOTIFICATIONS,
      INITIAL_USER_PREFERENCES.u_alex
    );

  it('an unrelated "impossible" in the Goa chat does not trigger the departure conflict', () => {
    const res = run('ws_goa', 'Sam', 'Finding a cheap flight in November is nearly impossible.');
    expect(res.evidenceMap['ev_m_x']).toBeUndefined();
  });

  it('"I sent the file" in the flat chat is not a payment claim', () => {
    const res = run('ws_flat', 'Arjun', 'I sent the file to the landlord.');
    expect(res.evidenceMap['ev_m_x']).toBeUndefined();
  });

  it('"paid via UPI" in the flat chat is registered as an unverified claim', () => {
    const res = run('ws_flat', 'Arjun', 'Paid my share via UPI.');
    expect(res.evidenceMap['ev_m_x']?.verificationStatus).toBe('claimed_unverified');
  });
});

describe('Meta tool-calling loop (mocked endpoint)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const call = (id: string, name: string, args: object) => ({
    id,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  });
  const reply = (message: object) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 20 } }),
    text: async () => '',
  });

  it('feeds validator verdicts back so the model can fix a bad citation', async () => {
    const bodies: any[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async (_url: string, init: any) => {
        bodies.push(JSON.parse(init.body));
        return reply({
          role: 'assistant',
          content: null,
          tool_calls: [
            call('c1', 'record_decision', {
              topic: 'Departure Date',
              value: 'Friday morning',
              status: 'confirmed',
              evidence: [{ messageId: 'm2', quote: 'Everyone agreed unanimously on Friday' }],
            }),
          ],
        });
      })
      .mockImplementationOnce(async (_url: string, init: any) => {
        bodies.push(JSON.parse(init.body));
        return reply({
          role: 'assistant',
          content: null,
          tool_calls: [
            call('c2', 'record_decision', {
              topic: 'Departure Date',
              value: 'Friday morning',
              status: 'confirmed',
              evidence: [{ messageId: 'm2', quote: 'Agreed, Friday morning works' }],
            }),
          ],
        });
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await extractWithMeta('test-key', CHAT, []);

    expect(result.mode).toBe('tools');
    expect(result.rounds).toBe(2);
    expect(result.proposals).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toMatch(/not verbatim/);
    expect(result.tokens).toEqual({ prompt: 200, completion: 40 });

    // Round 2 carried the rejection back as a tool result.
    const toolMsg = bodies[1].messages.find((m: any) => m.role === 'tool');
    expect(toolMsg.tool_call_id).toBe('c1');
    expect(JSON.parse(toolMsg.content).status).toBe('rejected');

    // The API key goes in the Authorization header only, never in the body.
    expect(JSON.stringify(bodies)).not.toContain('test-key');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-key');
  });

  it('falls back to JSON mode when the endpoint rejects the tools field', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ error: { message: 'tools is not supported' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  proposals: [
                    {
                      kind: 'commitment',
                      ownerName: 'Sam',
                      description: 'Book the villa',
                      status: 'accepted',
                      evidence: [{ messageId: 'm2', quote: 'I will book the villa tonight' }],
                    },
                    {
                      kind: 'commitment',
                      ownerName: 'Sam',
                      description: 'Pay everyone back',
                      status: 'accepted',
                      evidence: [{ messageId: 'm2', quote: 'I will pay everyone back' }],
                    },
                  ],
                }),
              },
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await extractWithMeta('k', CHAT, []);
    expect(result.mode).toBe('json');
    expect(result.proposals).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });

  it('surfaces non-recoverable API errors instead of faking a result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'bad key' } }) })
    );
    await expect(extractWithMeta('k', CHAT, [])).rejects.toThrow('bad key');
  });
});

describe('original acceptance tests', () => {
  it('all in-app acceptance tests still pass', () => {
    const failed = runAllAcceptanceTests().filter(t => !t.passed);
    expect(failed.map(t => `${t.code}: ${t.details}`)).toEqual([]);
  });
});

describe('escalation when the model answers in prose', () => {
  afterEach(() => vi.unstubAllGlobals());

  const ok = (message: object, extra: object = {}) => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 }, ...extra }),
    text: async () => '',
  });
  const prose = () => ok({ role: 'assistant', content: 'Here is a summary of the plan for the Goa trip.' });
  const toolCall = () =>
    ok({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: {
            name: 'record_commitment',
            arguments: JSON.stringify({
              ownerName: 'Sam',
              description: 'Book the villa',
              status: 'accepted',
              evidence: [{ messageId: 'm2', quote: 'I will book the villa tonight' }],
            }),
          },
        },
      ],
    });
  const jsonReply = () =>
    ok({
      role: 'assistant',
      content: JSON.stringify({
        proposals: [
          {
            kind: 'commitment',
            ownerName: 'Sam',
            description: 'Book the villa',
            status: 'accepted',
            evidence: [{ messageId: 'm2', quote: 'I will book the villa tonight' }],
          },
        ],
      }),
    });

  it('retries once with tool_choice "required" after a prose answer', async () => {
    const bodies: any[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_u: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return bodies.length === 1 ? prose() : toolCall();
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await extractWithMeta('k', CHAT, []);

    expect(bodies[0].tool_choice).toBe('auto');
    expect(bodies[1].tool_choice).toBe('required');
    expect(result.mode).toBe('tools');
    expect(result.proposals).toHaveLength(1);
    expect(result.note).toMatch(/forced tool use/);
  });

  it('falls back to JSON mode when the model keeps refusing tools, and explains why', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(prose())
      .mockResolvedValueOnce(prose())
      .mockResolvedValueOnce(jsonReply());
    vi.stubGlobal('fetch', fetchMock);

    const result = await extractWithMeta('k', CHAT, []);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.mode).toBe('json');
    expect(result.proposals).toHaveLength(1);
    expect(result.note).toMatch(/would not call tools.*finish_reason=stop.*content="Here is a summary/);
  });

  it('when nothing yields structure, the error shows what the model actually returned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => prose()));
    await expect(extractWithMeta('k', CHAT, [])).rejects.toThrow(/did not return JSON.*content="Here is a summary/);
  });

  it('accepts a JSON proposal list when the model skips tools but still returns valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonReply()));
    const result = await extractWithMeta('k', CHAT, []);
    expect(result.mode).toBe('json');
    expect(result.proposals).toHaveLength(1);
  });
});

describe('reasoning budget', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    MetaModelService.reasoningEffortSupported = true;
  });

  const ok = (message: object, finish_reason = 'stop') => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message, finish_reason }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    text: async () => '',
  });
  const toolReply = () =>
    ok(
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: {
              name: 'record_commitment',
              arguments: JSON.stringify({
                ownerName: 'Sam',
                description: 'Book the villa',
                status: 'accepted',
                evidence: [{ messageId: 'm2', quote: 'I will book the villa tonight' }],
              }),
            },
          },
        ],
      },
      'tool_calls'
    );

  it('asks for low reasoning effort and a roomy limit, then retries leaner when the budget runs out', async () => {
    const bodies: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_u: string, init: any) => {
        bodies.push(JSON.parse(init.body));
        // First reply: all tokens spent on hidden reasoning, empty content.
        return bodies.length === 1 ? ok({ role: 'assistant', content: '' }, 'length') : toolReply();
      })
    );

    const result = await extractWithMeta('k', CHAT, []);

    expect(bodies[0]).toMatchObject({ reasoning_effort: 'low', max_tokens: 12000, tool_choice: 'auto' });
    expect(bodies[1]).toMatchObject({ reasoning_effort: 'minimal', max_tokens: 16000, tool_choice: 'required' });
    expect(result.proposals).toHaveLength(1);
    expect(result.note).toMatch(/ran out of tokens while reasoning/);
    expect(bodies).toHaveLength(2); // did not burn a third identical request before succeeding
  });

  it('stops sending reasoning_effort if the endpoint rejects that parameter', async () => {
    const bodies: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (_u: string, init: any) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        if (body.reasoning_effort) {
          return { ok: false, status: 400, text: async () => JSON.stringify({ error: { message: 'Unknown parameter: reasoning_effort' } }) };
        }
        return toolReply();
      })
    );

    const result = await extractWithMeta('k', CHAT, []);
    expect(result.proposals).toHaveLength(1);
    expect(bodies[0].reasoning_effort).toBe('low');
    expect(bodies[1].reasoning_effort).toBeUndefined();
  });
});

describe('second look at payments the model skipped', () => {
  afterEach(() => vi.unstubAllGlobals());
  const msg = (id: string, speakerName: string, content: string): Message => ({ id, conversationId: 'flat', speakerId: `p_${speakerName.toLowerCase()}`, speakerName, timestamp: '10:00', content, type: 'text', createdAt: 0 });
  const chat = [
    msg('m1', 'Kruthik', 'rent 54000 hai, 18000 each mujhe bhej dena'),
    msg('m2', 'Swapnil', 'bhai 18000 bhej diya Kruthik ko'),
    msg('m3', 'Kruthik', 'haan aa gaya 18k, received'),
  ];
  const ok = (message: object) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), text: async () => '' });
  const call = (id: string, args: object) => ({ id, type: 'function', function: { name: 'record_commitment', arguments: JSON.stringify(args) } });

  it('points the model at payment messages nothing was recorded from, and records what it finds', async () => {
    const bodies: any[] = [];
    const replies = [
      ok({ role: 'assistant', content: null, tool_calls: [call('c1', { ownerName: 'Swapnil', payee: 'Kruthik', amount: 18000, description: 'Pay 18000 rent share to Kruthik', status: 'accepted', evidence: [{ messageId: 'm1', quote: '18000 each mujhe bhej dena' }] })] }),
      ok({ role: 'assistant', content: null, tool_calls: [call('c2', { ownerName: 'Swapnil', payee: 'Kruthik', amount: 18000, description: 'Pay 18000 rent share to Kruthik', status: 'completed', receivedConfirmed: true, evidence: [{ messageId: 'm3', quote: 'haan aa gaya 18k, received' }] })] }),
      ok({ role: 'assistant', content: 'none' }),
    ];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => (bodies.push(JSON.parse(init.body)), replies.shift() ?? ok({ role: 'assistant', content: 'none' }))));

    const result = await extractWithMeta('k', chat, []);
    const asked = bodies[1].messages.at(-1).content as string;
    expect(asked).toMatch(/money was sent, paid, received or is owed/);
    expect(asked).toContain('m2');
    expect(asked).toContain('m3');
    expect(asked).not.toContain('m1,');
    expect(result.proposals.some((p: any) => p.kind === 'commitment' && p.status === 'completed' && p.receivedConfirmed)).toBe(true);
  });
});
