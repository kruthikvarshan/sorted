import { describe, expect, it } from 'vitest';
import { applyProposals, quoteIsVerbatim, Proposal, topicsMatch, valueKind } from '../engine/eventReducer';
import { GroupIntelligenceState, Message } from '../types/groupOs';

const msg = (id: string, speakerName: string, content: string): Message => ({
  id, conversationId: 'w', speakerId: `u_${speakerName}`, speakerName, timestamp: '9:00', content, type: 'text', createdAt: 0,
});
const CHAT = [
  msg('a', 'Dana', 'Lisbon it is, Nov 12-14, locked.'),
  msg('b', 'Priya', 'Actually can we do Austin instead?'),
  msg('c', 'Hannah', 'On it'),
  msg('d', 'Leo', 'I am on it now, give me a minute'),
];
const empty = (): GroupIntelligenceState => ({ decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [] });
const ctx = { conversationId: 'w', messages: CHAT, actor: 'model' as const, actorLabel: 't', now: '9:00' };

const lisbon: Proposal = { kind: 'decision', topic: 'Offsite city', value: 'Lisbon', status: 'confirmed', evidence: [{ messageId: 'a', quote: 'Lisbon it is, Nov 12-14, locked' }] };
const austin: Proposal = { kind: 'decision', topic: 'Offsite city', value: 'Austin', status: 'proposed', evidence: [{ messageId: 'b', quote: 'can we do Austin instead' }] };

describe('short quotes', () => {
  it('accepts a very short quote when it is the whole message', () => {
    expect(quoteIsVerbatim('On it', CHAT[2].content)).toBe(true);
  });
  it('rejects the same short quote when it is only a fragment of a longer message', () => {
    expect(quoteIsVerbatim('on it', CHAT[3].content)).toBe(false);
  });
  it('rejects empty and punctuation-only quotes', () => {
    expect(quoteIsVerbatim('', CHAT[0].content)).toBe(false);
    expect(quoteIsVerbatim('...', CHAT[0].content)).toBe(false);
  });
});

describe('chronological application', () => {
  const finalOf = (list: Proposal[]) => {
    const { state } = applyProposals(empty(), list, ctx);
    const d = state.decisions[0];
    return { value: d.currentValue, status: d.status, conflicts: state.conflicts.length };
  };

  it('gives the same result whichever order the model lists a decision and its later contradiction', () => {
    const inOrder = finalOf([lisbon, austin]);
    const reversed = finalOf([austin, lisbon]);
    expect(inOrder).toEqual({ value: 'Lisbon', status: 'conflicted', conflicts: 1 });
    expect(reversed).toEqual(inOrder);
  });

  it('older evidence replayed after newer state cannot contradict it', () => {
    let { state } = applyProposals(empty(), [lisbon, austin], ctx);
    const before = JSON.stringify(state.conflicts.map(c => c.id));
    state = applyProposals(state, [lisbon, austin], ctx).state; // a second full reading of the same chat
    expect(state.decisions).toHaveLength(1);
    expect(JSON.stringify(state.conflicts.map(c => c.id))).toBe(before);
  });

  it('a stale proposal is ignored instead of rewriting a decision that rests on newer evidence', () => {
    const newer: Proposal = { kind: 'decision', topic: 'Offsite city', value: 'Austin', status: 'proposed', evidence: [{ messageId: 'b', quote: 'can we do Austin instead' }] };
    const older: Proposal = { kind: 'decision', topic: 'Offsite city', value: 'Lisbon', status: 'proposed', evidence: [{ messageId: 'a', quote: 'Lisbon it is, Nov 12-14' }] };
    let { state } = applyProposals(empty(), [newer], ctx);
    const res = applyProposals(state, [older], ctx);
    expect(res.state.decisions[0].currentValue).toBe('Austin');
    expect(res.results[0]).toMatchObject({ accepted: true, outcome: 'unchanged' });
  });
});

describe('explicit supersession versus conflict', () => {
  const CH = [
    msg('s1', 'Dana', 'We start at 9 sharp.'),
    msg('s2', 'Leo', 'The venue says 10, not 9.'),
    msg('s3', 'Dana', 'Ok, then 10 it is.'),
    msg('s4', 'Priya', 'No way, I say 8.'),
  ];
  const c = { conversationId: 'w', messages: CH, actor: 'model' as const, actorLabel: 't', now: '9:00' };
  const nine: Proposal = { kind: 'decision', topic: 'Start time', value: '9', status: 'confirmed', evidence: [{ messageId: 's1', quote: 'We start at 9 sharp' }] };
  const base = (): GroupIntelligenceState => applyProposals(empty(), [nine], c).state;

  it('two people agreeing to the change supersede it and keep the old value in history', () => {
    const change: Proposal = { kind: 'decision', topic: 'Start time', value: '10', status: 'confirmed',
      evidence: [{ messageId: 's2', quote: 'The venue says 10, not 9' }, { messageId: 's3', quote: 'Ok, then 10 it is' }] };
    const { state, results } = applyProposals(base(), [change], c);
    const d = state.decisions[0];
    expect(results[0].outcome).toBe('updated');
    expect([d.currentValue, d.status, state.conflicts.length]).toEqual(['10', 'confirmed', 0]);
    expect(d.history.at(-1)).toMatchObject({ previousValue: '9', newValue: '10' });
  });

  it('the person who set a value may change it themselves', () => {
    const own: Proposal = { kind: 'decision', topic: 'Start time', value: '10', status: 'confirmed', evidence: [{ messageId: 's3', quote: 'Ok, then 10 it is' }] };
    expect(applyProposals(base(), [own], c).state.decisions[0].currentValue).toBe('10');
  });

  it('a different single person cannot change a confirmed value, even if the model says confirmed', () => {
    const other: Proposal = { kind: 'decision', topic: 'Start time', value: '8', status: 'confirmed', evidence: [{ messageId: 's4', quote: 'I say 8' }] };
    const { state } = applyProposals(base(), [other], c);
    expect([state.decisions[0].currentValue, state.decisions[0].status, state.conflicts.length]).toEqual(['9', 'conflicted', 1]);
  });

  it('a mere proposal never supersedes, whoever made it and however many people cite it', () => {
    const maybe: Proposal = { kind: 'decision', topic: 'Start time', value: '10', status: 'proposed',
      evidence: [{ messageId: 's2', quote: 'The venue says 10, not 9' }, { messageId: 's3', quote: 'Ok, then 10 it is' }] };
    const { state } = applyProposals(base(), [maybe], c);
    expect([state.decisions[0].currentValue, state.decisions[0].status]).toEqual(['9', 'conflicted']);
  });
});

describe('"these are different things" resolution', () => {
  const CH2 = [
    msg('a', 'Aman', 'haan pakka, 9000 each'),
    msg('b', 'Zoya', 'haan 300 each, main pay kar deti hoon'),
  ];
  const c2 = { conversationId: 'w', messages: CH2, actor: 'model' as const, actorLabel: 't', now: '9:00' };
  const rent: Proposal = { kind: 'decision', topic: 'Rent share per person', value: '9000 each', status: 'confirmed', evidence: [{ messageId: 'a', quote: 'haan pakka, 9000 each' }] };
  const wifi: Proposal = { kind: 'decision', topic: 'Rent share per person', value: '300 each', status: 'proposed', evidence: [{ messageId: 'b', quote: 'haan 300 each' }] };
  const falseConflict = () => applyProposals(empty(), [rent, wifi], c2).state;

  it('starts from the false conflict the extractor used to create', () => {
    const s = falseConflict();
    expect([s.decisions[0].status, s.conflicts[0].status]).toEqual(['conflicted', 'open']);
  });

  it('dismisses it, restores the original, and keeps the other value as its own item', async () => {
    const { resolveConflict } = await import('../engine/eventReducer');
    const before = falseConflict();
    const after = resolveConflict(before, before.conflicts[0].id, 'different_subject', { now: '10:00', actorLabel: 'Alex' });

    expect(after.conflicts[0].status).toBe('dismissed');
    const original = after.decisions.find(d => d.topic === 'Rent share per person')!;
    expect([original.currentValue, original.status, original.contradictingEvidenceIds, original.needsClarification]).toEqual(['9000 each', 'confirmed', [], false]);

    const separate = after.decisions.find(d => d.topic === 'Rent share per person (separate item)')!;
    expect([separate.currentValue, separate.status]).toEqual(['300 each', 'proposed']);
    expect(separate.supportingEvidenceIds).toEqual(before.decisions[0].contradictingEvidenceIds); // the evidence moved with the value
    expect(separate.history[0].reason).toMatch(/Split out of "Rent share per person" by Alex/);
    expect(original.history.at(-1)?.reason).toMatch(/different thing/);
  });

  it('works for a conflict stored before this option existed (no resolutionOptions entry for it)', async () => {
    const { resolveConflict } = await import('../engine/eventReducer');
    const old = falseConflict();
    old.conflicts[0].resolutionOptions = old.conflicts[0].resolutionOptions?.filter(o => o.actionType !== 'different_subject');
    const after = resolveConflict(old, old.conflicts[0].id, 'different_subject', { now: '10:00', actorLabel: 'Alex' });
    expect(after.decisions).toHaveLength(2);
  });

  it('only dismisses when the conflict has no competing value to split out', async () => {
    const { resolveConflict } = await import('../engine/eventReducer');
    const withConstraint = applyProposals(empty(), [{ kind: 'conflict', topic: 'Visa', description: 'Priya cannot attend', evidence: [{ messageId: 'b', quote: 'main pay kar deti hoon' }] }], c2).state;
    const after = resolveConflict(withConstraint, withConstraint.conflicts[0].id, 'different_subject', { now: '10:00', actorLabel: 'Alex' });
    expect(after.conflicts[0].status).toBe('dismissed');
    expect(after.decisions).toHaveLength(0);
  });
});

describe('a day and a time are different things', () => {
  it('"Saturday" filed under "walk time", then "7pm": two items (day and time), no false clash', () => {
    const msgs: Message[] = [
      { id: 'a', conversationId: 'g', speakerId: 's', speakerName: 'Sofia', timestamp: '', content: 'Saturday is fixed', type: 'text', createdAt: 1 },
      { id: 'b', conversationId: 'g', speakerId: 'r', speakerName: 'Ravi', timestamp: '', content: 'lets do 7pm', type: 'text', createdAt: 2 },
    ];
    const ctx = { conversationId: 'g', messages: msgs, actor: 'model' as const, actorLabel: 'Meta AI', now: 'now' };
    const empty = { decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [] };
    const { state } = applyProposals(empty, [
      { kind: 'decision', topic: 'Street food walk time', value: 'Saturday', status: 'confirmed', evidence: [{ messageId: 'a', quote: 'Saturday is fixed' }] },
      { kind: 'decision', topic: 'Street food walk time', value: '7pm', status: 'proposed', evidence: [{ messageId: 'b', quote: 'lets do 7pm' }] },
    ], ctx);
    expect(state.conflicts).toEqual([]);
    expect(state.decisions.map(d => `${d.topic}: ${d.currentValue}`).sort()).toEqual(['Street food walk day: Saturday', 'Street food walk time: 7pm']);
  });

  it('two times on the same topic are still a real clash', () => {
    expect(valueKind('6pm')).toBe('clock');
    expect(valueKind('Saturday')).toBe('day');
    expect(valueKind('Saturday 6pm')).toBe('other');
    expect(topicsMatch('Walk time', 'Walk day')).toBe(false);
    expect(topicsMatch('Walk time', 'Walk start time')).toBe(true);
  });
});
