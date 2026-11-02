import { describe, expect, it } from 'vitest';
import { applyProposals, looksLikePayment, Proposal } from '../engine/eventReducer';
import { GroupIntelligenceState, Message } from '../types/groupOs';

const msg = (id: string, speakerName: string, content: string): Message => ({
  id, conversationId: 'w', speakerId: `u_${speakerName}`, speakerName, timestamp: '9:00', content, type: 'text', createdAt: 0,
});
const CHAT = [msg('a', 'Zoya', 'WiFi pay kar diya'), msg('b', 'Sam', 'I booked the table'), msg('c', 'Neha', 'maine rent bhej diya'), msg('d', 'Leo', 'invitations bhej diye')];
const empty = (): GroupIntelligenceState => ({ decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [] });
const run = (p: Proposal) => applyProposals(empty(), [p], { conversationId: 'w', messages: CHAT, actor: 'model', actorLabel: 't', now: '9:00' }).state;
const done = (ownerName: string, description: string, messageId: string, quote: string, paymentClaim?: boolean): Proposal =>
  ({ kind: 'commitment', ownerName, description, status: 'completed', ...(paymentClaim === undefined ? {} : { paymentClaim }), evidence: [{ messageId, quote }] });

describe('payment claims stay unverified even if the model forgets the flag', () => {
  it('"Pay WiFi bill" marked completed without paymentClaim is held as a claim', () => {
    const state = run(done('Zoya', 'Pay WiFi bill', 'a', 'WiFi pay kar diya'));
    expect(state.commitments[0].status).toBe('needs_clarification');
    expect(state.evidenceMap[state.commitments[0].evidenceIds[0]].verificationStatus).toBe('claimed_unverified');
  });

  it('rent, refunds and amounts are treated as money too', () => {
    expect(run(done('Neha', 'Sent rent share', 'c', 'maine rent bhej diya')).commitments[0].status).toBe('needs_clarification');
    ['Refund Neha ₹3,000', 'Transferred 5000 to Teja', 'Paid the advance', 'Settle the bill', 'Sent Rs 500'].forEach(d => expect(looksLikePayment(d), d).toBe(true));
  });

  it('ordinary completed work is not touched', () => {
    expect(run(done('Sam', 'Book the table', 'b', 'I booked the table')).commitments[0].status).toBe('completed');
    expect(run(done('Leo', 'Send the invitations', 'd', 'invitations bhej diye')).commitments[0].status).toBe('completed');
    ['Book train tickets', 'Bring the firewood', 'Check the meter reading', 'Send the invitation emails'].forEach(d => expect(looksLikePayment(d), d).toBe(false));
  });

  it('the explicit flag still works for wording the backstop would not catch', () => {
    expect(run(done('Zoya', 'Took care of it', 'a', 'WiFi pay kar diya', true)).commitments[0].status).toBe('needs_clarification');
  });

  it('an unverified claim is never upgraded to completed by a later repeat', () => {
    const first = run(done('Zoya', 'Pay WiFi bill', 'a', 'WiFi pay kar diya'));
    const again = applyProposals(first, [done('Zoya', 'Pay WiFi bill', 'a', 'WiFi pay kar diya')], { conversationId: 'w', messages: CHAT, actor: 'model', actorLabel: 't', now: '9:01' }).state;
    expect(again.commitments).toHaveLength(1);
    expect(again.commitments[0].status).toBe('needs_clarification');
  });
});

describe('the receiver confirming in the chat', () => {
  const msgs: Message[] = [
    { id: 'p1', conversationId: 'g', speakerId: 'a', speakerName: 'Arjun', timestamp: '', content: 'sent you the rent', type: 'text', createdAt: 1 },
    { id: 'p2', conversationId: 'g', speakerId: 'n', speakerName: 'Neha', timestamp: '', content: 'got it Arjun, thanks', type: 'text', createdAt: 2 },
  ];
  const ctx = { conversationId: 'g', messages: msgs, actor: 'model' as const, actorLabel: 'Meta AI', now: 'now' };
  const empty = { decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [] };

  it('settles the payment when the cited confirmation is from the receiver', () => {
    const claim = { kind: 'commitment' as const, ownerName: 'Arjun', description: 'Paid Neha the rent', status: 'completed' as const, paymentClaim: true, payee: 'Neha', evidence: [{ messageId: 'p1', quote: 'sent you the rent' }] };
    const after = applyProposals(empty, [claim], ctx).state;
    expect(after.commitments[0].status).toBe('needs_clarification');
    const confirmed = applyProposals(after, [{ ...claim, receivedConfirmed: true, evidence: [{ messageId: 'p2', quote: 'got it Arjun, thanks' }] }], ctx).state;
    expect(confirmed.commitments[0].status).toBe('completed');
    expect(confirmed.commitments[0].verification).toMatchObject({ state: 'confirmed', decidedBy: 'Neha', basis: 'recipient_only' });
  });

  it('does not settle it when the "confirmation" is from someone else (for example the payer)', () => {
    const claim = { kind: 'commitment' as const, ownerName: 'Arjun', description: 'Paid Neha the rent', status: 'completed' as const, paymentClaim: true, payee: 'Neha', receivedConfirmed: true, evidence: [{ messageId: 'p1', quote: 'sent you the rent' }] };
    expect(applyProposals(empty, [claim], ctx).state.commitments[0].status).toBe('needs_clarification');
  });
});

describe('the person who set a bill correcting it (Sunday Chai, Nov 3)', () => {
  const chat = [msg('m1', 'Kruthik', 'Bill 300 aaya, 150 each'), msg('m2', 'Aniket', 'Theek hai'), msg('m3', 'Kruthik', 'Bhai chai samosa 350 hua actually'), msg('m4', 'Kruthik', 'So 175 per person'), msg('m5', 'Aniket', 'nahi yaar 300 hi tha')];
  const ctx = { conversationId: 'w', messages: chat, actor: 'model' as const, actorLabel: 't', now: '9:00' };
  const bill = (value: string, each: number, status: 'confirmed' | 'proposed', ids: string[]): Proposal => ({
    kind: 'decision', topic: 'Chai bill', value, status, split: { perPerson: each, currency: '₹', among: ['Kruthik', 'Aniket'], collector: 'Kruthik' },
    evidence: ids.map(id => ({ messageId: id, quote: chat.find(m => m.id === id)!.content })),
  } as Proposal);
  const first = applyProposals(empty(), [bill('300 total', 150, 'confirmed', ['m1', 'm2'])], ctx).state;

  it('is an update with history, even when the model only calls it a proposal: no disagreement', () => {
    const s = applyProposals(first, [bill('350 total', 175, 'proposed', ['m3', 'm4'])], ctx).state;
    const d = s.decisions[0];
    expect(d.currentValue).toBe('350 total');
    expect(d.split?.perPerson).toBe(175);
    expect(s.conflicts).toHaveLength(0);
    expect(d.history.some(h => h.previousValue === '300 total' && /Kruthik, who set it/.test(h.reason))).toBe(true);
  });

  it('someone else changing it is still a disagreement', () => {
    const s = applyProposals(first, [bill('250 total', 125, 'proposed', ['m5'])], ctx).state;
    expect(s.decisions[0].currentValue).toBe('300 total');
    expect(s.conflicts).toHaveLength(1);
  });
});
