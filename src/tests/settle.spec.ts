import { describe, expect, it } from 'vitest';
import { computeGroupLedger, computeMySettlement, dedupeBills } from '../engine/settle';
import { setCollector } from '../engine/shares';
import { Commitment, Conflict, Decision, Message, User, Workspace } from '../types/groupOs';

const person = (name: string): User => ({ id: `u_${name.toLowerCase()}`, name, avatarColor: '#000' });
const ws = (id: string, title: string, names: string[]): Workspace => ({ id, title, category: '', description: '', participants: names.map(person), unreadCount: 0, lastActivity: '', iconName: '' });
const flat = ws('flat', 'Flat 402', ['Neha', 'Arjun', 'Dev']);
const trip = ws('trip', 'Goa Trip', ['Neha', 'Priya']);

let n = 0;
const bill = (topic: string, perPerson: number, collector: string, over: Partial<Decision> = {}): Decision => ({
  id: `d${n++}`, conversationId: 'flat', topic, currentValue: `${perPerson} each`, status: 'confirmed', supportingEvidenceIds: [], contradictingEvidenceIds: [],
  confidence: 0.9, lastUpdatedAt: '', updatedBy: collector, history: [], split: { perPerson, currency: '₹', among: 'everyone', collector }, ...over,
});
const payment = (over: Partial<Commitment>): Commitment => ({
  id: `c${n++}`, conversationId: 'flat', ownerId: '', ownerName: 'Arjun', description: 'Paid', status: 'needs_clarification', evidenceIds: [], lastUpdatedAt: '', ...over,
});

describe('inside one group, like Splitwise', () => {
  it('nets what two people owe each other: what Neha owes Arjun is deducted from what Arjun owes Neha', () => {
    const ledger = computeGroupLedger(flat, [bill('Electricity', 1150, 'Neha'), bill('Groceries', 600, 'Arjun')], []);
    const pair = ledger.pairs.find(p => p.from === 'Arjun' && p.to === 'Neha')!;
    expect(pair.amount).toBe(550);
    expect(pair.items.map(i => `${i.direction}:${i.reason}:${i.amount}`)).toEqual(['owes:Electricity:1150', 'offsets:Groceries:600']);
    expect(ledger.pairs.find(p => p.from === 'Neha')).toBeUndefined();
    expect(ledger.pairs.find(p => p.from === 'Dev' && p.to === 'Neha')!.amount).toBe(1150);
    expect(ledger.net.find(x => x.name === 'Neha')!.amount).toBe(550 + 1150);
    expect(ledger.pairs.find(p => p.from === 'Dev' && p.to === 'Arjun')!.amount).toBe(600);
  });

  it('the person who paid is owed by the others and does not owe their own share', () => {
    const ledger = computeGroupLedger(flat, [bill('Hotel', 4800, 'Neha')], []);
    expect(ledger.pairs.map(p => `${p.from}->${p.to}:${p.amount}`).sort()).toEqual(['Arjun->Neha:4800', 'Dev->Neha:4800']);
  });

  it('does not count a split the group disagrees about, and says it is waiting', () => {
    const ledger = computeGroupLedger(flat, [bill('Rent', 9000, 'Neha', { status: 'conflicted' })], []);
    expect(ledger.pairs).toEqual([]);
    expect(ledger.waiting).toHaveLength(1);
    expect(ledger.waiting[0]).toMatchObject({ topic: 'Rent', why: 'the group disagrees about it', eachAmount: 9000 });
  });

  it('a suggested split that nobody disputes counts, marked as not fully agreed', () => {
    const ledger = computeGroupLedger(flat, [bill('Wifi', 300, 'Neha', { status: 'proposed' })], []);
    expect(ledger.pairs[0].items[0].agreed).toBe(false);
  });

  it('a confirmed payment settles the debt; "I paid" alone still counts as owed', () => {
    const rent = bill('Rent', 9000, 'Neha');
    const claimed = payment({ ownerName: 'Arjun', payee: 'Neha', amount: 9000, status: 'needs_clarification' });
    const confirmed = payment({ ownerName: 'Dev', payee: 'Neha', amount: 9000, status: 'completed', verification: { state: 'confirmed' } as any });
    const ledger = computeGroupLedger(flat, [rent], [claimed, confirmed]);
    expect(ledger.pairs.find(p => p.from === 'Dev')).toBeUndefined();
    const arjun = ledger.pairs.find(p => p.from === 'Arjun')!;
    expect(arjun.amount).toBe(9000);
    expect(arjun.pending).toBe(true);
  });

  it('a promise to pay that the split already covers is not counted twice', () => {
    const rent = bill('Accommodation', 1500, 'Neha');
    const promise = payment({ ownerName: 'Arjun', payee: 'Neha', amount: 1500, status: 'accepted', description: 'Pay Neha 1500' });
    const arjun = computeGroupLedger(flat, [rent], [promise]).pairs.find(p => p.from === 'Arjun')!;
    expect(arjun.amount).toBe(1500);
  });

  it('a promise to pay that no split covers is a debt too', () => {
    const promise = payment({ ownerName: 'Arjun', payee: 'Dev', amount: 3000, status: 'accepted', description: 'Refund 3000 to Dev' });
    expect(computeGroupLedger(flat, [], [promise]).pairs[0]).toMatchObject({ from: 'Arjun', to: 'Dev', amount: 3000 });
  });
});

describe('across groups, nothing is netted', () => {
  it('shows what you owe in one group and what you are owed in another, separately', () => {
    const a = computeGroupLedger(flat, [bill('Rent', 500, 'Arjun')], []);
    const b = computeGroupLedger(trip, [bill('Hotel', 1200, 'Neha')].map(d => ({ ...d, conversationId: 'trip' })), []);
    const mine = computeMySettlement([a, b], 'Neha');
    expect(mine.oweText).toBe('₹500');
    expect(mine.owedText).toBe('₹1,200');
    expect(mine.groups.map(g => g.title)).toEqual(['Flat 402', 'Goa Trip']);
  });

  it('a split that is still in dispute is listed but not added', () => {
    const a = computeGroupLedger(flat, [bill('Rent', 500, 'Arjun', { status: 'conflicted' })], []);
    const mine = computeMySettlement([a], 'Neha');
    expect(mine.oweText).toBe('nothing');
    expect(mine.lines.join(' ')).toMatch(/not counted yet/);
  });
});

describe('payments that need an answer', () => {
  const conflict = (over: Partial<Conflict>): Conflict => ({
    id: 'x1', conversationId: 'trip', topic: 'Scuba charter', description: 'Rohan says 6,500 on one activity blows his budget', relatedDecisionIds: [], evidenceIds: ['e1'],
    impactedItemIds: [], status: 'open', createdAt: '', ...over,
  });
  const scuba = bill('Scuba charter', 6500, 'Sam', { status: 'proposed', conversationId: 'trip' });
  const group = ws('trip', 'Goa Trip', ['Sam', 'Rohan', 'Priya']);

  it('a suggested split someone objected to is not owed yet, and shows what you would owe if it goes ahead', () => {
    const ledger = computeGroupLedger(group, [scuba], [], { conflicts: [conflict({})], evidenceMap: { e1: { messageId: 'm9' } as any } });
    expect(ledger.pairs).toEqual([]);
    expect(ledger.waiting[0]).toMatchObject({ topic: 'Scuba charter', eachAmount: 6500, messageId: 'm9', detail: expect.stringMatching(/blows his budget/) });
    const mine = computeMySettlement([ledger], 'Rohan');
    expect(mine.oweText).toBe('nothing');
    expect(mine.lines.join(' ')).toMatch(/not counted yet.*blows his budget.*If it goes ahead you would owe ₹6,500/);
  });

  it('a money disagreement that is not tied to any split is still listed', () => {
    const ledger = computeGroupLedger(group, [], [], { conflicts: [conflict({ topic: 'Hotel budget', description: 'Maya says 24,000 is over the 15,000 limit' })] });
    expect(ledger.waiting[0]).toMatchObject({ topic: 'Hotel budget' });
  });

  it('a split with no named recipient is an action for the group, and still counts toward what you owe', () => {
    const rent = bill('Rent', 9000, '', { split: { perPerson: 9000, currency: '₹', among: 'everyone' } });
    const ledger = computeGroupLedger(flat, [rent], []);
    expect(ledger.unassigned.every(d => d.needsRecipient && !d.outside)).toBe(true);
    expect(computeMySettlement([ledger], 'Neha').oweText).toBe('₹9,000');
  });

  it('a split paid to someone outside the group is owed, but not to a member and not an open question', () => {
    const rent = bill('Rent', 9000, '', { split: { perPerson: 9000, currency: '₹', among: 'everyone', outside: true } });
    const ledger = computeGroupLedger(flat, [rent], []);
    expect(ledger.unassigned.every(d => d.outside && !d.needsRecipient)).toBe(true);
    expect(computeMySettlement([ledger], 'Neha').lines.join(' ')).toMatch(/paid outside the group/);
  });

  it('choosing who collects turns the split into debts to that person', () => {
    const rent = bill('Rent', 9000, '', { split: { perPerson: 9000, currency: '₹', among: 'everyone' } });
    const state = setCollector({ decisions: [rent], commitments: [], conflicts: [], evidenceMap: {}, history: [] }, rent.id, 'Dev');
    const ledger = computeGroupLedger(flat, state.decisions, []);
    expect(ledger.pairs.map(p => `${p.from}->${p.to}`).sort()).toEqual(['Arjun->Dev', 'Neha->Dev']);
    expect(ledger.unassigned).toEqual([]);
  });

  const say = (id: string, speakerName: string, content: string): Message => ({ id, conversationId: 'trip', speakerId: speakerName, speakerName, timestamp: '', content, type: 'text', createdAt: 0 });
  const chat = [say('m1', 'Sam', 'Someone recommended a private scuba charter for ₹6,500 each!'), say('m2', 'Rohan', 'No way Sam, ₹6,500 on one activity blows my entire budget.')];

  it('notices a plain objection to a suggested cost even when no conflict was recorded', () => {
    const d = { ...scuba, supportingEvidenceIds: ['e1'] };
    const ledger = computeGroupLedger(group, [d], [], { messages: chat, evidenceMap: { e1: { messageId: 'm1' } as any } });
    expect(ledger.pairs).toEqual([]);
    expect(ledger.waiting[0]).toMatchObject({ topic: 'Scuba charter', messageId: 'm2', detail: expect.stringMatching(/Rohan objected/) });
  });

  it('an objection does not undo a cost the group already confirmed', () => {
    const d = { ...scuba, status: 'confirmed' as const, supportingEvidenceIds: ['e1'] };
    const ledger = computeGroupLedger(group, [d], [], { messages: chat, evidenceMap: { e1: { messageId: 'm1' } as any } });
    expect(ledger.waiting).toEqual([]);
    expect(ledger.pairs.length).toBeGreaterThan(0);
  });
});

describe('"split equally" inside a topic', () => {
  it('means the people taking part in that topic, not everyone in the group', () => {
    const group = ws('flat', 'Flat & friends', ['Neha', 'Arjun', 'Dev', 'Ravi', 'Sita']);
    const rent = { ...bill('Rent', 9000, 'Neha'), topicId: 't_rent' };
    const topics = [{ id: 't_rent', title: 'Rent', kind: 'bills' as const, status: 'open' as const, messageIds: [], people: ['Neha', 'Arjun', 'Dev'], firstAt: 0, lastAt: 0 }];
    const ledger = computeGroupLedger(group, [rent], [], { topics });
    expect(ledger.pairs.map(p => p.from).sort()).toEqual(['Arjun', 'Dev']);
    // Without topics, every member pays.
    expect(computeGroupLedger(group, [rent], []).pairs.map(p => p.from).sort()).toEqual(['Arjun', 'Dev', 'Ravi', 'Sita']);
  });
});

describe('how many people share a bill', () => {
  it('when the chat says total and each (36,000, 9,000 each = 4), only the 4 most involved in the thread pay', () => {
    const group = ws('flat', 'Flat & friends', ['Neha', 'Arjun', 'Dev', 'Priya', 'Ravi']);
    const rent = { ...bill('Rent', 9000, 'Neha'), currentValue: '36000 a month, 9000 each', topicId: 't_rent' };
    const say = (id: string, who: string) => ({ id, conversationId: 'flat', speakerId: who, speakerName: who, timestamp: '', content: 'x', type: 'text' as const, createdAt: 0 });
    const messages = [say('1', 'Neha'), say('2', 'Neha'), say('3', 'Arjun'), say('4', 'Arjun'), say('5', 'Dev'), say('6', 'Dev'), say('7', 'Priya'), say('8', 'Priya'), say('9', 'Ravi')];
    const topics = [{ id: 't_rent', title: 'Rent', kind: 'bills' as const, status: 'open' as const, messageIds: messages.map(m => m.id), people: ['Neha', 'Arjun', 'Dev', 'Priya', 'Ravi'], firstAt: 0, lastAt: 0 }];
    const ledger = computeGroupLedger(group, [rent], [], { topics, messages });
    expect(ledger.pairs.map(p => p.from).sort()).toEqual(['Arjun', 'Dev', 'Priya']);
  });
});

describe('payments, Splitwise style', () => {
  const paid = (from: string, to: string, amount: number, over: Partial<Commitment> = {}): Commitment => ({
    id: `pay${n++}`, conversationId: 'flat', ownerId: '', ownerName: from, description: `Paid ${to}`, status: 'completed', evidenceIds: [], lastUpdatedAt: '',
    payee: to, amount, currency: '₹', verification: { state: 'confirmed', reasons: [] }, ...over,
  });
  const rent = bill('Rent', 9000, 'Neha');
  const power = bill('Electricity', 800, 'Neha');

  it('one transfer that covers two bills (rent + electricity) clears both', () => {
    const ledger = computeGroupLedger(flat, [rent, power], [paid('Arjun', 'Neha', 9800)]);
    expect(ledger.pairs.find(p => p.from === 'Arjun')).toBeUndefined();
    expect(ledger.pairs.find(p => p.from === 'Dev')!.amount).toBe(9800);
  });

  it('a part payment leaves the rest owed, and shows the payment', () => {
    const arjun = computeGroupLedger(flat, [rent], [paid('Arjun', 'Neha', 5000)]).pairs.find(p => p.from === 'Arjun')!;
    expect(arjun.amount).toBe(4000);
    expect(arjun.items.some(i => i.direction === 'paid' && i.amount === 5000)).toBe(true);
  });

  it('a payment never flips a debt: paying more than you owe does not make the receiver owe you', () => {
    expect(computeGroupLedger(flat, [rent], [paid('Arjun', 'Neha', 20000)]).pairs.find(p => p.from === 'Neha' || p.to === 'Arjun')).toBeUndefined();
  });

  it('a disputed payment, or one to someone outside the group, does not count', () => {
    expect(computeGroupLedger(flat, [rent], [paid('Arjun', 'Neha', 9000, { verification: { state: 'disputed', reasons: [] } })]).pairs.find(p => p.from === 'Arjun')!.amount).toBe(9000);
    expect(computeGroupLedger(flat, [rent], [paid('Arjun', 'Landlord', 9000)]).pairs.find(p => p.from === 'Arjun')!.amount).toBe(9000);
  });
});

describe('one bill, counted once', () => {
  const topic = (id: string, title: string, firstAt: number) => ({ id, title, kind: 'trip' as const, status: 'open' as const, messageIds: [], people: [], firstAt, lastAt: firstAt });
  const billIn = (id: string, topicId: string, each: number, collector: string) => ({ ...bill(id, each, collector), id, topicId });

  it('a bill recapped in another part of the same plan is counted in the first one only', () => {
    const state = {
      decisions: [billIn('Flights', 't_travel', 4800, 'Neha'), billIn('Flights share', 't_settle', 4800, 'Neha')],
      commitments: [], conflicts: [], evidenceMap: {}, history: [],
      topics: [topic('t_travel', 'Goa trip: travel', 1), topic('t_settle', 'Goa trip: settling up', 2)],
    };
    const out = dedupeBills(state);
    expect(out.decisions.filter(d => d.split).map(d => d.id)).toEqual(['Flights']);
  });

  it('never merges separate plans, like each month’s rent, even with the same amount and collector', () => {
    const state = {
      decisions: [billIn('Rent', 't_aug', 9000, 'Neha'), billIn('Rent', 't_sep', 9000, 'Neha')].map((d, i) => ({ ...d, id: `r${i}` })),
      commitments: [], conflicts: [], evidenceMap: {}, history: [],
      topics: [topic('t_aug', 'Rent & bills, August', 1), topic('t_sep', 'Rent & bills, September', 2)],
    };
    expect(dedupeBills(state).decisions.filter(d => d.split)).toHaveLength(2);
  });
});

describe('money rules for long, messy chats', () => {
  const T = (id: string, title: string, day: number) => ({ id, title, kind: 'bills' as const, status: 'open' as const, messageIds: [], people: [], firstAt: day * 86400000, lastAt: day * 86400000 });
  const trio = ws('trio', 'Flat 7B', ['Kruthik', 'Aniket', 'Swapnil']);
  const msgs: Message[] = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, conversationId: 'trio', speakerId: 's', speakerName: 'S', timestamp: '', content: '', type: 'text', createdAt: i }));
  const ev = (k: string, messageId: string) => ({ [k]: { id: k, messageId, quote: 'x', speakerName: 'S', timestamp: '' } as any });

  it('a payment talked about in another topic still clears the debt (shared across topics, oldest first)', async () => {
    const { buildPanel } = await import('../engine/panel');
    const state: any = {
      decisions: [{ ...bill('Rent', 18000, 'Kruthik', { split: { perPerson: 18000, currency: '₹', among: ['Kruthik', 'Swapnil'], collector: 'Kruthik' } }), topicId: 'rent_nov' }],
      commitments: [payment({ ownerName: 'Swapnil', payee: 'Kruthik', amount: 18000, status: 'completed', topicId: 'dues', evidenceIds: ['e1'] })],
      conflicts: [], history: [], evidenceMap: ev('e1', 'm5'),
      topics: [T('rent_nov', 'Rent & bills, November', 300), T('dues', '54k dues to Kruthik', 305)],
    };
    const panel = buildPanel(trio, state, msgs, { defaultCurrency: '₹' });
    expect(panel.owes).toEqual([]);
  });

  it('a promise to pay someone you already owe a share to is that share, not a second debt', () => {
    const state: any = {
      decisions: [{ ...bill('Villa', 6200, 'Arjun', { split: { perPerson: 6200, currency: '₹', among: ['Arjun', 'Rohan'], collector: 'Arjun' } }), topicId: 'stay' }],
      commitments: [payment({ ownerName: 'Rohan', payee: 'Arjun', amount: 6500, status: 'accepted', topicId: 'settle', description: 'Pay villa + dinner dues to Arjun' })],
      conflicts: [], history: [], evidenceMap: {},
      topics: [T('stay', 'Goa trip: stay', 10), T('settle', 'Goa trip: settling up', 40)],
    };
    expect(dedupeBills(state).commitments[0].amount).toBeUndefined();
  });

  it('a later recap of the same bill in the same plan is not a second bill, even with another figure', () => {
    const state: any = {
      decisions: [
        { ...bill('Villa cost per person', 6200, 'Arjun'), id: 'v1', topicId: 'stay' },
        { ...bill('Villa cost per person', 4500, 'Arjun'), id: 'v2', topicId: 'settle' },
      ],
      commitments: [], conflicts: [], history: [], evidenceMap: {},
      topics: [T('stay', 'Goa trip: stay', 10), T('settle', 'Goa trip: villa & dinner settling', 40)],
    };
    expect(dedupeBills(state).decisions.filter((d: Decision) => d.split).map((d: Decision) => d.id)).toEqual(['v1']);
  });

  it('a loan is owed back through the promise, and is not taken as paying off what the lender owes', () => {
    const decisions = [{ ...bill('Maid', 1500, 'Swapnil', { split: { perPerson: 1500, currency: '₹', among: ['Aniket', 'Swapnil'], collector: 'Swapnil' } }), topicId: 'flat' }];
    const loan = payment({ ownerName: 'Aniket', payee: 'Swapnil', amount: 15000, status: 'completed', evidenceIds: ['e1'], topicId: 'bike' });
    const promise = payment({ ownerName: 'Swapnil', payee: 'Aniket', amount: 5000, status: 'accepted', evidenceIds: ['e2'], description: 'Give back the remaining 5,000', topicId: 'bike' });
    const repaid = payment({ ownerName: 'Swapnil', payee: 'Aniket', amount: 10000, status: 'completed', evidenceIds: ['e3'], topicId: 'bike' });
    const evidenceMap = { ...ev('e1', 'm1'), ...ev('e2', 'm2'), ...ev('e3', 'm9') };
    const ledger = computeGroupLedger(trio, decisions, [loan, promise, repaid], { messages: msgs, evidenceMap, defaultCurrency: '₹' });
    // Swapnil owes 15,000 − 10,000 = 5,000; Aniket's 1,500 maid share is still owed, not cleared by the loan.
    const pair = ledger.pairs.find(p => p.from === 'Swapnil' && p.to === 'Aniket')!;
    expect(pair.amount).toBe(3500);
  });

  it('a promise to pay someone outside the group is not a debt inside it', () => {
    const ledger = computeGroupLedger(trio, [], [payment({ ownerName: 'Kruthik', payee: 'owner', amount: 54000, status: 'accepted' })]);
    expect(ledger.pairs).toEqual([]);
  });
});

describe('bets and running totals', () => {
  const trio = ws('trio', 'Flat 7B', ['Kruthik', 'Aniket', 'Swapnil']);
  const msgs: Message[] = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, conversationId: 'trio', speakerId: 's', speakerName: 'S', timestamp: '', content: '', type: 'text', createdAt: i }));
  const evm = (pairs: [string, string, string][]) => Object.fromEntries(pairs.map(([k, messageId, quote]) => [k, { id: k, messageId, quote, speakerName: 'S', timestamp: '' } as any]));

  it('two lost bets between the same two people add up', () => {
    const bets = [1, 2].map(i => payment({ ownerName: 'Aniket', payee: 'Swapnil', amount: 200, status: 'accepted', description: `Bet ${i}`, topicId: 'ipl' }));
    const ledger = computeGroupLedger(trio, [], bets, { defaultCurrency: '₹' });
    expect(ledger.pairs[0]).toMatchObject({ from: 'Aniket', to: 'Swapnil', amount: 400 });
  });

  it('a running total replaces the small items, and is what its latest message says', () => {
    const items = [payment({ ownerName: 'Aniket', payee: 'Swapnil', amount: 200, status: 'accepted', description: 'Bet 1', topicId: 'ipl', evidenceIds: ['a'] })];
    const total = payment({ ownerName: 'Aniket', payee: 'Swapnil', amount: 200, status: 'accepted', description: 'Total: owed to Swapnil', topicId: 'ipl', evidenceIds: ['b', 'c'] });
    const evidenceMap = evm([['a', 'm1', 'gaya 200'], ['b', 'm2', 'Aniket tera 200 Swapnil ko pending'], ['c', 'm7', 'Aniket ka ab 1000 ho gaya Swapnil ko']]);
    const ledger = computeGroupLedger(trio, [], [...items, total], { messages: msgs, evidenceMap, defaultCurrency: '₹' });
    expect(ledger.pairs[0]).toMatchObject({ from: 'Aniket', to: 'Swapnil', amount: 1000 });
  });
});

describe('currencies stay apart', () => {
  it('a dollar payment never clears a rupee debt', () => {
    const rent = bill('Rent', 9000, 'Neha');
    const usd = payment({ ownerName: 'Dev', payee: 'Neha', amount: 50, currency: 'USD', status: 'completed' });
    const dev = computeGroupLedger(flat, [rent], [usd], { defaultCurrency: '₹' }).pairs.find(p => p.from === 'Dev' && p.to === 'Neha')!;
    expect(dev.amount).toBe(9000);
  });
});

describe('chat replies and quiet members', () => {
  it('a payment the receiver says they got is confirmed, in code; a reply naming another amount is not', async () => {
    const { confirmFromReplies } = await import('../engine/eventReducer');
    const msgs: Message[] = [
      { id: 'm1', conversationId: 'c', speakerId: 'a', speakerName: 'Aniket', timestamp: '', content: 'paid you 800', type: 'text', createdAt: 1 },
      { id: 'm2', conversationId: 'c', speakerId: 'k', speakerName: 'Kruthik', timestamp: '', content: 'got it, thanks', type: 'text', createdAt: 2 },
      { id: 'm3', conversationId: 'c', speakerId: 'a', speakerName: 'Aniket', timestamp: '', content: 'sent 500', type: 'text', createdAt: 3 },
      { id: 'm4', conversationId: 'c', speakerId: 'k', speakerName: 'Kruthik', timestamp: '', content: 'received 300 only', type: 'text', createdAt: 4 },
    ];
    const state: any = {
      decisions: [], conflicts: [], history: [],
      evidenceMap: { e1: { messageId: 'm1', quote: 'paid you 800' }, e3: { messageId: 'm3', quote: 'sent 500' } },
      commitments: [payment({ id: 'p1', ownerName: 'Aniket', payee: 'Kruthik', amount: 800, evidenceIds: ['e1'] }), payment({ id: 'p2', ownerName: 'Aniket', payee: 'Kruthik', amount: 500, evidenceIds: ['e3'] })],
    };
    const out = confirmFromReplies(state, msgs);
    expect(out.commitments.find((c: any) => c.id === 'p1')!.status).toBe('completed');
    expect(out.commitments.find((c: any) => c.id === 'p2')!.status).toBe('needs_clarification');
  });

  it('"18000 each" fixes the headcount, and a flatmate who never spoke in the thread still pays', () => {
    const trio = ws('trio', 'Flat 7B', ['Kruthik', 'Aniket', 'Swapnil']);
    const rent = { ...bill('Rent bill', 0, 'Kruthik', { split: { perPerson: 0, total: 54000, currency: '₹', among: 'everyone', collector: 'Kruthik' }, supportingEvidenceIds: ['e1'] }), topicId: 't' };
    const topics = [{ id: 't', title: 'Rent', kind: 'bills', status: 'open', messageIds: ['m1', 'm2'], people: ['Kruthik', 'Aniket'], firstAt: 0, lastAt: 0 }] as any;
    const messages: Message[] = [
      { id: 'm1', conversationId: 'c', speakerId: 'k', speakerName: 'Kruthik', timestamp: '', content: 'rent 54000, 18000 each mujhe', type: 'text', createdAt: 1 },
      { id: 'm2', conversationId: 'c', speakerId: 'a', speakerName: 'Aniket', timestamp: '', content: 'ok', type: 'text', createdAt: 2 },
    ];
    const ledger = computeGroupLedger(trio, [rent], [], { topics, messages, evidenceMap: { e1: { id: 'e1', messageId: 'm1', quote: 'rent 54000, 18000 each mujhe' } as any }, defaultCurrency: '₹' });
    expect(ledger.pairs.map(p => `${p.from}>${p.to}:${p.amount}`).sort()).toEqual(['Aniket>Kruthik:18000', 'Swapnil>Kruthik:18000']);
  });
});

describe('plans called off', () => {
  const trio = ws('trio', 'Flat 7B', ['Kruthik', 'Aniket', 'Swapnil']);
  const setup = (cancelText: string, paid = false) => {
    const dinner = { ...bill('Dinner cost', 600, 'Kruthik', { supportingEvidenceIds: ['e1'] }), topicId: 't' };
    const messages: Message[] = [
      { id: 'm1', conversationId: 'c', speakerId: 'k', speakerName: 'Kruthik', timestamp: '', content: 'saturday dinner 600 each', type: 'text', createdAt: 1 },
      { id: 'm2', conversationId: 'c', speakerId: 'k', speakerName: 'Kruthik', timestamp: '', content: cancelText, type: 'text', createdAt: 2 },
    ];
    const topics = [{ id: 't', title: 'Saturday dinner', kind: 'event', status: 'open', messageIds: ['m1', 'm2'], people: ['Kruthik', 'Aniket', 'Swapnil'], firstAt: 0, lastAt: 0 }] as any;
    const pays = paid ? [payment({ ownerName: 'Aniket', payee: 'Kruthik', amount: 600, status: 'completed', topicId: 't' })] : [];
    return computeGroupLedger(trio, [dinner], pays, { topics, messages, evidenceMap: { e1: { id: 'e1', messageId: 'm1', quote: 'saturday dinner 600 each' } as any }, defaultCurrency: '₹' });
  };
  it('a plan called off owes nothing, and says why', () => {
    const l = setup('plan cancel ho gaya bhai, restaurant band hai');
    expect(l.pairs).toEqual([]);
    expect(l.waiting[0].why).toBe('the plan was called off');
  });
  it('dropping one option for another is not calling the plan off', () => {
    expect(setup('Delhi wala dinner plan cancel, Chandigarh wala final').pairs.length).toBe(2);
  });
  it('a cost someone already paid towards was not called off', () => {
    expect(setup('plan cancel ho gaya', true).pairs.length).toBeGreaterThan(0);
  });
});

describe('a revised split', () => {
  it('replaces the earlier one for the people it names; the rest pay what is left of the total', () => {
    const five = ws('food', 'Foodies', ['Neha', 'Zoya', 'Kiran', 'Abhi', 'Ritu']);
    const messages: Message[] = ['first', 'revised'].map((t, i) => ({ id: `m${i + 1}`, conversationId: 'f', speakerId: 's', speakerName: 'Abhi', timestamp: '', content: t, type: 'text', createdAt: i }));
    const evidenceMap: any = { e1: { id: 'e1', messageId: 'm1', quote: '7500, 1500 each' }, e2: { id: 'e2', messageId: 'm2', quote: 'Ritu 1000, others 1625' } };
    const first = { ...bill('Crawl budget', 1500, 'Abhi', { supportingEvidenceIds: ['e1'] }), topicId: 't' };
    const revised = { ...bill('Others share', 1625, 'Abhi', { supportingEvidenceIds: ['e2'], split: { perPerson: 1625, currency: '₹', among: ['Kiran', 'Neha', 'Zoya', 'Abhi'], collector: 'Abhi' } }), topicId: 't' };
    const l = computeGroupLedger(five, [first, revised], [], { messages, evidenceMap, defaultCurrency: '₹' });
    const owed = Object.fromEntries(l.pairs.map(p => [p.from, p.amount]));
    expect(owed).toEqual({ Neha: 1625, Zoya: 1625, Kiran: 1625, Ritu: 1000 });
  });
});

describe('rules from the example-group audit', () => {
  const six = ws('office', 'Squad', ['Neha', 'Rahul', 'Fatima', 'Joel', 'Ananya', 'Karthik']);
  const msg = (id: string, speakerName: string, content: string, i: number): Message => ({ id, conversationId: 'o', speakerId: speakerName, speakerName, timestamp: '', content, type: 'text', createdAt: i });

  it('an agreed payer who writes "900 each" in the thread makes the bill, collected by them', () => {
    const topics = [{ id: 't', title: 'Monthly team lunch, Oct', kind: 'event', status: 'open', messageIds: ['m1', 'm2'], people: ['Neha', 'Rahul', 'Fatima', 'Joel', 'Ananya', 'Karthik'], firstAt: 0, lastAt: 0 }] as any;
    const messages = [msg('m1', 'Rahul', 'paid 5400. Split', 1), msg('m2', 'Rahul', '900 each', 2)];
    const payer = { ...bill('October lunch payer', 0, 'Rahul', { currentValue: 'Rahul', split: undefined }), topicId: 't' };
    const l = computeGroupLedger(six, [payer], [], { topics, messages, defaultCurrency: '₹' });
    expect(l.pairs.filter(p => p.to === 'Rahul').map(p => p.amount)).toEqual([900, 900, 900, 900, 900]);
  });

  it('when one person refuses an agreed cost, only their share waits; the others still owe', () => {
    const flats = ws('soc', 'Block B', ['Faisal', 'Reddy', 'Gupta']);
    const lift = { ...bill('Lift repair share', 20000, 'Faisal', { status: 'conflicted' as const }), topicId: 't' };
    const messages = [msg('m1', 'Gupta', 'yeh 20k hum nahi denge, builder should pay', 1)];
    const conflicts = [{ id: 'x', topic: 'Lift repair share', description: 'Gupta refuses to pay 20000', status: 'open', evidenceIds: ['e1'], relatedDecisionIds: [lift.id], topicId: 't' }] as any;
    const l = computeGroupLedger(flats, [lift], [], { messages, conflicts, evidenceMap: { e1: { id: 'e1', messageId: 'm1', quote: 'yeh 20k hum nahi denge' } as any }, defaultCurrency: '₹' });
    expect(l.pairs.map(p => `${p.from}>${p.to}:${p.amount}`)).toEqual(['Reddy>Faisal:20000']);
    expect(l.waiting[0].appliesTo).toEqual(['Gupta']);
  });

  it('a payment with no figure, to the collector of a share the payer owes in that thread, pays that share', () => {
    const gift = { ...bill('Gift', 3000, 'Fatima'), topicId: 't' };
    const paid = payment({ ownerName: 'Rahul', payee: 'Fatima', status: 'completed', topicId: 't', description: 'Sent Fatima. Done.' });
    const l = computeGroupLedger(six, [gift], [paid], { defaultCurrency: '₹' });
    expect(l.pairs.some(p => p.from === 'Rahul')).toBe(false);
  });
});
