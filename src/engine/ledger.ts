import { Commitment, PaymentVerification } from '../types/groupOs';

/**
 * Who owes whom, derived only from money commitments (a payee and an amount). Nothing is guessed: commitments
 * without those details do not appear, and a payment claim without a receipt is never counted as settled.
 */

export interface Balance {
  from: string;
  to: string;
  amount: number;
  currency: string;
}

export interface UnverifiedClaim {
  commitmentId: string;
  from: string;
  to?: string;
  amount?: number;
  currency: string;
  description: string;
  verification?: PaymentVerification;
}

export interface SettledPayment {
  commitmentId: string;
  from: string;
  to?: string;
  amount?: number;
  currency: string;
  /** Present only when a person confirmed it. receipt = a matching receipt backed it; recipient_only = no receipt. */
  basis?: 'receipt' | 'recipient_only';
  decidedBy?: string;
}

export interface Ledger {
  /** Outstanding after netting opposite debts, for promises that were accepted. */
  balances: Balance[];
  /** Same, for tentative promises ("I'll try"). Not netted into balances. */
  tentative: Balance[];
  /** "I paid" with no receipt behind it. */
  claims: UnverifiedClaim[];
  /** Payments that are done: confirmed by a person, or completed for another reason. */
  settled: SettledPayment[];
}

const norm = (name: string) => name.trim().toLowerCase();

function net(debts: Balance[]): Balance[] {
  const byPair = new Map<string, { a: string; b: string; currency: string; ab: number }>();
  for (const d of debts) {
    const [x, y] = norm(d.from) < norm(d.to) ? [d.from, d.to] : [d.to, d.from];
    const key = `${norm(x)}|${norm(y)}|${d.currency}`;
    const entry = byPair.get(key) ?? { a: x, b: y, currency: d.currency, ab: 0 };
    // ab > 0 means a owes b
    entry.ab += norm(d.from) === norm(x) ? d.amount : -d.amount;
    byPair.set(key, entry);
  }
  return Array.from(byPair.values())
    .filter(e => Math.abs(e.ab) > 1e-9)
    .map(e => (e.ab > 0 ? { from: e.a, to: e.b, amount: e.ab, currency: e.currency } : { from: e.b, to: e.a, amount: -e.ab, currency: e.currency }))
    .sort((p, q) => q.amount - p.amount);
}

export function computeLedger(commitments: Commitment[]): Ledger {
  const owed: Balance[] = [];
  const tentative: Balance[] = [];
  const settled: SettledPayment[] = [];
  const claims: UnverifiedClaim[] = [];

  for (const c of commitments) {
    if (c.status === 'cancelled') continue;
    const hasMoney = !!c.payee && typeof c.amount === 'number' && c.amount > 0;
    const currency = c.currency ?? '';

    if (c.status === 'needs_clarification') {
      claims.push({ commitmentId: c.id, from: c.ownerName, to: c.payee, amount: c.amount, currency, description: c.description, verification: c.verification });
      continue;
    }
    if (c.status === 'completed' && c.verification?.state === 'confirmed') {
      settled.push({ commitmentId: c.id, from: c.ownerName, to: c.payee, amount: c.amount, currency, basis: c.verification.basis, decidedBy: c.verification.decidedBy });
      continue;
    }
    if (!hasMoney) continue;
    const entry: Balance = { from: c.ownerName, to: c.payee!, amount: c.amount!, currency };
    if (c.status === 'completed') settled.push({ commitmentId: c.id, from: entry.from, to: entry.to, amount: entry.amount, currency });
    else if (c.status === 'proposed') tentative.push(entry);
    else owed.push(entry);
  }

  return { balances: net(owed), tentative, claims, settled };
}

export const formatMoney = (amount: number, currency: string) =>
  `${currency}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
