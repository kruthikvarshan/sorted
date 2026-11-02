import { Commitment, Conflict, Decision, Evidence, GroupIntelligenceState, Message, Topic, Workspace } from '../types/groupOs';
import { formatMoney } from './ledger';
import { topicsMatch } from './eventReducer';
import { billName, countsAsOwed, groupSplits, perShare, ShareState, shareStateFor } from './shares';
import { normalizeCurrency, sameName } from './receiptVerifier';
import { amountFromQuotes, amountInText, capByMessage } from './amounts';
export { amountFromQuotes } from './amounts';

/**
 * Money inside one group, the way Splitwise does it.
 *
 *  - Every counted split makes each member owe the person who paid or collects.
 *  - Promises to pay a named person ("Madhu: pay Sita 1,500") are debts too, unless the split already covers them.
 *  - Inside a group, what two people owe each other is netted: what Neha owes Arjun is deducted from what Arjun owes Neha.
 *  - A payment only settles a debt once a person confirmed it. "I paid" still counts as owed, marked as waiting.
 *  - Splits the group disagrees about are listed as waiting, and are not counted.
 *  - Different groups are never netted against each other: each group stands alone.
 */

export interface Debt {
  from: string;
  to?: string;
  amount: number;
  currency: string;
  reason: string;
  state: Exclude<ShareState, 'paid'>;
  agreed: boolean;
  decisionId?: string;
  /** Paid to someone outside the group, so nobody in it collects. */
  outside?: boolean;
  /** Nobody is named as the one to pay yet: an action for the group. */
  needsRecipient?: boolean;
}

export interface PairItem {
  decisionId?: string;
  reason: string;
  amount: number;
  /** owes = adds to what `from` owes; offsets = what `to` owes back, deducted; paid = a confirmed payment, deducted. */
  direction: 'owes' | 'offsets' | 'paid';
  state: Debt['state'];
  agreed: boolean;
}

export interface Pair {
  from: string;
  to: string;
  amount: number;
  currency: string;
  items: PairItem[];
  /** True when part of the amount is "says paid, not confirmed yet". */
  pending: boolean;
}

export interface WaitingSplit {
  topic: string;
  why: string;
  /** What the disagreement is, in a sentence. */
  detail?: string;
  /** What each person would pay if it goes ahead. */
  eachAmount?: number;
  currency?: string;
  /** Who that would apply to. */
  appliesTo?: string[];
  conflictId?: string;
  messageId?: string;
}

export interface Bill {
  decisionId: string;
  topic: string;
  /** What each person pays, and the whole bill. */
  each: number;
  total: number;
  currency: string;
  people: string[];
  collector?: string;
}

export interface GroupLedger {
  workspaceId: string;
  /** Every counted shared cost in the group (not the ones still waiting on the group). */
  bills: Bill[];
  title: string;
  pairs: Pair[];
  /** Owed, but the chat never says to whom. */
  unassigned: Debt[];
  /** Splits not counted yet because the group has not settled them. */
  waiting: WaitingSplit[];
  /** Net position per person: positive = is owed, negative = owes. Per currency. */
  net: { name: string; currency: string; amount: number }[];
}

const SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };
const symbolOf = (code: string) => SYMBOL[code] ?? (code ? `${code} ` : '');
const ckey = (c: string) => normalizeCurrency(c) ?? '';
const numbersIn = (text: string) => (text.replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, b * 0.01);

/** Where a debt stands, from payments the chat or a person recorded for it. */
function stateOf(debt: { from: string; to?: string; amount: number }, decision: Decision | undefined, commitments: Commitment[]): ShareState {
  const own = decision ? shareStateFor(decision, debt.from, commitments) : 'unpaid';
  if (own !== 'unpaid') return own;
  const mine = commitments.filter(
    c =>
      c.status !== 'cancelled' &&
      !c.shareOfDecisionId &&
      sameName(debt.from, c.ownerName) === true &&
      !!c.payee &&
      !!debt.to &&
      sameName(debt.to, c.payee) === true &&
      !!c.amount &&
      near(c.amount, debt.amount)
  );
  if (mine.some(c => c.status === 'completed')) return 'paid';
  if (mine.some(c => c.status === 'needs_clarification' && c.verification?.state !== 'disputed')) return 'claimed';
  return 'unpaid';
}

const GENERIC = new Set(['share', 'shares', 'person', 'bill', 'total', 'cost', 'costs', 'budget', 'each', 'trip', 'payment', 'split', 'group']);
const wordsOf = (t: string) => (t.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter(w => !GENERIC.has(w));
const MONEYISH = /[₹$€£]|\b\d{3,}\b|budget|cost|price|pay|bill|rent|split|expens/i;

/** Everyone pays for themselves: no shared bill. */
export const EACH_OWN = /\b(each (one )?pays? (for )?(their|his|her) own|everyone pays? (for )?(themselves|their own)|pay (for )?(your|their) own|apna apna|apna-apna|apne apne|khud ka khud|evari di vallu|evaridi varu)\b/i;

/** A plan called off, in English or Hindi/Telugu written in English letters. */
const CANCELLED = /\b(cancel(l?ed)?|called off|call off|is off|not happening|nahi ho raha|nahi hoga|drop kar|dropped|plan drop|band hai|postpone[d]?|aagipoyindi|cancel ayyindi)\b/i;

/** Words that mean the plan goes on in another form. */
const GOES_ON = /\b(final|confirmed|instead|wala|rather|switch(ed)? to|book(ed)? the other)\b/i;

/** The person who objected gives in. */
const CONCEDE = /\b(theek hai|thik hai|thik h|ok|okay|fine|agreed|de denge|de dunga|de deta|chalo|sare|sari|done|alright)\b/i;

const OBJECTION = /\b(no way|too (much|expensive|costly)|blows?|can'?t afford|cannot afford|not (paying|ok with|okay with|comfortable)|won'?t pay|i'?m out|disagree|against (it|this)|over (my |the )?budget|skip (it|this)|drop (it|this))\b/i;

/**
 * One bill, counted once. People recap what is owed ("settling up after Goa: flights 4,800 to Neha"), so the same bill
 * can be recorded in two parts of one plan ("Goa trip: travel" and "Goa trip: settling up"). Within one plan, a bill
 * with the same collector and the same amount per person is kept in the earliest topic only (the later copy stays as
 * information without money). Separate plans, like each month's rent, are never merged even when the amounts match.
 */
export function dedupeBills(state: GroupIntelligenceState): GroupIntelligenceState {
  const topics = new Map((state.topics ?? []).map(t => [t.id, t]));
  const plan = (topicId?: string) => (topicId ? topics.get(topicId)?.title.split(':')[0].trim().toLowerCase() : undefined);
  const hasPart = (topicId?: string) => !!topicId && !!topics.get(topicId)?.title.includes(':');
  const each = (d: Decision) => d.split!.perPerson || d.split!.total || 0;
  const order = (d: Decision) => topics.get(d.topicId ?? '')?.firstAt ?? 0;
  const bills = state.decisions.filter(d => d.split?.collector && d.topicId).sort((a, b) => order(a) - order(b));
  // The same thing filed under two topics close together ("Hall AC purchase" and "Second AC purchase" twelve days
  // apart, with the same collector and share): one bill. Each month's rent is four weeks apart, so it never matches.
  const sameThing = (a?: string, b?: string) => {
    const A = a ? topics.get(a) : undefined;
    const B = b ? topics.get(b) : undefined;
    if (!A || !B) return false;
    // "Rent, August" and "Rent, September" are different bills, however close together.
    const month = (t: string) => t.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/)?.[1];
    if (month(A.title) && month(B.title) && month(A.title) !== month(B.title)) return false;
    // Parts of one plan ("Divya wedding: travel", "Divya wedding: family gift") share the plan's name, not a thing:
    // only the part after the plan name is compared.
    const part = (t: string) => (t.includes(':') ? t.split(':').slice(1).join(':') : t);
    const samePlan = A.title.includes(':') && B.title.includes(':') && A.title.split(':')[0].trim().toLowerCase() === B.title.split(':')[0].trim().toLowerCase();
    const words = new Set(wordsOf(samePlan ? part(A.title) : A.title));
    return Math.abs(A.firstAt - B.firstAt) <= SAME_THING_MS && wordsOf(samePlan ? part(B.title) : B.title).some(w => words.has(w));
  };
  const drop = new Set<string>();
  bills.forEach((d, i) => {
    if (drop.has(d.id)) return;
    for (const later of bills.slice(i + 1)) {
      if (drop.has(later.id) || later.topicId === d.topicId) continue;
      const samePlan = plan(d.topicId) === plan(later.topicId) && (hasPart(d.topicId) || hasPart(later.topicId));
      const sameCollector = sameName(d.split!.collector, later.split!.collector) === true;
      const sameBill = sameCollector && Math.abs(each(d) - each(later)) < 1 && !!d.split!.perPerson === !!later.split!.perPerson;
      // A recap later in the same plan ("villa & dinner settling: villa 4,500") is the same bill, even with another figure.
      const sameName_ = sameCollector && billName(d.topic).toLowerCase() === billName(later.topic).toLowerCase();
      if ((sameBill && (samePlan || sameThing(d.topicId, later.topicId))) || (samePlan && sameName_)) drop.add(later.id);
    }
  });
  // A promise to pay someone, said again in another topic a few days later ("Aniket ka 15,000 Swapnil pe hai"), is the
  // same promise: it is owed once.
  const promises = state.commitments
    .filter(c => c.payee && c.amount && !c.shareOfDecisionId && (c.status === 'accepted' || c.status === 'in_progress') && c.topicId)
    .sort((a, b) => (topics.get(a.topicId!)?.firstAt ?? 0) - (topics.get(b.topicId!)?.firstAt ?? 0));
  const repeated = new Set<string>();
  promises.forEach((c, i) => {
    if (repeated.has(c.id)) return;
    for (const later of promises.slice(i + 1)) {
      if (later.topicId === c.topicId || repeated.has(later.id)) continue;
      const near = Math.abs((topics.get(later.topicId!)?.firstAt ?? 0) - (topics.get(c.topicId!)?.firstAt ?? 0)) <= SAME_THING_MS;
      if (near && sameName(c.ownerName, later.ownerName) === true && sameName(c.payee, later.payee) === true && Math.abs(c.amount! - later.amount!) < 1) repeated.add(later.id);
    }
  });
  // A promise to pay someone you already owe a share to ("pay villa + dinner dues to Arjun", "remaining 6,000 after my
  // bonus") is a promise to pay those shares, not a new debt. Promises on their own (paying back a loan, a lost bet)
  // still count.
  // Only a share in the same topic or the same plan counts: in a flat everyone owes everyone some share, and a loan
  // or a bet is not a promise to pay the wifi.
  const owesShareTo = (c: Commitment) =>
    state.decisions.some(d => {
      const split = d.split;
      if (!split?.collector || drop.has(d.id) || sameName(split.collector, c.payee) !== true || sameName(c.ownerName, c.payee) === true) return false;
      // Same thread, or the same thing filed twice; within one plan only when the amount is that share (a 15k gift
      // promise is not the train-ticket share of the same wedding).
      // What this person owes the payee across the plan's bills ("villa + dinner dues" covers both shares).
      const planShares = state.decisions
        .filter(x => x.split?.collector && !drop.has(x.id) && sameName(x.split.collector, c.payee) === true && plan(x.topicId) === plan(c.topicId) && (x.split.among === 'everyone' || x.split.among.some(n => sameName(n, c.ownerName) === true)))
        .reduce((sum, x) => sum + (x.split!.perPerson || 0), 0);
      const named = wordsOf(billName(d.topic)).some(w => wordsOf(c.description).includes(w));
      const fits = named || (!!c.amount && planShares > 0 && c.amount <= planShares + 0.5);
      const together = d.topicId === c.topicId || sameThing(d.topicId, c.topicId) || (!!plan(d.topicId) && plan(d.topicId) === plan(c.topicId) && (hasPart(d.topicId) || hasPart(c.topicId)) && fits);
      return together && (split.among === 'everyone' || split.among.some(n => sameName(n, c.ownerName) === true));
    });
  const repaysLoan = (c: Commitment) =>
    state.commitments.some(p => p.status === 'completed' && p.amount && Math.abs(p.amount - c.amount!) < 1 && sameName(p.ownerName, c.payee) === true && sameName(p.payee, c.ownerName) === true);
  promises.forEach(c => {
    if (!repeated.has(c.id) && owesShareTo(c) && !repaysLoan(c)) repeated.add(c.id);
  });
  if (!drop.size && !repeated.size) return state;
  return {
    ...state,
    decisions: state.decisions.map(d => (drop.has(d.id) ? { ...d, split: undefined } : d)),
    // The repeat stays visible as a promise, but carries no amount, so it is not owed twice.
    commitments: state.commitments.map(c => (repeated.has(c.id) ? { ...c, amount: undefined } : c)),
  };
}

/**
 * Money lent: Aniket gives Swapnil 15,000, and afterwards Swapnil says he will give it back (all of it, or "the
 * remaining 5,000"). That payment is a loan, owed back, not Aniket paying off what he owes Swapnil. Paying your own
 * share of a bill is never a loan, and a repayment comes after the loan, so it is not one either.
 */
export function isLoan(c: Commitment, all: Commitment[], messages: Message[] = [], evidenceMap: Record<string, Evidence> = {}, decisions: Decision[] = []): boolean {
  if (!c.payee || !c.amount || c.status !== 'completed') return false;
  const order = new Map(messages.map((m, i) => [m.id, i]));
  const when = (x: Commitment) => Math.min(...x.evidenceIds.map(id => order.get(evidenceMap[id]?.messageId ?? '') ?? Infinity));
  const mine = when(c);
  if (!Number.isFinite(mine)) return false;
  const paysShare = decisions.some(d => d.topicId === c.topicId && !!d.split?.collector && sameName(d.split.collector, c.payee) === true && (d.split.among === 'everyone' || d.split.among.some(n => sameName(n, c.ownerName) === true)));
  if (paysShare) return false;
  return all.some(r => {
    if (r.id === c.id || r.status === 'cancelled' || !r.amount || !r.payee) return false;
    if (sameName(r.ownerName, c.payee) !== true || sameName(r.payee, c.ownerName) !== true) return false;
    const theirs = when(r);
    if (!Number.isFinite(theirs) || theirs < mine) return false;
    // The same amount back, anywhere; or a promise to give back part of it, in the same thread.
    // The same amount back, a promise to give back part of it, or a part repayment, all in the same thread.
    return r.topicId === c.topicId && (near(r.amount, c.amount!) || r.amount <= c.amount! + 0.5);
  });
}

/** The commitment with its amount, filled in from its quotes when the model left it out. */
export function withAmount(c: Commitment, evidenceMap: Record<string, Evidence> = {}): Commitment {
  if (c.status !== 'completed' || !c.payee) return c;
  // The description's own figure wins ("Pay 1000 electricity share": 1,000, even if its quote says 19,000 in all).
  const said = amountInText(c.description);
  if (said && c.amount && Math.abs(said - c.amount) >= 1 && c.amount > said) return { ...c, amount: said };
  if (c.amount) return c;
  const amount = said ?? amountFromQuotes(c.evidenceIds.map(id => evidenceMap[id]?.quote ?? '').filter(Boolean));
  return amount ? { ...c, amount } : c;
}

/** See computeGroupLedger: a later split in the same thread, same collector, naming a new amount for some people. */
function reviseSplits(decisions: Decision[], ws: Workspace, context: LedgerContext): Decision[] {
  const order = new Map((context.messages ?? []).map((m, i) => [m.id, i]));
  const when = (d: Decision) => Math.max(...d.supportingEvidenceIds.map(id => order.get(context.evidenceMap?.[id]?.messageId ?? '') ?? -1));
  const peopleOf = (d: Decision) => (d.split!.among === 'everyone' ? ws.participants.map(p => p.name) : d.split!.among);
  const out = new Map(decisions.map(d => [d.id, d]));
  const splits = decisions.filter(d => d.split?.collector && d.topicId && d.status !== 'rejected').sort((a, b) => when(a) - when(b));
  for (const later of splits) {
    if (later.split!.among === 'everyone' || !later.split!.perPerson) continue;
    for (const earlier of splits) {
      const e = out.get(earlier.id)!;
      if (!e.split || earlier.id === later.id || earlier.topicId !== later.topicId || when(earlier) >= when(later)) continue;
      if (sameName(e.split.collector, later.split!.collector) !== true) continue;
      const before = peopleOf(e);
      const oldEach = e.split.perPerson || (e.split.total ? e.split.total / before.length : 0);
      if (!oldEach) continue;
      const named = later.split!.among as string[];
      if (!named.every(n => before.some(b => sameName(b, n) === true))) continue;
      const total = e.split.total ?? oldEach * before.length;
      const rest = before.filter(b => !named.some(n => sameName(n, b) === true) && sameName(b, e.split!.collector) !== true);
      const left = total - later.split!.perPerson * named.length - (named.some(n => sameName(n, e.split!.collector) === true) ? 0 : later.split!.perPerson);
      // Only when the numbers fit: what is left is positive and less than the old share (a real revision, not noise).
      const each = rest.length ? Math.round((left / rest.length) * 100) / 100 : 0;
      if (!rest.length || each <= 0 || each >= oldEach) {
        if (!rest.length) out.set(e.id, { ...e, split: undefined });
        continue;
      }
      out.set(e.id, { ...e, split: { ...e.split, perPerson: each, total: undefined, among: rest } });
    }
  }
  return decisions.map(d => out.get(d.id)!);
}

/** Two topics this close together, about the same thing, are one thing filed twice. */
const SAME_THING_MS = 21 * 86400000;

export interface LedgerContext {
  /** The group's topics: "split equally" in a topic means the people taking part in that topic, not every member. */
  topics?: Topic[];
  /** Payments to check debts against. Defaults to the same commitments; a topic passes the whole group's, since a payment may be filed elsewhere. */
  payments?: Commitment[];
  /** Used when nobody in the chat wrote a currency (live rooms in India: ₹). */
  defaultCurrency?: string;
  conflicts?: Conflict[];
  /** The chat, so a plain objection to a suggested cost can be noticed even when no conflict was recorded. */
  messages?: Message[];
  evidenceMap?: Record<string, Evidence>;
  /** Every commitment in the group, so a loan can be told from a payment even when its promise is in another topic. */
  allCommitments?: Commitment[];
}

/**
 * A bill the model recognised but recorded without its split ("September rent: 36k total, 9k each", "pls send to me")
 * gets one, in code: only for a confirmed decision that is clearly a bill, states what each pays or the total, and says
 * who collects (the person who wrote "to me / mujhe / naaku", or a "paid by X" decision in the same thread). Budgets,
 * rates and estimates never become debts.
 */
export function inferSplits(decisions: Decision[], ws: Workspace, context: LedgerContext): Decision[] {
  const order = new Map((context.messages ?? []).map((m, i) => [m.id, i]));
  const member = (n?: string) => (n ? ws.participants.find(p => sameName(p.name, n) === true)?.name : undefined);
  const hasSplit = new Set(decisions.filter(d => d.split?.collector).map(d => `${d.topicId}|${billName(d.topic).toLowerCase()}`));
  const num = (t: string, after: RegExp) => {
    const m = t.replace(/(\d),(\d)/g, '$1$2').match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s?(k)?\\s*${after.source}`, 'i'));
    return m ? Number(m[1]) * (m[2] ? 1000 : 1) : undefined;
  };
  // A thread with an agreed payer ("October lunch payer = Rahul") but no bill: if that payer wrote "N each" in the
  // thread, that is the bill, collected by them and shared by the people in the thread.
  const extra: Decision[] = [];
  for (const payer of decisions.filter(x => x.topicId && x.status === 'confirmed' && /\b(payer|paid by|host)\b/i.test(x.topic) && member(String(x.currentValue)))) {
    if (decisions.some(x => x.topicId === payer.topicId && x.split?.collector)) continue;
    const topic = context.topics?.find(t => t.id === payer.topicId);
    const who = member(String(payer.currentValue))!;
    if (!topic || topic.people.length !== ws.participants.length) continue;
    const ids = new Set(topic.messageIds);
    const said = (context.messages ?? []).find(m => ids.has(m.id) && sameName(m.speakerName, who) === true && /\d+\s?k?\s*each\b/i.test(m.content));
    const each = said ? num(said.content, /each/) : undefined;
    if (!said || !each) continue;
    const id = `inferred_${payer.id}`;
    extra.push({ ...payer, id, topic: `${topic.title.split(',')[0]} bill`, currentValue: `${each} each`, supportingEvidenceIds: [], split: { perPerson: each, among: 'everyone', collector: who } });
  }
  return [...decisions, ...extra].map(d => {
    if (d.split || d.status !== 'confirmed' || !d.topicId || hasSplit.has(`${d.topicId}|${billName(d.topic).toLowerCase()}`)) return d;
    const quotes = d.supportingEvidenceIds.map(id => context.evidenceMap?.[id]).filter(Boolean) as Evidence[];
    const text = `${d.topic} ${d.currentValue} ${quotes.map(q => q.quote).join(' ')}`;
    if (!BILLISH.test(text) || NOT_A_BILL.test(`${d.topic} ${d.currentValue}`)) return d;
    const each = num(`${d.currentValue} ${quotes.map(q => q.quote).join(' ')}`, /(each|per person|per head|okkokkariki|har ek)/);
    const total = num(`${d.currentValue} ${quotes.map(q => q.quote).join(' ')}`, /total/);
    if (!each && !total) return d;
    const asker = quotes.find(q => TO_ME.test(q.quote));
    const speaker = asker ? context.messages?.[order.get(asker.messageId) ?? -1]?.speakerName : undefined;
    const payerDecision = decisions.find(x => x.topicId === d.topicId && x.status === 'confirmed' && /\b(payer|paid by|collect(or|s|ing)?)\b/i.test(x.topic) && member(String(x.currentValue)));
    const collector = member(speaker) ?? member(payerDecision ? String(payerDecision.currentValue) : undefined);
    if (!collector) return d;
    // Only when who pays is clear: the stated count (total ÷ each) is exactly the people in the thread, or the whole
    // group is in it. Otherwise better to leave the bill than charge the wrong people.
    const people = context.topics?.find(t => t.id === d.topicId)?.people ?? [];
    const count = total && each ? Math.round(total / each) : undefined;
    const clear = count ? count === people.length : people.length === ws.participants.length;
    if (!clear) return d;
    return { ...d, split: { perPerson: each ?? 0, ...(total ? { total } : {}), among: 'everyone' as const, collector } };
  });
}

/** Words that make a decision a bill people share. */
const BILLISH = /\b(rent|bill|current|electric\w*|light|wifi|maid|gift|ticket\w*|fare|share|dinner|lunch|fee|contribution|charges?|repair|hamper|tickets?|cylinder|groceries)\b/i;
/** …and words that make it something else: a budget, a rate, an estimate, a combined total. */
const NOT_A_BILL = /\b(budget|estimate|approx|roughly|max|limit|per night|per day|a day|rate|stake|quote|total per person|\+)\b/i;
/** Asking to be paid: the person who writes this collects. */
const TO_ME = /\b(to me|me only|send me|pay me|mujhe|mujhko|mere ko|naaku|naku|nakku|naa ki|me ko)\b/i;

export function computeGroupLedger(ws: Workspace, allDecisions: Decision[], commitments: Commitment[], context: LedgerContext = {}): GroupLedger {
  allDecisions = inferSplits(allDecisions, ws, context);
  // "Everyone" means everyone in that thread: rent is split among the flatmates who talk about rent, not the friends
  // who are also in the group.
  const byTopic = new Map((context.topics ?? []).map(t => [t.id, t]));
  // When the chat says how many people share it (total ÷ each, e.g. 36,000 ÷ 9,000 = 4), only that many pay: the
  // people most involved in the thread. A friend who chatted in the rent thread is not a flatmate.
  const activity = (topicId: string) => {
    const ids = new Set(byTopic.get(topicId)?.messageIds ?? []);
    const counts = new Map<string, number>();
    (context.messages ?? []).forEach(m => ids.has(m.id) && counts.set(m.speakerName, (counts.get(m.speakerName) ?? 0) + 1));
    return counts;
  };
  const quotesOf = (d: Decision) => d.supportingEvidenceIds.map(id => context.evidenceMap?.[id]?.quote ?? '').join(' \n ');
  const headcount = (d: Decision) => {
    const split = d.split!;
    const whole = (n: number, each: number) => each > 0 && n > each && Math.abs(n / each - Math.round(n / each)) < 0.01;
    const total = split.total ?? numbersIn(`${d.currentValue} ${d.topic}`).find(n => whole(n, split.perPerson));
    if (split.perPerson > 0 && total) return Math.round(total / split.perPerson);
    // Only the total was recorded, but the chat says what each pays ("54000 … 18000 each"): that gives the headcount.
    if (split.total) {
      const each = numbersIn(quotesOf(d).replace(/(\d+(?:\.\d+)?)\s?k\b/gi, (_, x) => String(Number(x) * 1000))).find(n => /each|per head|per person|har ek|ఒక్కొక్కరు/i.test(quotesOf(d)) && whole(split.total!, n));
      if (each) return Math.round(split.total / each);
    }
    return undefined;
  };
  // "Each pays their own" / "apna apna pay kar do": nobody collects, so the cost is nobody's debt.
  const resolved = allDecisions.map(d => (d.split && EACH_OWN.test(quotesOf(d)) ? { ...d, split: undefined } : d)).map(d => {
    const people = d.topicId ? byTopic.get(d.topicId)?.people : undefined;
    if (d.split?.among !== 'everyone' || !people || (people.length < 2 && !headcount(d))) return d;
    const n = headcount(d);
    const counts = activity(d.topicId!);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    // In a long thread, someone who wrote only a line or two is passing through, not part of the bill.
    let among = total >= 30 ? people.filter(p => (counts.get(p) ?? 0) >= Math.max(2, total * 0.05)) : [...people];
    if (among.length < 2) among = [...people];
    if (n && n >= 2 && n !== people.length) {
      // The people in the thread first, most active first; if the bill is shared by more, members who stayed quiet
      // in the thread are part of it too (a flatmate who never replied still pays rent).
      const quiet = ws.participants.map(p => p.name).filter(p => !people.some(q => sameName(q, p) === true));
      among = [...[...people].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0)), ...quiet].slice(0, n);
      // The person collecting is always one of them.
      if (d.split.collector && !among.some(p => sameName(p, d.split!.collector) === true)) among = [...among.slice(0, n - 1), d.split.collector];
    }
    return { ...d, split: { ...d.split, among } };
  });
  // A revised split replaces the earlier one for the people it names; whoever it leaves out pays what is left of the
  // earlier total ("7500, 1500 each" then "Ritu 1000, the other four 1625": 7500 − 4 × 1625 = 1000 for Ritu).
  const decisions = reviseSplits(resolved, ws, context);
  const openConflicts = (context.conflicts ?? []).filter(c => c.status === 'open');
  // Only a disagreement about the money (the amount, or who pays) holds a bill: an argument about the due date does
  // not, and a bill people already paid towards is not on hold.
  const aboutMoney = (c: Conflict) => /\d{3,}|₹|rs\.?|pay|paid|share|split|owe|amount|cost|price|refus|nahi denge|won'?t/i.test(`${c.topic} ${c.description}`) && !/\b(due date|deadline|before the|by the \d|date|time|day)\b/i.test(c.topic);
  const paidTowards = (d: Decision) => !!d.split?.collector && commitments.some(c => c.status === 'completed' && c.topicId === d.topicId && !!c.payee && sameName(c.payee, d.split!.collector) === true);
  const conflictFor = (d: Decision) =>
    paidTowards(d) && d.status !== 'conflicted' ? undefined :
    openConflicts.filter(aboutMoney).find(
      c =>
        c.relatedDecisionIds.includes(d.id) ||
        topicsMatch(c.topic, d.topic) ||
        // The clash names this cost's amount ("6,500 on one activity"), not just a shared word like "train".
        [d.split?.perPerson, d.split?.total].some(n => !!n && `${c.topic} ${c.description}`.replace(/(\d),(\d)/g, '$1$2').includes(String(n)))
    );
  const messageOf = (c?: Conflict) => (c ? context.evidenceMap?.[c.evidenceIds[0]]?.messageId : undefined);
  /**
   * A cost whose plan was called off later in the same thread ("plan cancel ho gaya", "dinner is off") is nobody's
   * debt: the message must say it is cancelled and be about the plan or this cost, not some other thing.
   */
  const calledOff = (d: Decision): { detail: string; messageId: string } | undefined => {
    const messages = context.messages;
    const topic = d.topicId ? byTopic.get(d.topicId) : undefined;
    if (!messages || !topic) return undefined;
    const first = d.supportingEvidenceIds.map(id => context.evidenceMap?.[id]?.messageId).find(Boolean);
    const start = first ? messages.findIndex(m => m.id === first) : -1;
    if (start < 0) return undefined;
    const inTopic = new Set(topic.messageIds);
    const keys = [...wordsOf(billName(d.topic)), ...wordsOf(topic.title), 'plan', 'trip', 'booking', 'dinner', 'party'];
    // "Delhi wala plan cancel, Chandigarh wala final" swaps one option for another: the plan goes on.
    const hit = messages.slice(start + 1).find(m => inTopic.has(m.id) && CANCELLED.test(m.content) && !GOES_ON.test(m.content) && keys.some(k => m.content.toLowerCase().includes(k)));
    // Someone already paid towards it: it was not called off.
    const paidFor = d.split?.collector && commitments.some(c => c.status === 'completed' && c.topicId === d.topicId && !!c.payee && sameName(c.payee, d.split!.collector) === true);
    return hit && !paidFor ? { detail: `${hit.speakerName}: "${hit.content.length > 90 ? `${hit.content.slice(0, 90)}…` : hit.content}"`, messageId: hit.id } : undefined;
  };
  const objectionTo = (d: Decision): { detail: string; messageId: string } | undefined => {
    const messages = context.messages;
    if (!messages || d.status === 'confirmed') return undefined;
    const first = d.supportingEvidenceIds.map(id => context.evidenceMap?.[id]?.messageId).find(Boolean);
    const start = first ? messages.findIndex(m => m.id === first) : -1;
    if (start < 0) return undefined;
    const proposer = messages[start].speakerName;
    const keys = [...wordsOf(billName(d.topic))];
    const amounts = [d.split?.perPerson, d.split?.total].filter((n): n is number => !!n).map(String);
    return messages
      .slice(start + 1)
      .filter(m => sameName(m.speakerName, proposer) !== true && OBJECTION.test(m.content))
      .map(m => ({ m, text: m.content.toLowerCase().replace(/(\d),(\d)/g, '$1$2') }))
      .filter(({ text }) => keys.some(k => text.includes(k)) || amounts.some(a => text.includes(a)))
      .map(({ m }) => ({ detail: `${m.speakerName} objected: "${m.content.length > 90 ? `${m.content.slice(0, 90)}…` : m.content}"`, messageId: m.id }))[0];
  };
  const matched = new Set<string>();
  const disputed = new Set<string>();
  const debts: Debt[] = [];
  const bills: Bill[] = [];
  const waiting: WaitingSplit[] = [];

  const withSplit = decisions.filter(d => !!d.split);
  const listed = new Set<string>();
  /** Bills where only the objectors' shares wait: the others still owe their share. */
  const partial = new Map<string, { among: string[]; each: number }>();
  for (const d of withSplit) {
    if (listed.has(billName(d.topic).toLowerCase())) continue;
    const split = d.split!;
    const people = split.among === 'everyone' ? ws.participants.map(p => p.name) : split.among;
    const each = perShare(split, people.length);
    const conflict = conflictFor(d);
    const detail = {
      eachAmount: each || undefined,
      currency: split.currency,
      appliesTo: people.filter(n => !split.collector || sameName(n, split.collector) !== true),
    };
    const objection = conflict ? undefined : objectionTo(d);
    if (d.status === 'conflicted' || conflict || objection) {
      // Who objected: only their share waits; everyone else who agreed still owes. Every disagreement about this cost
      // counts; the objector is the member it names (else who wrote it), and only their latest objection decides
      // whether a later "chalo theek hai, de denge" means they gave in.
      const byId = new Map((context.messages ?? []).map((m, i) => [m.id, i]));
      const speakerAt = (id?: string) => context.messages?.[byId.get(id ?? '') ?? -1]?.speakerName;
      const about = conflict ? openConflicts.filter(c => c === conflict || c.relatedDecisionIds.includes(d.id) || topicsMatch(c.topic, d.topic) || (!!d.topicId && c.topicId === d.topicId && MONEYISH.test(`${c.topic} ${c.description}`))) : [];
      const last = new Map<string, number>();
      const note = (who: string | undefined, at: number) => {
        if (!who || (split.collector && sameName(who, split.collector) === true)) return;
        const key = ws.participants.find(p => sameName(p.name, who) === true)?.name ?? who;
        last.set(key, Math.max(last.get(key) ?? -1, at));
      };
      for (const c of about) {
        const ids = c.evidenceIds.map(id => context.evidenceMap?.[id]?.messageId).filter((x): x is string => !!x);
        const named = ws.participants.find(p => new RegExp(`^\\W*${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(c.description))?.name;
        const at = Math.max(-1, ...ids.map(id => byId.get(id) ?? -1));
        note(named ?? speakerAt(ids[0]), at);
      }
      if (objection) note(speakerAt(objection.messageId), byId.get(objection.messageId) ?? -1);
      const objectors = [...last.keys()].filter(o => {
        const after = (context.messages ?? []).slice(last.get(o)! + 1).filter(m => sameName(m.speakerName, o) === true);
        // Gave in only if, after their last objection, they concede and never object again.
        return !(after.some(m => CONCEDE.test(m.content) && !OBJECTION.test(m.content)) && !after.some(m => OBJECTION.test(m.content) || /nahi denge|nahi dunga|won'?t pay|not paying|ek rupaya/i.test(m.content)));
      });
      const gaveIn = last.size > 0 && objectors.length === 0;
      if (gaveIn) {
        about.forEach(c => matched.add(c.id));
        continue;
      }
      const rest = people.filter(n => !objectors.some(o => sameName(o, n) === true));
      // Only for a cost the group had agreed (an objection to a mere suggestion holds the whole thing).
      const agreedBefore = d.status === 'confirmed' || d.status === 'conflicted';
      if (agreedBefore && objectors.length && rest.length > (split.collector ? 1 : 0) && each) {
        partial.set(d.id, { among: rest, each });
        about.forEach(c => matched.add(c.id));
        waiting.push({ topic: billName(d.topic), why: 'the group disagrees about it', detail: conflict?.description ?? objection?.detail, conflictId: conflict?.id, messageId: messageOf(conflict) ?? objection?.messageId, ...detail, appliesTo: objectors });
        continue;
      }
      listed.add(billName(d.topic).toLowerCase());
      disputed.add(d.id);
      if (conflict) matched.add(conflict.id);
      waiting.push({ topic: billName(d.topic), why: 'the group disagrees about it', detail: conflict?.description ?? objection?.detail, conflictId: conflict?.id, messageId: messageOf(conflict) ?? objection?.messageId, ...detail });
    } else if (d.status === 'unresolved') {
      listed.add(billName(d.topic).toLowerCase());
      disputed.add(d.id);
      waiting.push({ topic: billName(d.topic), why: 'it was put off for later', ...detail });
    } else {
      const off = calledOff(d);
      if (off) {
        listed.add(billName(d.topic).toLowerCase());
        disputed.add(d.id);
        waiting.push({ topic: billName(d.topic), why: 'the plan was called off', detail: off.detail, messageId: off.messageId, ...detail });
      }
    }
  }
  // Money disagreements that were not tied to a split are still shown beside what you owe.
  for (const c of openConflicts) {
    if (matched.has(c.id) || !MONEYISH.test(`${c.topic} ${c.description}`)) continue;
    waiting.push({ topic: c.topic, why: 'the group disagrees about it', detail: c.description, conflictId: c.id, messageId: messageOf(c) });
  }

  const withDefault = (d: Decision): Decision => (d.split && !d.split.currency && context.defaultCurrency ? { ...d, split: { ...d.split, currency: context.defaultCurrency } } : d);
  // Only people in the group share a bill: a name the chat mentions in passing (a cricketer, a cousin) is not a payer.
  const isMember = (name: string) => ws.participants.some(p => sameName(p.name, name) === true);
  // With only the objectors' shares waiting, everyone else's shares stand as agreed.
  const narrowed = withSplit.map(x => (partial.has(x.id) ? { ...x, status: 'confirmed' as const, split: { ...x.split!, among: partial.get(x.id)!.among, perPerson: partial.get(x.id)!.each, total: undefined } } : x));
  for (const d of groupSplits(ws, narrowed.filter(x => countsAsOwed(x) && !disputed.has(x.id)).map(withDefault))) {
    const split = d.split!;
    const people = split.among === 'everyone' ? ws.participants.map(p => p.name) : split.among.filter(isMember);
    const amount = perShare(split, people.length);
    if (!amount) continue;
    bills.push({ decisionId: d.id, topic: billName(d.topic), each: amount, total: split.total ?? Math.round(amount * people.length * 100) / 100, currency: split.currency ?? '', people, collector: split.collector });
    // Collected by someone outside the group (the society account, the owner, a shop): each person pays it directly,
    // so it is nobody's debt inside the group.
    if (split.collector && !isMember(split.collector)) continue;
    for (const name of people) {
      if (split.collector && sameName(name, split.collector) === true) continue;
      const base = { from: name, to: split.collector, amount, currency: split.currency ?? '' };
      const noOne = !split.collector;
      // A paid share stays as a debt here; the payment below cancels it, so a payment covering several bills
      // (rent and electricity in one transfer) is counted the same way.
      const found = stateOf(base, d, context.payments ?? commitments);
      const state = found === 'paid' ? 'unpaid' : found;
      debts.push({ ...base, reason: billName(d.topic), state, agreed: d.status === 'confirmed', decisionId: d.id, ...(noOne && split.outside ? { outside: true } : {}), ...(noOne && !split.outside ? { needsRecipient: true } : {}) });
    }
  }

  const inGroupName = (name: string) => ws.participants.some(p => sameName(p.name, name) === true);
  // A loan is owed back by the person who got it; repayments below reduce it.
  const loanTopic = new Map<number, string | undefined>();
  for (const c of commitments) {
    if (!isLoan(c, context.allCommitments ?? commitments, context.messages, context.evidenceMap, allDecisions) || !inGroupName(c.payee!)) continue;
    loanTopic.set(debts.length, c.topicId);
    debts.push({ from: c.payee!, to: c.ownerName, amount: c.amount!, currency: c.currency || context.defaultCurrency || '', reason: `Loan from ${c.ownerName}: ${c.description}`, state: 'unpaid', agreed: true });
  }
  // Promises to pay a named person that no split already covers.
  const decisionTopic = new Map(allDecisions.map(d => [d.id, d.topicId]));
  const inGroup = (name: string) => ws.participants.some(p => sameName(p.name, name) === true);
  // A stated running total ("Total: Aniket owes Swapnil 800") replaces the small items before it, between the same two
  // people in the same thread; the latest total wins.
  // "Total: …" and "the remaining 20,000" both say what is owed now, replacing the earlier promises.
  const TOTAL = /^\s*total\b|\b(remaining|remainder|rest of|balance|baki|baaki|bacha|migilina|migata)\b/i;
  const order__ = new Map((context.messages ?? []).map((m, i) => [m.id, i]));
  const at__ = (c: Commitment) => Math.max(...c.evidenceIds.map(id => order__.get(context.evidenceMap?.[id]?.messageId ?? '') ?? -1));
  const totals = commitments.filter(c => TOTAL.test(c.description) && c.payee && c.amount && (c.status === 'accepted' || c.status === 'in_progress'));
  const latestTotal = (c: Commitment) =>
    totals.filter(t => t.topicId === c.topicId && sameName(t.ownerName, c.ownerName) === true && sameName(t.payee, c.payee) === true).sort((a, b) => at__(b) - at__(a))[0];
  const promiseDebts = new Set<number>();
  for (let c of commitments) {
    if ((c.status !== 'accepted' && c.status !== 'in_progress') || !c.payee || !c.amount || c.shareOfDecisionId) continue;
    // Paying someone outside the group (the villa owner, a shop) is not money anyone here can collect.
    if (!inGroup(c.payee)) continue;
    const total = latestTotal(c);
    if (total && total.id !== c.id) continue;
    // A running total is what its latest quote says ("600 ho gaya" … "ab 1000 ho gaya": 1,000).
    if (total) {
      const latest = [...c.evidenceIds].sort((a, b) => (order__.get(context.evidenceMap?.[b]?.messageId ?? '') ?? -1) - (order__.get(context.evidenceMap?.[a]?.messageId ?? '') ?? -1))
        .map(id => amountFromQuotes([context.evidenceMap?.[id]?.quote ?? '']))
        .find(n => n !== undefined);
      if (latest) c = { ...c, amount: latest };
    }
    // Another promise between the same two people is not a cover: two lost bets are 200 + 200.
    const covered = debts.some(
      (d, i) =>
        !promiseDebts.has(i) &&
        sameName(d.from, c.ownerName) === true &&
        !!d.to &&
        sameName(d.to, c.payee!) === true &&
        // The same amount, or part of a share in the same topic ("the remaining 6,000 after my bonus").
        (near(d.amount, c.amount!) ||
          (!!c.topicId && (decisionTopic.get(d.decisionId ?? '') ?? loanTopic.get(i)) === c.topicId && c.amount! <= d.amount + 0.5))
    );
    if (covered) continue;
    promiseDebts.add(debts.length);
    debts.push({ from: c.ownerName, to: c.payee!, amount: c.amount!, currency: c.currency || context.defaultCurrency || '', reason: c.description, state: 'unpaid', agreed: true });
  }

  // Confirmed payments, Splitwise style: what X paid Y reduces what X owes Y, whichever bills it covers. Only
  // payments to group members count, and never more than the shares X owes Y (so a payment never flips a debt).
  const member = (name: string) => ws.participants.some(p => sameName(p.name, name) === true);
  // Who pays whom, in which currency: names as the group knows them ("Priya" and "Priya Sharma" are one person),
  // and a dollar payment never clears a rupee debt.
  const canon = (n: string) => ws.participants.find(p => sameName(p.name, n) === true)?.name ?? n;
  const payKey = (from: string, to: string, currency: string) => `${canon(from).toLowerCase()}>${canon(to).toLowerCase()}|${ckey(currency || context.defaultCurrency || '')}`;
  const left = new Map<string, number>();
  debts.filter(d => d.to).forEach(d => {
    const k = payKey(d.from, d.to!, d.currency);
    left.set(k, (left.get(k) ?? 0) + d.amount);
  });
  const paidItems: Debt[] = [];
  const allCommitments = context.allCommitments ?? commitments;
  // Money lent: Aniket gives Swapnil 15,000 and Swapnil promises it back. That is a loan (owed through the promise),
  // not Aniket paying off what he owes Swapnil.
  const order_ = new Map((context.messages ?? []).map((m, i) => [m.id, i]));
  const first = (c: Commitment) => Math.min(...c.evidenceIds.map(id => order_.get(context.evidenceMap?.[id]?.messageId ?? '') ?? Infinity));
  // A payment with no figure ("Sent Fatima. Done.") made to the collector of a bill the payer owes a share of in the
  // same thread pays that share.
  const shareInTopic = (c: Commitment) =>
    debts.find(d => !!d.decisionId && !!d.to && decisionTopic.get(d.decisionId) === c.topicId && sameName(d.from, c.ownerName) === true && sameName(d.to, c.payee!) === true)?.amount;
  const paymentList = capByMessage(
    (context.payments ?? commitments)
      .map(c => withAmount(c, context.evidenceMap))
      .map(c => (!c.amount && c.status === 'completed' && c.payee && shareInTopic(c) ? { ...c, amount: shareInTopic(c) } : c))
      .filter(c => c.status === 'completed')
      .sort((a, b) => first(a) - first(b)),
    context.evidenceMap ?? {}
  );
  for (const c of paymentList) {
    if (c.status !== 'completed' || !c.payee || !c.amount || c.verification?.state === 'disputed' || !member(c.payee) || isLoan(c, allCommitments, context.messages, context.evidenceMap, allDecisions)) continue;
    const to = ws.participants.find(p => sameName(p.name, c.payee!) === true)!.name;
    const from = ws.participants.find(p => sameName(p.name, c.ownerName) === true)?.name ?? c.ownerName;
    // A payment with no currency written down is in the currency of what this person owes that one.
    const owedIn = debts.find(d => d.to && canon(d.from) === canon(from) && canon(d.to) === canon(to))?.currency;
    const k = payKey(from, to, c.currency || owedIn || context.defaultCurrency || '');
    const use = Math.min(c.amount, left.get(k) ?? 0);
    if (use <= 0.005) continue;
    left.set(k, (left.get(k) ?? 0) - use);
    paidItems.push({ from, to, amount: -use, currency: c.currency || debts.find(d => d.from === from && d.to === to)?.currency || context.defaultCurrency || '', reason: c.description, state: 'unpaid', agreed: true });
  }

  // Net what each pair owes each other, per currency.
  const pairs = new Map<string, { a: string; b: string; currency: string; items: (PairItem & { from: string })[]; ab: number }>();
  const unassigned: Debt[] = [];
  for (const raw of [...debts, ...paidItems]) {
    if (!raw.to) {
      unassigned.push(raw);
      continue;
    }
    // Everyone under the name the group knows them by: "Priya" in a bill and "Priya Sharma" paying are one person.
    const d = { ...raw, from: canon(raw.from), to: canon(raw.to) };
    const aFirst = d.from.trim().toLowerCase() < d.to.trim().toLowerCase();
    const [a, b] = aFirst ? [d.from, d.to] : [d.to, d.from];
    const key = `${a.trim().toLowerCase()}|${b.trim().toLowerCase()}|${ckey(d.currency)}`;
    const e = pairs.get(key) ?? { a, b, currency: d.currency, items: [], ab: 0 };
    e.ab += aFirst ? d.amount : -d.amount;
    e.items.push({ from: d.from, decisionId: d.decisionId, reason: d.reason, amount: Math.abs(d.amount), direction: d.amount < 0 ? 'paid' : 'owes', state: d.state, agreed: d.agreed });
    pairs.set(key, e);
  }

  const out: Pair[] = [];
  for (const e of pairs.values()) {
    if (Math.abs(e.ab) < 0.005) continue;
    const from = e.ab > 0 ? e.a : e.b;
    const to = e.ab > 0 ? e.b : e.a;
    const items: PairItem[] = e.items.map(({ from: who, ...it }) => ({ ...it, direction: it.direction === 'paid' ? 'paid' : sameName(who, from) === true ? 'owes' : 'offsets' }));
    out.push({ from, to, amount: Math.round(Math.abs(e.ab) * 100) / 100, currency: e.currency, items, pending: items.some(i => i.direction === 'owes' && i.state === 'claimed') });
  }
  out.sort((x, y) => y.amount - x.amount);

  const net = new Map<string, { name: string; currency: string; amount: number }>();
  const bump = (name: string, currency: string, amount: number) => {
    const key = `${name.trim().toLowerCase()}|${ckey(currency)}`;
    const cur = net.get(key) ?? { name, currency, amount: 0 };
    cur.amount += amount;
    net.set(key, cur);
  };
  out.forEach(p => {
    bump(p.from, p.currency, -p.amount);
    bump(p.to, p.currency, p.amount);
  });
  // Shares with no recipient yet are not in anyone's balance: settling up cannot send them to a person until someone
  // says who collects them (they stay visible as a question).

  return { workspaceId: ws.id, bills, title: ws.title, pairs: out, unassigned, waiting, net: Array.from(net.values()).map(n => ({ ...n, amount: Math.round(n.amount * 100) / 100 })) };
}

/* ---------- one person's view across groups: never netted between groups ---------- */

export interface MyGroupMoney {
  workspaceId: string;
  title: string;
  iOwe: Pair[];
  owedToMe: Pair[];
  unassigned: Debt[];
  waiting: WaitingSplit[];
}

export interface MySettlement {
  /** What you still owe, summed across groups (each group netted on its own). */
  oweTotals: { currency: string; amount: number }[];
  owedTotals: { currency: string; amount: number }[];
  oweText: string;
  owedText: string;
  lines: string[];
  groups: MyGroupMoney[];
}

const sumText = (rows: { currency: string; amount: number }[]) => (rows.length ? rows.map(t => formatMoney(t.amount, symbolOf(t.currency))).join(' and ') : 'nothing');

function addTo(map: Map<string, number>, currency: string, amount: number) {
  map.set(ckey(currency), (map.get(ckey(currency)) ?? 0) + amount);
}
const rowsOf = (map: Map<string, number>) => Array.from(map.entries()).map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));

const describe = (p: Pair) => {
  const owes = p.items.filter(i => i.direction === 'owes').map(i => `${i.reason} ${formatMoney(i.amount, p.currency)}`);
  const back = p.items.filter(i => i.direction === 'offsets').map(i => `${i.reason} ${formatMoney(i.amount, p.currency)}`);
  const paid = p.items.filter(i => i.direction === 'paid').map(i => formatMoney(i.amount, p.currency));
  return `${owes.join(' + ')}${back.length ? `, minus ${back.join(' and ')} owed back` : ''}${paid.length ? `, minus ${paid.join(' and ')} already paid` : ''}`;
};

export function computeMySettlement(ledgers: GroupLedger[], userName: string): MySettlement {
  const owe = new Map<string, number>();
  const owed = new Map<string, number>();
  const lines: string[] = [];
  const groups: MyGroupMoney[] = [];

  for (const l of ledgers) {
    const iOwe = l.pairs.filter(p => sameName(userName, p.from) === true);
    const owedToMe = l.pairs.filter(p => sameName(userName, p.to) === true);
    const unassigned = l.unassigned.filter(d => sameName(userName, d.from) === true);
    iOwe.forEach(p => {
      addTo(owe, p.currency, p.amount);
      lines.push(`In ${l.title} you owe ${p.to} ${formatMoney(p.amount, p.currency)} (${describe(p)})${p.pending ? '. You say you paid part of it; it is waiting for confirmation, so it still counts as owed' : ''}.`);
    });
    owedToMe.forEach(p => {
      addTo(owed, p.currency, p.amount);
      lines.push(`In ${l.title} ${p.from} owes you ${formatMoney(p.amount, p.currency)} (${describe(p)}).`);
    });
    unassigned.forEach(d => {
      addTo(owe, d.currency, d.amount);
      lines.push(
        d.outside
          ? `In ${l.title} your share of "${d.reason}" is ${formatMoney(d.amount, d.currency)}, paid outside the group.`
          : `In ${l.title} your share of "${d.reason}" is ${formatMoney(d.amount, d.currency)}. Nobody is named to receive it yet: choose who you should pay.`
      );
    });
    l.waiting.forEach(w => {
      const mine = w.eachAmount && w.appliesTo?.some(n => sameName(userName, n) === true) ? ` If it goes ahead you would owe ${formatMoney(w.eachAmount, w.currency ?? '')}.` : '';
      lines.push(`In ${l.title}, "${w.topic}" is not counted yet because ${w.why}${w.detail ? ` (${w.detail})` : ''}.${mine}`);
    });
    if (iOwe.length || owedToMe.length || unassigned.length || l.waiting.length) groups.push({ workspaceId: l.workspaceId, title: l.title, iOwe, owedToMe, unassigned, waiting: l.waiting });
  }

  const oweTotals = rowsOf(owe);
  const owedTotals = rowsOf(owed);
  return { oweTotals, owedTotals, oweText: sumText(oweTotals), owedText: sumText(owedTotals), lines, groups };
}
