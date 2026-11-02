import { describe, expect, it } from 'vitest';
import { buildPanel, settleUp } from '../engine/panel';
import { Commitment, Decision, GroupIntelligenceState, User, Workspace } from '../types/groupOs';

const person = (name: string): User => ({ id: name, name, avatarColor: '' });
const ws: Workspace = { id: 'g', title: 'Trip', category: '', description: '', participants: ['Neha', 'Arjun', 'Dev'].map(person), unreadCount: 0, lastActivity: '', iconName: '' };
const bill = (id: string, topicId: string, each: number, collector: string): Decision => ({
  id, topicId, conversationId: 'g', topic: id, currentValue: `${each} each`, status: 'confirmed', supportingEvidenceIds: [], contradictingEvidenceIds: [], confidence: 1, lastUpdatedAt: '', updatedBy: '', history: [],
  split: { perPerson: each, currency: '₹', among: 'everyone', collector },
});
const state = (decisions: Decision[], commitments: Commitment[] = []): GroupIntelligenceState => ({
  decisions, commitments, conflicts: [], evidenceMap: {}, history: [],
  topics: [
    { id: 't1', title: 'Goa trip', kind: 'trip', status: 'open', messageIds: ['a'], people: [], firstAt: 0, lastAt: 2 },
    { id: 't2', title: 'Rent', kind: 'bills', status: 'open', messageIds: ['b'], people: [], firstAt: 0, lastAt: 1 },
  ],
});

describe('settle up', () => {
  it('finds the fewest payments that clear everyone, per currency', () => {
    const t = settleUp([
      { name: 'A', currency: '₹', amount: -300 },
      { name: 'B', currency: '₹', amount: -100 },
      { name: 'C', currency: '₹', amount: 400 },
      { name: 'A', currency: '$', amount: -5 },
      { name: 'C', currency: '$', amount: 5 },
    ]);
    expect(t).toEqual([
      { from: 'A', to: 'C', amount: 300, currency: '₹' },
      { from: 'B', to: 'C', amount: 100, currency: '₹' },
      { from: 'A', to: 'C', amount: 5, currency: '$' },
    ]);
  });

  it('nobody owes anything: no payments', () => {
    expect(settleUp([{ name: 'A', currency: '₹', amount: 0 }])).toEqual([]);
  });
});

describe('the live panel', () => {
  it('one card per topic, each with its own money; the group settle-up nets across topics', () => {
    const p = buildPanel(ws, state([bill('Villa', 't1', 4000, 'Arjun'), bill('Rent', 't2', 1000, 'Neha')]), []);
    const goa = p.topics.find(t => t.title === 'Goa trip')!;
    expect(goa.money.map(m => `${m.from}->${m.to} ${m.amount}`).sort()).toEqual(['Dev->Arjun 4000', 'Neha->Arjun 4000']);
    // Net across topics: Arjun +7000, Neha -2000, Dev -5000 (Dev's rent share to Neha is routed straight to Arjun).
    // Two payments instead of four, like Splitwise's "simplify debts".
    expect(p.settle).toEqual([
      { from: 'Dev', to: 'Arjun', amount: 5000, currency: '₹' },
      { from: 'Neha', to: 'Arjun', amount: 2000, currency: '₹' },
    ]);
    expect(p.topics[0].title).toBe('Goa trip'); // most recently active first
  });

  it('a confirmed payment filed outside the topic still clears that topic\'s debt', () => {
    const paid: Commitment = { id: 'p1', conversationId: 'g', ownerId: '', ownerName: 'Dev', description: 'Paid Arjun', status: 'completed', evidenceIds: [], lastUpdatedAt: '', payee: 'Arjun', amount: 4000, currency: '₹', verification: { state: 'confirmed' } as any };
    const p = buildPanel(ws, state([bill('Villa', 't1', 4000, 'Arjun')], [paid]), []);
    expect(p.topics.find(t => t.title === 'Goa trip')!.money.map(m => m.from)).toEqual(['Neha']);
  });

  it('uses the room currency when nobody typed one', () => {
    const d = { ...bill('Villa', 't1', 4000, 'Arjun'), split: { perPerson: 4000, among: 'everyone' as const, collector: 'Arjun' } };
    expect(buildPanel(ws, state([d]), [], { defaultCurrency: '₹' }).settle[0].currency).toBe('₹');
  });
});

describe('the 1,983-message sample group', () => {
  it('settle-up moves exactly the money the topic cards show (no topic leaks into another)', async () => {
    const { readFileSync } = await import('node:fs');
    const state = JSON.parse(readFileSync('src/data/longChat/flat402.state.json', 'utf8'));
    const data = JSON.parse(readFileSync('src/data/longChat/flat402.json', 'utf8')) as { people: string[]; messages: { at: string; speaker: string; text: string }[] };
    const messages = data.messages.map((m, i) => ({ id: `m${i + 1}`, conversationId: 'g', speakerId: m.speaker, speakerName: m.speaker, timestamp: '', content: m.text, type: 'text' as const, createdAt: new Date(m.at).getTime() }));
    const group: Workspace = { ...ws, participants: data.people.map(person) };
    const p = buildPanel(group, state, messages, { defaultCurrency: '₹' });
    const fromCards: Record<string, number> = {};
    p.topics.forEach(t => t.money.forEach(m => { fromCards[m.from] = (fromCards[m.from] ?? 0) - m.amount; fromCards[m.to] = (fromCards[m.to] ?? 0) + m.amount; }));
    const fromSettle: Record<string, number> = {};
    p.settle.forEach(s => { fromSettle[s.from] = (fromSettle[s.from] ?? 0) - s.amount; fromSettle[s.to] = (fromSettle[s.to] ?? 0) + s.amount; });
    for (const name of new Set([...Object.keys(fromCards), ...Object.keys(fromSettle)])) expect(fromSettle[name] ?? 0).toBeCloseTo(fromCards[name] ?? 0, 0);
    // Ravi is a friend, not a flatmate: he never owes rent.
    expect(p.topics.filter(t => /rent/i.test(t.title)).flatMap(t => t.money).some(m => m.from === 'Ravi')).toBe(false);
  });
});

describe('a kept promise and its payment are one transfer (Sunday Chai, Nov 3)', () => {
  const chai: Workspace = { ...ws, participants: ['Kruthik', 'Aniket'].map(person) };
  const done = (id: string, description: string, extra: Partial<Commitment> = {}): Commitment => ({
    id, conversationId: 'g', ownerName: 'Aniket', description, status: 'completed', evidenceIds: [], confidence: 1, lastUpdatedAt: '', topicId: 't1', payee: 'Kruthik', amount: 150, currency: '₹', ...extra,
  } as Commitment);
  const promise = done('c1', 'Pay chai share to Kruthik');
  const screenshot = done('c2', 'Paid Kruthik ₹150', { verification: { state: 'confirmed', reasons: [], decidedBy: 'Kruthik', decidedAt: '', basis: 'recipient_only', receipt: { amount: 150, currency: 'INR', payer: 'Aniket', payee: 'Kruthik', reference: '423156786855', date: null, status: 'Success', summary: '' } } as Commitment['verification'] });

  it('"abhi bhejta hoon", a ₹150 screenshot and "mil gaya", then the bill goes up to ₹175 each: Aniket still owes ₹25', () => {
    const p = buildPanel(chai, state([bill('Chai bill', 't1', 175, 'Kruthik')], [promise, screenshot]), []);
    expect(p.owes).toEqual([{ from: 'Aniket', to: 'Kruthik', amount: 25, currency: '₹' }]);
  });

  it('at ₹150 each the same payment settles it, counted once', () => {
    expect(buildPanel(chai, state([bill('Chai bill', 't1', 150, 'Kruthik')], [promise, screenshot]), []).owes).toEqual([]);
  });

  it('two real payments stay two: a second screenshot is not a promise', () => {
    const second = done('c3', 'Paid Kruthik ₹150', { verification: { ...screenshot.verification!, receipt: { ...screenshot.verification!.receipt!, reference: '999999990001' } } });
    expect(buildPanel(chai, state([bill('Chai bill', 't1', 400, 'Kruthik')], [screenshot, second]), []).owes).toEqual([{ from: 'Aniket', to: 'Kruthik', amount: 100, currency: '₹' }]);
  });

  it('a promise in another thread is a different payment', () => {
    const elsewhere = { ...promise, id: 'c4', topicId: 't2' };
    expect(buildPanel(chai, state([bill('Chai bill', 't1', 175, 'Kruthik'), bill('Rent', 't2', 150, 'Kruthik')], [elsewhere, screenshot]), []).owes).toEqual([{ from: 'Aniket', to: 'Kruthik', amount: 25, currency: '₹' }]);
  });
});

describe('every screen and answer uses the Money tab numbers (Flat 7B, Nov 3)', () => {
  it('@Sorted money lines and the group list match the Money tab exactly', async () => {
    const { readFileSync } = await import('node:fs');
    const { answerMoneyLines, withPanelPairs } = await import('../engine/panel');
    const { computeGroupLedger, computeMySettlement, dedupeBills } = await import('../engine/settle');
    const chat = JSON.parse(readFileSync('src/data/longChat/trio.json', 'utf8'));
    const raw = JSON.parse(readFileSync('src/data/longChat/trio.state.json', 'utf8'));
    const st = raw.state ?? raw;
    const messages = chat.messages ?? chat;
    const flat: Workspace = { ...ws, participants: ['Kruthik', 'Aniket', 'Swapnil'].map(person) };
    const panel = buildPanel(flat, st, messages, { defaultCurrency: '₹' });
    expect(panel.owes.length).toBeGreaterThan(0);
    const lines = answerMoneyLines(panel);
    panel.owes.forEach((o, i) => expect(lines[i]).toContain(`${o.from} owes ${o.to}`));
    expect(lines.join(' ')).not.toMatch(/Nobody owes/);
    const d = dedupeBills(st);
    const ledger = withPanelPairs(computeGroupLedger(flat, d.decisions, d.commitments, { conflicts: st.conflicts, evidenceMap: st.evidenceMap, messages, defaultCurrency: '₹', topics: st.topics }), panel);
    const kruthik = computeMySettlement([ledger], 'Kruthik');
    const owedToKruthik = panel.owes.filter(o => o.to === 'Kruthik').reduce((n, o) => n + o.amount, 0);
    expect(kruthik.owedTotals.reduce((n, t) => n + t.amount, 0)).toBe(owedToKruthik);
  });

  it('says plainly that nothing is owed, so the model never invents a debt', async () => {
    const { answerMoneyLines } = await import('../engine/panel');
    expect(answerMoneyLines({ topics: [], owes: [], settle: [], spend: '', updatedAt: 0 })).toEqual(['Nobody owes anybody anything right now.']);
  });
});
