import { describe, expect, it } from 'vitest';
import { amountFromQuotes } from '../engine/amounts';
import { applyProposals } from '../engine/eventReducer';
import type { GroupIntelligenceState, Message } from '../types/groupOs';

describe('a payment amount read from its quotes', () => {
  it('takes a single amount, adds amounts joined by +, and understands 9k and 18,000', () => {
    expect(amountFromQuotes(['haan bhai aa gaya 19000 received ✅'])).toBe(19000);
    expect(amountFromQuotes(['18000 rent + 1000 electricity bhej diya'])).toBe(19000);
    expect(amountFromQuotes(['bhai baki 9k bhej diya'])).toBe(9000);
    expect(amountFromQuotes(['check kar 6,000'])).toBe(6000);
  });

  it('never guesses from a quote with several unrelated numbers', () => {
    expect(amountFromQuotes(['rent 54k maine diya, aniket ka 18k pending hai'])).toBeUndefined();
  });
});

describe('two payments with different amounts stay two payments', () => {
  const msg = (id: string, speakerName: string, content: string): Message => ({ id, conversationId: 'f', speakerId: speakerName, speakerName, timestamp: '', content, type: 'text', createdAt: 0 });
  const messages = [msg('m1', 'Aniket', 'bhai baki 9k bhej diya'), msg('m2', 'Kruthik', 'haan bhai aa gaya 19000 received')];
  const empty = (): GroupIntelligenceState => ({ decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [] });
  const ctx = { conversationId: 'f', messages, actor: 'model' as const, actorLabel: 't', now: '' };

  it('keeps a later 19,000 payment apart from an earlier 9,000 one with the same description', () => {
    let s = applyProposals(empty(), [{ kind: 'commitment', ownerName: 'Aniket', payee: 'Kruthik', amount: 9000, description: 'Pay rent share to Kruthik', status: 'completed', receivedConfirmed: false, evidence: [{ messageId: 'm1', quote: 'bhai baki 9k bhej diya' }] } as any], ctx).state;
    s = applyProposals(s, [{ kind: 'commitment', ownerName: 'Aniket', payee: 'Kruthik', description: 'Pay rent share to Kruthik', status: 'completed', receivedConfirmed: true, evidence: [{ messageId: 'm2', quote: 'haan bhai aa gaya 19000 received' }] } as any], ctx).state;
    expect(s.commitments.map(c => c.amount).sort()).toEqual([19000, 9000]);
  });
});

describe('flat numbers are not money', () => {
  it('ignores "flat B-402" and "flat 305" in quotes and descriptions', async () => {
    const { amountInText } = await import('../engine/amounts');
    expect(amountFromQuotes(['sent 20000 for flat B-402'])).toBe(20000);
    expect(amountInText('Pay lift repair share for flat B-402')).toBeUndefined();
    expect(amountInText('Pay 1000 electricity share')).toBe(1000);
  });
});

describe('a transfer and its breakdown in one message (Flat 7B, July rent)', () => {
  it('"19k bheja Kruthik ko 18k rent + 1k light wala" is 19,000, not 38,000', () => {
    expect(amountFromQuotes(['19k bheja Kruthik ko 18k rent + 1k light wala'])).toBe(19000);
  });
  it('a sum with no total written still adds up', () => {
    expect(amountFromQuotes(['18k rent + 1k light Kruthik ko'])).toBe(19000);
    expect(amountFromQuotes(['18000 rent + 1000 light = 19000 bhej diya'])).toBe(19000);
  });
});
