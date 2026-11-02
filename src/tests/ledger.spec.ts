import { describe, expect, it } from 'vitest';
import { computeLedger, formatMoney } from '../engine/ledger';
import { Commitment } from '../types/groupOs';

let n = 0;
const c = (ownerName: string, payee: string | undefined, amount: number | undefined, status: Commitment['status'], currency = '₹'): Commitment => ({
  id: `c${n++}`, conversationId: 'w', ownerId: `u_${ownerName}`, ownerName, description: `${ownerName} pays ${payee}`, status,
  evidenceIds: [], lastUpdatedAt: '', ...(payee ? { payee } : {}), ...(amount !== undefined ? { amount } : {}), currency,
});

describe('who owes whom', () => {
  it('lists an accepted promise as an outstanding balance', () => {
    expect(computeLedger([c('Aman', 'Neha', 3000, 'accepted')]).balances).toEqual([{ from: 'Aman', to: 'Neha', amount: 3000, currency: '₹' }]);
  });

  it('nets opposite debts between the same two people', () => {
    const l = computeLedger([c('Aman', 'Neha', 3000, 'accepted'), c('Neha', 'Aman', 1200, 'in_progress')]);
    expect(l.balances).toEqual([{ from: 'Aman', to: 'Neha', amount: 1800, currency: '₹' }]);
  });

  it('cancels out completely when the debts are equal', () => {
    expect(computeLedger([c('Aman', 'Neha', 500, 'accepted'), c('Neha', 'Aman', 500, 'accepted')]).balances).toEqual([]);
  });

  it('adds several debts from one person to another and keeps currencies apart', () => {
    const l = computeLedger([c('Ravi', 'Sita', 1500, 'accepted'), c('Ravi', 'Sita', 500, 'accepted'), c('Ravi', 'Sita', 20, 'accepted', '$')]);
    expect(l.balances).toEqual([
      { from: 'Ravi', to: 'Sita', amount: 2000, currency: '₹' },
      { from: 'Ravi', to: 'Sita', amount: 20, currency: '$' },
    ]);
  });

  it('matches names regardless of case and spacing', () => {
    expect(computeLedger([c('aman', 'NEHA', 100, 'accepted'), c('Neha ', 'Aman', 30, 'accepted')]).balances[0].amount).toBe(70);
  });

  it('never counts a payment claim as settled or owed: it is listed as unverified', () => {
    const l = computeLedger([c('Kiran', 'Sita', 1500, 'needs_clarification')]);
    expect(l.balances).toEqual([]);
    expect(l.settled).toEqual([]);
    expect(l.claims).toEqual([expect.objectContaining({ from: 'Kiran', to: 'Sita', amount: 1500 })]);
  });

  it('keeps a claim visible even when the model gave no payee or amount', () => {
    expect(computeLedger([c('Zoya', undefined, undefined, 'needs_clarification')]).claims).toHaveLength(1);
  });

  it('keeps tentative promises out of the balances', () => {
    const l = computeLedger([c('Marcus', 'Dana', 620, 'proposed')]);
    expect(l.balances).toEqual([]);
    expect(l.tentative).toHaveLength(1);
  });

  it('ignores cancelled commitments, and commitments with no money details', () => {
    const l = computeLedger([c('Riley', 'Sam', 100, 'cancelled'), c('Riley', undefined, undefined, 'accepted'), c('Riley', 'Sam', undefined, 'accepted')]);
    expect(l).toEqual({ balances: [], tentative: [], claims: [], settled: [] });
  });

  it('lists verified, completed payments as settled', () => {
    expect(computeLedger([c('Neha', 'Aman', 12000, 'completed')]).settled).toHaveLength(1);
  });

  it('formats money with the currency and Indian digit grouping', () => {
    expect(formatMoney(150000, '₹')).toBe('₹1,50,000');
    expect(formatMoney(1800, '$')).toBe('$1,800');
  });
});
