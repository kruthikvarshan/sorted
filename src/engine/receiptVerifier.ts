import { Commitment, Evidence, GroupIntelligenceState, ReceiptFacts } from '../types/groupOs';

/**
 * Payment verification has two steps on purpose:
 *   1. assessReceipt: does the image agree with the claim? (a machine check, shown as evidence)
 *   2. confirmPayment / disputePayment: a person concludes. Only this changes a claim into a verified payment.
 * A receipt can be edited or reused, so "consistent" never means "the money moved" until someone says so.
 */

/** When false, a claim with no receipt can never be confirmed: it stays "claim only". */
export const ALLOW_CONFIRM_WITHOUT_RECEIPT = true;

export type Assessment =
  | { kind: 'consistent'; reasons: string[] }
  | { kind: 'mismatch'; reasons: string[] }
  | { kind: 'duplicate'; reasons: string[] }
  | { kind: 'unreadable'; reasons: string[] };

const tokens = (s: string) => s.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/** true/false when both names are known, null when either is missing. "Kiran K" matches "Kiran". */
export function sameName(a?: string | null, b?: string | null): boolean | null {
  if (!a || !b) return null;
  const A = tokens(a);
  const B = tokens(b);
  if (!A.length || !B.length) return null;
  // "Ravi K" and "Ravi S" are two people: both give a second name and it differs ("Ravi K" and "Ravi Kumar" agree).
  if (A.length > 1 && B.length > 1 && A[0] === B[0] && !(A[1].startsWith(B[1]) || B[1].startsWith(A[1]))) return false;
  return A[0] === B[0] || A.every(t => B.includes(t)) || B.every(t => A.includes(t));
}

const CURRENCIES: [RegExp, string][] = [
  [/^(₹|rs\.?|inr|rupees?)$/i, 'INR'],
  [/^(\$|usd|dollars?)$/i, 'USD'],
  [/^(€|eur|euros?)$/i, 'EUR'],
  [/^(£|gbp|pounds?)$/i, 'GBP'],
];
export const normalizeCurrency = (c?: string | null): string | null => {
  const t = c?.trim();
  if (!t) return null;
  return CURRENCIES.find(([re]) => re.test(t))?.[1] ?? t.toUpperCase();
};

/**
 * Two screenshots of one transaction often print the reference differently ("UTR 4032-9981-2210", "Ref: 403299812210").
 * When it contains a long run of digits, that run is the identity; otherwise the cleaned text is.
 */
export const normRef = (r?: string | null) => {
  if (!r) return '';
  const cleaned = r.replace(/[^a-z0-9]/gi, '').toLowerCase();
  const longestDigits = (cleaned.match(/\d+/g) || []).sort((x, y) => y.length - x.length)[0];
  return longestDigits && longestDigits.length >= 8 ? longestDigits : cleaned;
};

const POSITIVE = /success|complet|paid|confirm|done|approved|credited/i;
const NEGATIVE = /fail|declin|pending|reject|revers|cancel|refund|expired|unsuccess/i;

export function assessReceipt(claim: Commitment, facts: ReceiptFacts | null, usedReferences: Set<string>): Assessment {
  if (!facts) {
    return { kind: 'unreadable', reasons: ['The image could not be read as a payment receipt. Try a clearer screenshot.'] };
  }

  const ref = normRef(facts.reference);
  if (ref && usedReferences.has(ref)) {
    return { kind: 'duplicate', reasons: [`Reference ${facts.reference} was already used to back another payment.`] };
  }

  const problems: string[] = [];
  const agrees: string[] = [];

  if (facts.status) {
    if (NEGATIVE.test(facts.status) && !POSITIVE.test(facts.status)) problems.push(`The receipt status is "${facts.status}", not a completed payment.`);
    else agrees.push('status shows success');
  }

  if (claim.amount === undefined) {
    problems.push('The claim has no amount to compare against.');
  } else if (facts.amount === null) {
    problems.push('The receipt amount could not be read.');
  } else if (Math.abs(facts.amount - claim.amount) > 0.009) {
    problems.push(`Amount differs: the receipt shows ${facts.amount}, the claim says ${claim.amount}.`);
  } else {
    agrees.push(`amount ${facts.amount}`);
  }

  const claimCurrency = normalizeCurrency(claim.currency);
  const receiptCurrency = normalizeCurrency(facts.currency);
  if (claimCurrency && receiptCurrency && claimCurrency !== receiptCurrency) {
    problems.push(`Currency differs: the receipt is in ${receiptCurrency}, the claim in ${claimCurrency}.`);
  }

  const payerMatch = sameName(claim.ownerName, facts.payer);
  if (payerMatch === false) problems.push(`Payer differs: the receipt says ${facts.payer}, the claim is from ${claim.ownerName}.`);
  else if (payerMatch) agrees.push('payer');

  const payeeMatch = sameName(claim.payee, facts.payee);
  if (payeeMatch === false) problems.push(`Recipient differs: the receipt says ${facts.payee}, the claim names ${claim.payee}.`);
  else if (payeeMatch) agrees.push('recipient');

  if (problems.length) return { kind: 'mismatch', reasons: problems };
  return { kind: 'consistent', reasons: [`Receipt agrees with the claim (${agrees.join(', ') || 'no conflicting details'}). This is not proof the money moved.`] };
}

type Ctx = { now: string; actorLabel: string };

const withCommitment = (
  input: GroupIntelligenceState,
  commitmentId: string,
  change: (c: Commitment, state: GroupIntelligenceState) => void
): GroupIntelligenceState => {
  const state = structuredClone(input) as GroupIntelligenceState;
  const c = state.commitments.find(x => x.id === commitmentId);
  if (c) change(c, state);
  return state;
};

/** Record what the receipt showed. This never settles the claim by itself. */
export function attachReceipt(
  input: GroupIntelligenceState,
  commitmentId: string,
  facts: ReceiptFacts | null,
  assessment: Assessment,
  ctx: Ctx & { model?: string }
): GroupIntelligenceState {
  return withCommitment(input, commitmentId, c => {
    // A confirmed payment is not reopened by a later receipt.
    if (c.verification?.state === 'confirmed') return;
    const state = {
      consistent: 'receipt_consistent',
      mismatch: 'receipt_mismatch',
      duplicate: 'receipt_duplicate',
      unreadable: 'receipt_unreadable',
    } as const;
    c.verification = {
      state: state[assessment.kind],
      reasons: assessment.reasons,
      receipt: facts ?? undefined,
      readBy: ctx.model,
    };
    c.lastUpdatedAt = ctx.now;
  });
}

export const canConfirm = (c: Commitment, personName: string): boolean =>
  c.verification?.state !== 'confirmed' &&
  (c.payee ? sameName(personName, c.payee) === true : true) &&
  (ALLOW_CONFIRM_WITHOUT_RECEIPT || c.verification?.state === 'receipt_consistent' || c.verification?.state === 'receipt_mismatch');

/** A person concludes the payment arrived. Records who, and whether a receipt backed it. */
export function confirmPayment(input: GroupIntelligenceState, commitmentId: string, by: string, ctx: Ctx): GroupIntelligenceState {
  return withCommitment(input, commitmentId, (c, state) => {
    if (c.verification?.state === 'confirmed') return;
    const hasReceipt = !!c.verification?.receipt;
    const consistent = c.verification?.state === 'receipt_consistent';
    const evId = `ev_confirm_${c.id}`;
    const evidence: Evidence = {
      id: evId,
      messageId: 'user_action_confirm_payment',
      quote: `${by} confirmed the payment${c.amount ? ` of ${c.currency ?? ''}${c.amount}` : ''} was received${consistent ? ', with a matching receipt' : hasReceipt ? ' (the receipt did not fully match)' : ', with no receipt'}.`,
      sourceType: 'user_confirmation',
      verificationStatus: 'supported',
      explanation: 'Confirmed by a person in the group, not inferred by the model.',
    };
    state.evidenceMap[evId] = evidence;
    c.evidenceIds.forEach(id => {
      const ev = state.evidenceMap[id];
      if (ev?.verificationStatus === 'claimed_unverified') {
        ev.verificationStatus = 'supported';
        ev.explanation = `Confirmed by ${by}.`;
      }
    });
    if (!c.evidenceIds.includes(evId)) c.evidenceIds.push(evId);
    c.status = 'completed';
    c.verification = {
      state: 'confirmed',
      reasons: c.verification?.reasons ?? [],
      receipt: c.verification?.receipt,
      readBy: c.verification?.readBy,
      decidedBy: by,
      decidedAt: ctx.now,
      basis: consistent ? 'receipt' : 'recipient_only',
    };
    // The receipt may fill in who was paid when the claim did not say.
    if (!c.payee && c.verification.receipt?.payee) c.payee = c.verification.receipt.payee;
    c.lastUpdatedAt = ctx.now;
  });
}

/** A person says the money did not arrive. The claim stays open and is shown as disputed. */
export function disputePayment(input: GroupIntelligenceState, commitmentId: string, by: string, ctx: Ctx): GroupIntelligenceState {
  return withCommitment(input, commitmentId, c => {
    if (c.verification?.state === 'confirmed') return;
    c.verification = {
      state: 'disputed',
      reasons: [`${by} says the payment was not received.`],
      receipt: c.verification?.receipt,
      readBy: c.verification?.readBy,
      decidedBy: by,
      decidedAt: ctx.now,
    };
    c.lastUpdatedAt = ctx.now;
  });
}

/** References already used by a confirmed or consistent receipt anywhere, so one screenshot cannot back two claims. */
export function usedReferences(all: Commitment[], except?: string): Set<string> {
  return new Set(
    all
      .filter(c => c.id !== except && c.verification?.receipt?.reference)
      .map(c => normRef(c.verification!.receipt!.reference))
      .filter(Boolean)
  );
}
