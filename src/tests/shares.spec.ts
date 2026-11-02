import { describe, expect, it } from 'vitest';
import { applyProposals, Proposal } from '../engine/eventReducer';
import { billName, computeMyShares, markSharePaid, shareStateFor } from '../engine/shares';
import { computeGroupLedger } from '../engine/settle';
import { confirmPayment } from '../engine/receiptVerifier';
import { parseToolCall, vetSplit } from '../services/metaToolPipeline';
import { Commitment, Decision, GroupIntelligenceState, Message, User, Workspace } from '../types/groupOs';

const person = (name: string): User => ({ id: `u_${name.toLowerCase()}`, name, avatarColor: '#000' });
const ws = (id: string, title: string, names: string[]): Workspace => ({ id, title, category: '', description: '', participants: names.map(person), unreadCount: 0, lastActivity: '', iconName: '' });
const flat = ws('flat', 'Flat 7B', ['Aman', 'Neha', 'Rohit', 'Zoya']);
const goa = ws('goa', 'Goa Trip', ['Alex', 'Priya']);

const decision = (over: Partial<Decision> = {}): Decision => ({
  id: 'd1', conversationId: 'flat', topic: 'Rent share per person', currentValue: '9000 each', status: 'confirmed', supportingEvidenceIds: [], contradictingEvidenceIds: [],
  confidence: 0.9, lastUpdatedAt: '', updatedBy: 'Aman', history: [], split: { perPerson: 9000, currency: '₹', among: 'everyone' }, ...over,
});
let n = 0;
const claim = (over: Partial<Commitment>): Commitment => ({
  id: `c${n++}`, conversationId: 'flat', ownerId: 'u_neha', ownerName: 'Neha', description: 'Paid my share', status: 'needs_clarification', evidenceIds: [], lastUpdatedAt: '', shareOfDecisionId: 'd1', ...over,
});
const shares = (user: User, decisions: Decision[], commitments: Commitment[] = [], scoped = ['flat', 'goa']) =>
  computeMyShares([flat, goa], scoped, { flat: decisions, goa: [] }, { flat: commitments, goa: [] }, user);

describe('what each person owes from a split decision', () => {
  it('makes every member of the group owe their share', () => {
    const { owed } = shares(person('Neha'), [decision()]);
    expect(owed).toEqual([expect.objectContaining({ topic: 'Rent share per person', amount: 9000, currency: '₹', state: 'unpaid', workspaceTitle: 'Flat 7B' })]);
  });

  it('does not charge someone who is not in the group, or a person the split does not name', () => {
    expect(shares(person('Alex'), [decision()]).owed).toEqual([]); // Alex is only in Goa
    expect(shares(person('Zoya'), [decision({ split: { perPerson: 300, among: ['Neha', 'Rohit'] } })]).owed).toEqual([]);
    expect(shares(person('Rohit'), [decision({ split: { perPerson: 300, among: ['Neha', 'Rohit'] } })]).owed).toHaveLength(1);
  });

  it('counts a split that is agreed or simply suggested, but not one the group disagrees about or rejected', () => {
    expect(shares(person('Neha'), [decision({ status: 'proposed' })]).owed).toEqual([expect.objectContaining({ amount: 9000, agreed: false })]);
    expect(shares(person('Neha'), [decision({ status: 'conflicted' })]).owed).toEqual([]);
    expect(shares(person('Neha'), [decision({ status: 'rejected' })]).owed).toEqual([]);
    expect(shares(person('Neha'), [decision({ split: undefined })]).owed).toEqual([]);
  });

  it('files an amount that arrives on a due-date decision under the bill itself', () => {
    const call = parseToolCall('record_decision', { topic: 'October electricity bill due date', value: '1150 each', status: 'confirmed', splitPerPerson: 1150, splitCurrency: '₹', evidence: [] });
    expect('proposal' in call && call.proposal.kind === 'decision' && call.proposal.topic).toBe('October electricity bill');
  });

  it('divides a stated total by the people it covers', () => {
    const wifi = decision({ id: 'd2', topic: 'WiFi bill', split: { perPerson: 0, total: 1200, currency: '₹', among: 'everyone', collector: 'Aman' } });
    expect(shares(person('Neha'), [wifi]).owed).toEqual([expect.objectContaining({ topic: 'WiFi bill', amount: 300, collector: 'Aman' })]);
  });

  it('counts a bill recorded twice only once, and gives a split without a currency the group currency', () => {
    const share = decision({ id: 'd3', topic: 'Electricity share per person', split: { perPerson: 606, currency: '₹', among: 'everyone', collector: 'Aman' } });
    const total = decision({ id: 'd4', topic: 'Electricity bill total', split: { perPerson: 0, total: 2424, among: 'everyone', collector: 'Aman' } });
    const toAman = computeGroupLedger(flat, [share, total], []).pairs.find(p => p.from === 'Neha')!;
    expect(toAman.items).toHaveLength(1);
    expect(toAman.amount).toBe(606);
    const wifi = decision({ id: 'd5', topic: 'WiFi', split: { perPerson: 0, total: 1200, among: 'everyone', collector: 'Aman' } });
    expect(computeGroupLedger(flat, [share, wifi], []).pairs.find(p => p.from === 'Neha')!.amount).toBe(906);
  });

  it('respects the scope: a group left out is not counted', () => {
    expect(shares(person('Neha'), [decision()], [], []).owed).toEqual([]);
  });

  it('the person collecting the money does not owe it; the others owe them', () => {
    const d = decision({ split: { perPerson: 9000, currency: '₹', among: 'everyone', collector: 'Aman' } });
    expect(shares(person('Aman'), [d]).owed).toEqual([]);
    const { collecting } = shares(person('Aman'), [d], [claim({ ownerName: 'Neha', status: 'completed' }), claim({ ownerName: 'Rohit' })]);
    expect(collecting[0].people).toEqual([
      { name: 'Neha', state: 'paid' },
      { name: 'Rohit', state: 'claimed' },
      { name: 'Zoya', state: 'unpaid' },
    ]);
    expect(shares(person('Neha'), [d]).owed[0].collector).toBe('Aman');
  });

  it('reads paid, claimed and unpaid from the payment records, and a disputed claim is unpaid', () => {
    const d = decision();
    expect(shareStateFor(d, 'Neha', [claim({ status: 'completed' })])).toBe('paid');
    expect(shareStateFor(d, 'Neha', [claim({})])).toBe('claimed');
    expect(shareStateFor(d, 'Neha', [claim({ verification: { state: 'disputed', reasons: [] } })])).toBe('unpaid');
    expect(shareStateFor(d, 'Neha', [claim({ status: 'cancelled' })])).toBe('unpaid');
    expect(shareStateFor(d, 'Neha', [claim({ ownerName: 'Zoya' })])).toBe('unpaid');
  });
});

describe('"I paid my share"', () => {
  const state = (d: Decision): GroupIntelligenceState => ({ decisions: [d], commitments: [], conflicts: [], evidenceMap: {}, history: [] });
  const d = decision({ split: { perPerson: 9000, currency: '₹', among: 'everyone', collector: 'Aman' } });

  it('records a claim, not a payment: unverified until the person who collects confirms', () => {
    const s = markSharePaid(state(d), 'd1', 'Neha', { now: '10:00' });
    const c = s.commitments[0];
    expect(c).toMatchObject({ ownerName: 'Neha', status: 'needs_clarification', payee: 'Aman', amount: 9000, shareOfDecisionId: 'd1' });
    expect(s.evidenceMap[c.evidenceIds[0]].verificationStatus).toBe('claimed_unverified');
    expect(shareStateFor(d, 'Neha', s.commitments)).toBe('claimed');
  });

  it('is idempotent, and a confirmation by the collector makes the share paid', () => {
    let s = markSharePaid(state(d), 'd1', 'Neha', { now: '10:00' });
    s = markSharePaid(s, 'd1', 'Neha', { now: '10:01' });
    expect(s.commitments).toHaveLength(1);
    s = confirmPayment(s, s.commitments[0].id, 'Aman', { now: '11:00', actorLabel: 'Aman' });
    expect(shareStateFor(d, 'Neha', s.commitments)).toBe('paid');
  });

  it('ignores a decision that has no split', () => {
    expect(markSharePaid(state(decision({ split: undefined })), 'd1', 'Neha', { now: 'x' }).commitments).toEqual([]);
  });
});

describe('split terms through the extraction pipeline', () => {
  const MSGS: Message[] = [{ id: 'a', conversationId: 'flat', speakerId: 'u_aman', speakerName: 'Aman', timestamp: '9:00', content: 'haan pakka, 9000 each', type: 'text', createdAt: 0 }];
  const ctx = { conversationId: 'flat', messages: MSGS, actor: 'model' as const, actorLabel: 't', now: '9:00' };
  const empty = (): GroupIntelligenceState => ({ decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [] });
  const call = (extra: object) => parseToolCall('record_decision', { topic: 'Rent share per person', value: '9000 each', status: 'confirmed', evidence: [{ messageId: 'a', quote: 'haan pakka, 9000 each' }], ...extra });

  it('reads split terms from the model, including "everyone" and numeric strings', () => {
    const p = (call({ splitPerPerson: '9,000', splitCurrency: '₹', splitAmong: ['everyone'], splitCollector: 'Aman' }) as { proposal: Proposal }).proposal;
    expect(p).toMatchObject({ split: { perPerson: 9000, currency: '₹', among: 'everyone', collector: 'Aman' } });
    const named = (call({ splitPerPerson: 300, splitAmong: ['Neha', 'Rohit'] }) as { proposal: Proposal }).proposal;
    expect(named).toMatchObject({ split: { perPerson: 300, among: ['Neha', 'Rohit'] } });
  });

  it('adds no split when the model gives none, or gives nonsense', () => {
    expect((call({}) as { proposal: any }).proposal.split).toBeUndefined();
    expect((call({ splitPerPerson: 'lots' }) as { proposal: any }).proposal.split).toBeUndefined();
    expect((call({ splitPerPerson: -5 }) as { proposal: any }).proposal.split).toBeUndefined();
  });

  it('stores the split on the decision and keeps it through a repeat', () => {
    const p = (call({ splitPerPerson: 9000, splitAmong: ['everyone'] }) as { proposal: Proposal }).proposal;
    let s = applyProposals(empty(), [p], ctx).state;
    expect(s.decisions[0].split).toEqual({ perPerson: 9000, among: 'everyone' });
    const again = (call({}) as { proposal: Proposal }).proposal; // a later mention without terms must not erase them
    s = applyProposals(s, [again], ctx).state;
    expect(s.decisions[0].split).toEqual({ perPerson: 9000, among: 'everyone' });
  });
});

describe('splits are checked against the messages they cite', () => {
  const msg = (id: string, speakerName: string, content: string): Message => ({ id, conversationId: 'flat', speakerId: `u_${speakerName}`, speakerName, timestamp: '', content, type: 'text', createdAt: 0 });
  const bill = msg('m1', 'Neha', 'October electricity bill arrived: ₹3,450. Split is ₹1,150 each. Please UPI me.');
  const groceries = msg('m2', 'Neha', 'Also got common groceries for ₹1,820 total. ₹606 each.');
  const byId = new Map([bill, groceries].map(m => [m.id, m]));
  const proposal = (over: object, messageId = 'm1'): Proposal => ({
    kind: 'decision', topic: 'Electricity bill', value: '1150 each', status: 'confirmed',
    split: { perPerson: 1150, currency: '₹', among: 'everyone' }, evidence: [{ messageId, quote: 'Split is' }], ...over,
  } as Proposal);

  it('keeps a split whose amount is in the cited message and names the person who asks to be paid as collector', () => {
    const p = proposal({});
    vetSplit(p, byId);
    expect(p.kind === 'decision' && p.split).toMatchObject({ perPerson: 1150, collector: 'Neha' });
  });

  it('does not make someone the collector when they say they paid their own share', () => {
    const only = new Map([['m1', msg('m1', 'Neha', 'I paid my share of the rent, 1150 each was the split')]]);
    const p = proposal({});
    vetSplit(p, only);
    expect(p.kind === 'decision' && p.split?.collector).toBeUndefined();
  });

  it('makes the person who paid a bill for everyone the collector', () => {
    const only = new Map([['m1', msg('m1', 'Sam', 'I paid 3450 for the electricity, so 1150 each')]]);
    const p = proposal({});
    vetSplit(p, only);
    expect(p.kind === 'decision' && p.split?.collector).toBe('Sam');
  });

  it('reads the currency from the cited message when the model leaves it out', () => {
    const p = proposal({ split: { perPerson: 1150, among: 'everyone' } });
    vetSplit(p, byId);
    expect(p.kind === 'decision' && p.split?.currency).toBe('₹');
  });

  it('removes a split whose amount belongs to a different message', () => {
    const p = proposal({ split: { perPerson: 606, currency: '₹', among: 'everyone' } });
    vetSplit(p, byId);
    expect(p.kind === 'decision' && p.split).toBeUndefined();
  });

  it('accepts a per-person amount the model worked out from a total in the message', () => {
    const p = proposal({ split: { perPerson: 1150, currency: '₹', among: 'everyone' } }, 'm1');
    const only = new Map([['m1', msg('m1', 'Neha', 'Electricity bill ₹3,450 for the three of us, please send it to me')]]);
    vetSplit(p, only);
    expect(p.kind === 'decision' && p.split?.perPerson).toBe(1150);
  });
});

it('shows a bill filed under a due-date topic by its name', () => {
  expect(billName('Electricity bill due date')).toBe('Electricity bill');
  expect(billName('Rent')).toBe('Rent');
  expect(computeGroupLedger(flat, [decision({ topic: 'Electricity bill due date', split: { perPerson: 100, among: 'everyone', collector: 'Aman' } })], []).pairs[0].items[0].reason).toBe('Electricity bill');
});
