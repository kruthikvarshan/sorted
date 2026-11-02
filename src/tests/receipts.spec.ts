import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALLOW_CONFIRM_WITHOUT_RECEIPT,
  assessReceipt,
  attachReceipt,
  canConfirm,
  confirmPayment,
  disputePayment,
  normalizeCurrency,
  sameName,
  usedReferences,
} from '../engine/receiptVerifier';
import { computeLedger } from '../engine/ledger';
import { parseReceiptReply, readReceipt } from '../services/receiptReader';
import { Commitment, GroupIntelligenceState, ReceiptFacts } from '../types/groupOs';

const claim = (over: Partial<Commitment> = {}): Commitment => ({
  id: 'c1', conversationId: 'w', ownerId: 'u_kiran', ownerName: 'Kiran', description: 'Paid Sita 1500', status: 'needs_clarification',
  evidenceIds: ['ev1'], lastUpdatedAt: '', payee: 'Sita', amount: 1500, currency: '₹', ...over,
});
const facts = (over: Partial<ReceiptFacts> = {}): ReceiptFacts => ({
  amount: 1500, currency: 'INR', payer: 'Kiran K', payee: 'Sita R', reference: '403299812210', date: '24 Oct 2025', status: 'SUCCESS', summary: 'UPI payment', ...over,
});
const stateWith = (c: Commitment): GroupIntelligenceState => ({
  decisions: [], commitments: [c], conflicts: [], history: [],
  evidenceMap: { ev1: { id: 'ev1', messageId: 'm1', quote: 'Sita ki 1500 pampinchanu', sourceType: 'message', verificationStatus: 'claimed_unverified', explanation: 'Payment claimed in chat; no receipt has been verified.' } },
});
const ctx = { now: '10:00', actorLabel: 'Alex' };

describe('matching a receipt to a claim', () => {
  it('matches names loosely and currencies by meaning', () => {
    expect(sameName('Kiran K', 'Kiran')).toBe(true);
    expect(sameName('Sita R', 'sita')).toBe(true);
    expect(sameName('Kiran', 'Anji')).toBe(false);
    expect(sameName('Kiran', null)).toBeNull();
    expect(['₹', 'Rs.', 'INR', 'rupees'].map(normalizeCurrency)).toEqual(['INR', 'INR', 'INR', 'INR']);
    expect(normalizeCurrency('$')).toBe('USD');
  });

  it('calls a receipt consistent when amount, status, payer and recipient agree, and says that is not proof', () => {
    const a = assessReceipt(claim(), facts(), new Set());
    expect(a.kind).toBe('consistent');
    expect(a.reasons[0]).toMatch(/agrees with the claim/);
    expect(a.reasons[0]).toMatch(/not proof the money moved/);
  });

  it.each([
    ['a different amount', facts({ amount: 1200 }), /Amount differs: the receipt shows 1200, the claim says 1500/],
    ['a different recipient', facts({ payee: 'Anji' }), /Recipient differs/],
    ['a different payer', facts({ payer: 'Madhu' }), /Payer differs/],
    ['a different currency', facts({ currency: 'USD' }), /Currency differs/],
    ['a failed payment', facts({ status: 'FAILED' }), /not a completed payment/],
    ['a pending payment', facts({ status: 'Pending' }), /not a completed payment/],
    ['an unreadable amount', facts({ amount: null }), /amount could not be read/],
  ])('flags %s', (_name, f, reason) => {
    const a = assessReceipt(claim(), f, new Set());
    expect(a.kind).toBe('mismatch');
    expect(a.reasons.join(' ')).toMatch(reason);
  });

  it('cannot compare when the claim itself has no amount', () => {
    const a = assessReceipt(claim({ amount: undefined }), facts(), new Set());
    expect(a.kind).toBe('mismatch');
    expect(a.reasons.join(' ')).toMatch(/no amount to compare/);
  });

  it('copes with a receipt that omits payer, recipient and status', () => {
    expect(assessReceipt(claim(), facts({ payer: null, payee: null, status: null }), new Set()).kind).toBe('consistent');
  });

  it('reports an unreadable image, and a reference that already backed another claim', () => {
    expect(assessReceipt(claim(), null, new Set()).kind).toBe('unreadable');
    const used = usedReferences([claim({ id: 'other', verification: { state: 'confirmed', reasons: [], receipt: facts({ reference: 'UTR 4032-9981-2210' }) } })]);
    expect(assessReceipt(claim(), facts({ reference: '403299812210' }), used).kind).toBe('duplicate');
  });

  it('does not count a claim\'s own earlier receipt as a duplicate of itself', () => {
    const self = claim({ verification: { state: 'receipt_consistent', reasons: [], receipt: facts() } });
    expect(usedReferences([self], 'c1').size).toBe(0);
  });
});

describe('the image is evidence, a person concludes', () => {
  it('reading a consistent receipt does NOT settle the claim', () => {
    const before = stateWith(claim());
    const after = attachReceipt(before, 'c1', facts(), assessReceipt(claim(), facts(), new Set()), { ...ctx, model: 'muse-spark-1.3' });
    const c = after.commitments[0];
    expect(c.status).toBe('needs_clarification'); // still a claim
    expect(c.verification).toMatchObject({ state: 'receipt_consistent', readBy: 'muse-spark-1.3' });
    expect(after.evidenceMap.ev1.verificationStatus).toBe('claimed_unverified');
    expect(computeLedger(after.commitments).settled).toEqual([]);
    expect(computeLedger(after.commitments).claims[0].verification?.state).toBe('receipt_consistent');
  });

  it('a person confirming settles it, and records who and that a receipt backed it', () => {
    let s = stateWith(claim());
    s = attachReceipt(s, 'c1', facts(), assessReceipt(claim(), facts(), new Set()), ctx);
    s = confirmPayment(s, 'c1', 'Sita', ctx);
    const c = s.commitments[0];
    expect(c.status).toBe('completed');
    expect(c.verification).toMatchObject({ state: 'confirmed', decidedBy: 'Sita', basis: 'receipt' });
    expect(s.evidenceMap.ev1.verificationStatus).toBe('supported');
    expect(Object.values(s.evidenceMap).some(e => e.sourceType === 'user_confirmation' && /Sita confirmed/.test(e.quote) && /matching receipt/.test(e.quote))).toBe(true);
    expect(computeLedger(s.commitments).settled[0]).toMatchObject({ basis: 'receipt', decidedBy: 'Sita' });
    expect(computeLedger(s.commitments).claims).toEqual([]);
  });

  it('with no image the claim stays claim-only, and the recipient can still confirm, labelled as having no receipt', () => {
    expect(computeLedger(stateWith(claim()).commitments).claims[0].verification).toBeUndefined();
    expect(ALLOW_CONFIRM_WITHOUT_RECEIPT).toBe(true);
    const s = confirmPayment(stateWith(claim()), 'c1', 'Sita', ctx);
    expect(s.commitments[0].verification).toMatchObject({ state: 'confirmed', basis: 'recipient_only' });
    expect(Object.values(s.evidenceMap).some(e => /with no receipt/.test(e.quote))).toBe(true);
  });

  it('a mismatching receipt still lets the recipient decide, and is recorded as not matching', () => {
    let s = stateWith(claim());
    s = attachReceipt(s, 'c1', facts({ amount: 1200 }), assessReceipt(claim(), facts({ amount: 1200 }), new Set()), ctx);
    s = confirmPayment(s, 'c1', 'Sita', ctx);
    expect(s.commitments[0].verification?.basis).toBe('recipient_only');
    expect(Object.values(s.evidenceMap).some(e => /did not fully match/.test(e.quote))).toBe(true);
  });

  it('only the recipient may confirm when the payee is known; anyone may when it is not', () => {
    expect(canConfirm(claim(), 'Sita')).toBe(true);
    expect(canConfirm(claim(), 'Alex')).toBe(false);
    expect(canConfirm(claim({ payee: undefined }), 'Alex')).toBe(true);
    expect(canConfirm(claim({ verification: { state: 'confirmed', reasons: [] } }), 'Sita')).toBe(false);
  });

  it('confirming is idempotent and a later receipt cannot reopen a confirmed payment', () => {
    let s = confirmPayment(stateWith(claim()), 'c1', 'Sita', ctx);
    const once = JSON.stringify(s.commitments[0]);
    s = confirmPayment(s, 'c1', 'Sita', { ...ctx, now: '11:00' });
    expect(JSON.stringify(s.commitments[0])).toBe(once);
    s = attachReceipt(s, 'c1', facts({ amount: 99 }), assessReceipt(claim(), facts({ amount: 99 }), new Set()), ctx);
    expect(s.commitments[0].verification?.state).toBe('confirmed');
  });

  it('the receipt can fill in who was paid when the claim did not say', () => {
    let s = stateWith(claim({ payee: undefined }));
    s = attachReceipt(s, 'c1', facts(), assessReceipt(claim({ payee: undefined }), facts(), new Set()), ctx);
    s = confirmPayment(s, 'c1', 'Alex', ctx);
    expect(s.commitments[0].payee).toBe('Sita R');
  });

  it('disputing keeps the claim open and visible as disputed', () => {
    const s = disputePayment(stateWith(claim()), 'c1', 'Sita', ctx);
    expect(s.commitments[0].status).toBe('needs_clarification');
    expect(s.commitments[0].verification).toMatchObject({ state: 'disputed', decidedBy: 'Sita' });
    expect(computeLedger(s.commitments).claims[0].verification?.reasons[0]).toMatch(/Sita says the payment was not received/);
  });
});

describe('reading the receipt image with the model', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (content: string) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });

  it('parses fenced JSON, numeric strings, and keeps unknown fields null', () => {
    const f = parseReceiptReply('```json\n{"legible":true,"amount":"1,500.00","currency":"INR","payer":"Kiran K","payee":null,"reference":"403299812210","date":null,"status":"SUCCESS","summary":"UPI payment"}\n```');
    expect(f).toMatchObject({ amount: 1500, payer: 'Kiran K', payee: null, date: null });
  });

  it('treats "not legible" and an empty read as unreadable, never as a receipt with no facts', () => {
    expect(parseReceiptReply('{"legible":false}')).toBeNull();
    expect(parseReceiptReply('{"legible":true,"amount":null,"payer":null,"payee":null,"reference":null,"summary":"blurry"}')).toBeNull();
  });

  it('sends the image to Spark as an image part, deterministically, and returns the facts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('{"legible":true,"amount":1500,"currency":"INR","payer":"Kiran K","payee":"Sita R","reference":"R1","date":"x","status":"SUCCESS","summary":"s"}'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await readReceipt('k', 'data:image/jpeg;base64,AAAA');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('muse-spark-1.3');
    expect(body.temperature).toBe(0);
    const userParts = body.messages[1].content;
    expect(userParts.find((p: any) => p.type === 'image_url').image_url.url).toBe('data:image/jpeg;base64,AAAA');
    expect(body.messages[0].content).toMatch(/Never guess, infer or complete a field/);
    expect(res.data).toMatchObject({ amount: 1500, payee: 'Sita R' });
  });

  it('returns success with no facts when the model says it is not a receipt, and an error when the call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply('{"legible":false}')));
    expect(await readReceipt('k', 'data:image/jpeg;base64,AAAA')).toMatchObject({ success: true, data: null });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }));
    expect((await readReceipt('k', 'data:image/jpeg;base64,AAAA')).success).toBe(false);
  });
});

describe('reference matching across screenshots', () => {
  const used = (ref: string) => usedReferences([claim({ id: 'other', verification: { state: 'confirmed', reasons: [], receipt: facts({ reference: ref }) } })]);

  it('treats differently printed forms of one transaction id as the same', () => {
    ['UTR 4032-9981-2210', 'Ref: 403299812210', 'RRN403299812210', '403299812210'].forEach(printed =>
      expect(assessReceipt(claim(), facts({ reference: '403299812210' }), used(printed)).kind).toBe('duplicate')
    );
  });

  it('does not confuse different transactions, or short numbers', () => {
    expect(assessReceipt(claim(), facts({ reference: '403299812211' }), used('403299812210')).kind).toBe('consistent');
    expect(assessReceipt(claim(), facts({ reference: '1234' }), used('5678')).kind).toBe('consistent');
    expect(assessReceipt(claim(), facts({ reference: 'AB-12' }), used('ab12')).kind).toBe('duplicate'); // short ids compare as cleaned text
  });
});
