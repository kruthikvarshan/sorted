import { Commitment, GroupIntelligenceState, Message, Topic, Workspace } from '../types/groupOs';
import { formatMoney } from './ledger';
import { computeGroupPlan, totalsText } from './plan';
import { computeGroupLedger, dedupeBills, GroupLedger, isLoan, keptPromisesOnce, withAmount } from './settle';
import { capByMessage } from './amounts';
import { normalizeCurrency, sameName } from './receiptVerifier';

/**
 * Everything the live panel shows, worked out in code from the group's results: one card per topic, and the whole
 * group's money with the fewest payments that settle it.
 */

export interface Transfer {
  from: string;
  to: string;
  amount: number;
  currency: string;
}

/** The fewest payments that bring everyone to zero (greedy: largest debtor pays largest creditor). Per currency. */
export function settleUp(net: GroupLedger['net']): Transfer[] {
  const out: Transfer[] = [];
  const currencies = [...new Set(net.map(n => n.currency))];
  for (const currency of currencies) {
    const owe = net.filter(n => n.currency === currency && n.amount < -0.005).map(n => ({ name: n.name, left: -n.amount })).sort((a, b) => b.left - a.left);
    const get = net.filter(n => n.currency === currency && n.amount > 0.005).map(n => ({ name: n.name, left: n.amount })).sort((a, b) => b.left - a.left);
    let i = 0, j = 0;
    while (i < owe.length && j < get.length) {
      const amount = Math.round(Math.min(owe[i].left, get[j].left) * 100) / 100;
      if (amount > 0) out.push({ from: owe[i].name, to: get[j].name, amount, currency });
      owe[i].left -= amount;
      get[j].left -= amount;
      if (owe[i].left < 0.01) i++;
      if (get[j].left < 0.01) j++;
    }
  }
  return out;
}

export interface TopicCard {
  id: string;
  title: string;
  kind: Topic['kind'] | 'general';
  status: 'open' | 'closed';
  lastAt: number;
  messageCount: number;
  summary?: string;
  decided: { topic: string; value: string; messageId?: string }[];
  open: { topic: string; value: string; why: string; messageId?: string }[];
  disagreements: { id: string; topic: string; description: string; messageId?: string }[];
  promises: { owner: string; description: string; status: string; due?: string }[];
  money: { from: string; to: string; amount: number; currency: string; reasons: string[]; pending: boolean }[];
  waiting: { topic: string; why: string; detail?: string; eachAmount?: number; currency?: string }[];
  spend?: string;
  settle: Transfer[];
  /** Where each person stands in this topic (positive = is owed). */
  net: GroupLedger['net'];
}

export interface Panel {
  topics: TopicCard[];
  /** Whole group, all open topics together. */
  owes: { from: string; to: string; amount: number; currency: string }[];
  settle: Transfer[];
  spend: string;
  updatedAt: number;
}

function slice(state: GroupIntelligenceState, topicId: string | undefined): GroupIntelligenceState {
  const mine = <T extends { topicId?: string }>(x: T) => x.topicId === topicId;
  return { ...state, decisions: state.decisions.filter(mine), commitments: state.commitments.filter(mine), conflicts: state.conflicts.filter(mine) };
}

/**
 * Payments are shared out across topics the way Splitwise does: what Swapnil paid Kruthik clears what Swapnil owes
 * Kruthik in the payment's own topic first, then his oldest debts to Kruthik in other topics (a payment is often talked
 * about in a different thread than the bill). Each topic then gets its part, so the topics still add up to the group.
 */
export function sharePayments(ws: Workspace, state: GroupIntelligenceState, messages: Message[], defaultCurrency?: string): Map<string, Commitment[]> {
  const key = (id?: string) => id ?? 'general';
  const topics = [...(state.topics ?? [])].sort((a, b) => a.firstAt - b.firstAt);
  const ids = [...topics.map(t => t.id), undefined];
  // What each person owes each other person in each topic, before any payment.
  const owed = new Map<string, Map<string, number>>();
  for (const id of ids) {
    const s = slice(state, id);
    const ledger = computeGroupLedger(ws, s.decisions, s.commitments, { conflicts: s.conflicts, evidenceMap: s.evidenceMap, messages, defaultCurrency, payments: [], topics: state.topics, allCommitments: state.commitments });
    const m = new Map<string, number>();
    for (const p of ledger.pairs)
      for (const it of p.items) {
        if (it.direction === 'paid') continue;
        const [from, to] = it.direction === 'owes' ? [p.from, p.to] : [p.to, p.from];
        const k = `${from.toLowerCase()}>${to.toLowerCase()}`;
        m.set(k, (m.get(k) ?? 0) + it.amount);
      }
    owed.set(key(id), m);
  }
  const order = new Map(messages.map((m, i) => [m.id, i]));
  const at = (c: Commitment) => Math.min(...c.evidenceIds.map(e => order.get(state.evidenceMap[e]?.messageId ?? '') ?? Infinity));
  const name = (n: string) => ws.participants.find(p => sameName(p.name, n) === true)?.name ?? n;
  const out = new Map<string, Commitment[]>(ids.map(id => [key(id), []]));
  const completed = state.commitments.map(c => withAmount(c, state.evidenceMap)).filter(c => c.status === 'completed' && c.payee && c.amount && !isLoan(c, state.commitments, messages, state.evidenceMap, state.decisions)).sort((a, b) => at(a) - at(b));
  const kept = keptPromisesOnce(completed, at);
  // A promise its payment kept is that payment: it is not counted again anywhere.
  const absorbed = new Set(completed.filter(c => !kept.includes(c)).map(c => c.id));
  const payments = capByMessage(kept, state.evidenceMap);
  const ids_ = new Set(payments.map(c => c.id));
  for (const c of state.commitments) if (!ids_.has(c.id) && !absorbed.has(c.id)) out.get(key(c.topicId))?.push(c);
  for (const c of payments) {
    const k = `${name(c.ownerName).toLowerCase()}>${name(c.payee!).toLowerCase()}`;
    let rest = c.amount!;
    // A payment in a thread where these two have a bill between them is for that bill: any excess is not moved to
    // other threads (it is far more often the same payment recorded twice). A payment in a thread with no such bill
    // ("54k dues to Kruthik") goes to their oldest debts elsewhere.
    // Its own thread has a bill this payment is for (even one on hold for a disagreement): it stays there.
    const billHere = state.decisions.some(d => d.topicId === c.topicId && !!d.split?.collector && sameName(d.split.collector, c.payee) === true);
    const own = (owed.get(key(c.topicId))?.has(k) ?? false) || billHere;
    const targets = own ? [key(c.topicId)] : [key(c.topicId), ...ids.map(key).filter(id => id !== key(c.topicId))];
    for (const t of targets) {
      const m = owed.get(t);
      const use = Math.min(rest, m?.get(k) ?? 0);
      if (use <= 0.005) continue;
      m!.set(k, m!.get(k)! - use);
      out.get(t)!.push({ ...c, id: t === key(c.topicId) ? c.id : `${c.id}@${t}`, amount: use });
      rest -= use;
      if (rest <= 0.005) break;
    }
    // Whatever is left (more than was owed) stays with its own topic, where it shows as is.
    if (rest > 0.005) out.get(key(c.topicId))?.push({ ...c, amount: rest });
  }
  return out;
}

function card(ws: Workspace, state: GroupIntelligenceState, messages: Message[], topic: Topic | undefined, defaultCurrency?: string, shared?: Map<string, Commitment[]>): TopicCard {
  const s = slice(state, topic?.id);
  const ev = (ids: string[]) => s.evidenceMap[ids[0]]?.messageId;
  const payments = shared?.get(topic?.id ?? 'general') ?? state.commitments.filter(c => c.topicId === topic?.id);
  const ledger = computeGroupLedger(ws, s.decisions, s.commitments, { conflicts: s.conflicts, evidenceMap: s.evidenceMap, messages, defaultCurrency, payments, topics: state.topics, allCommitments: state.commitments });
  const plan = computeGroupPlan(ws, s.decisions, s.commitments, s.evidenceMap, ledger);
  return {
    id: topic?.id ?? 'general',
    title: topic?.title ?? 'General',
    kind: topic?.kind ?? 'general',
    status: topic?.status ?? 'open',
    lastAt: topic?.lastAt ?? 0,
    messageCount: topic?.messageIds.length ?? 0,
    summary: topic?.summary,
    decided: s.decisions.filter(d => d.status === 'confirmed').map(d => ({ topic: d.topic, value: d.currentValue, messageId: ev(d.supportingEvidenceIds) })),
    open: s.decisions
      .filter(d => d.status === 'proposed' || d.status === 'unresolved' || d.status === 'conflicted')
      .map(d => ({ topic: d.topic, value: d.currentValue, why: d.status === 'conflicted' ? 'disagreement' : d.status === 'unresolved' ? 'put off' : 'suggested', messageId: ev(d.supportingEvidenceIds) })),
    disagreements: s.conflicts.filter(c => c.status === 'open').map(c => ({ id: c.id, topic: c.topic, description: c.description, messageId: ev(c.evidenceIds) })),
    promises: s.commitments.filter(c => c.status !== 'cancelled').map(c => ({ owner: c.ownerName, description: c.description, status: c.status, due: c.dueAt })),
    money: ledger.pairs.map(p => ({ from: p.from, to: p.to, amount: p.amount, currency: p.currency, pending: p.pending, reasons: p.items.map(i => `${i.direction === 'owes' ? '+' : '−'} ${i.direction === 'paid' ? 'paid: ' : ''}${i.reason} ${formatMoney(i.amount, p.currency)}`) })),
    waiting: ledger.waiting.map(w => ({ topic: w.topic, why: w.why, detail: w.detail, eachAmount: w.eachAmount, currency: w.currency })),
    spend: plan.spend.groupTotals.length ? totalsText(plan.spend.groupTotals) : undefined,
    settle: settleUp(ledger.net),
    net: ledger.net,
  };
}

/**
 * A payment recorded without a topic (for example from a screenshot, before its bill was known) is filed under exactly
 * one topic: the bill with the same payee and amount, or else the most recent bill that person collects. Filing it once
 * keeps the group total right (it is never counted in two topics).
 */
export function fileLoosePayments(state: GroupIntelligenceState): GroupIntelligenceState {
  const topics = new Map((state.topics ?? []).map(t => [t.id, t]));
  const splits = state.decisions.filter(d => d.topicId && d.split?.collector);
  let changed = false;
  const commitments = state.commitments.map(c => {
    if (c.topicId || c.status !== 'completed' || !c.payee || !c.amount) return c;
    const forPayee = splits.filter(d => sameName(d.split!.collector, c.payee) === true);
    const exact = forPayee.find(d => Math.abs((d.split!.perPerson || 0) - c.amount!) < 1);
    const recent = [...forPayee].sort((a, b) => (topics.get(b.topicId!)?.lastAt ?? 0) - (topics.get(a.topicId!)?.lastAt ?? 0))[0];
    const target = exact ?? recent;
    if (!target) return c;
    changed = true;
    return { ...c, topicId: target.topicId };
  });
  return changed ? { ...state, commitments } : state;
}

export function buildPanel(ws: Workspace, state: GroupIntelligenceState, messages: Message[], opts: { defaultCurrency?: string } = {}): Panel {
  state = dedupeBills(fileLoosePayments(state));
  const topics = state.topics ?? [];
  const shared = sharePayments(ws, state, messages, opts.defaultCurrency);
  const cards = topics.map(t => card(ws, state, messages, t, opts.defaultCurrency, shared));
  // Results from before topics existed (or that the model could not place) still show, under General.
  const general = card(ws, state, messages, undefined, opts.defaultCurrency, shared);
  if (general.decided.length || general.open.length || general.disagreements.length || general.money.length) cards.push(general);
  cards.sort((a, b) => (a.status === b.status ? b.lastAt - a.lastAt : a.status === 'open' ? -1 : 1));

  // The group's money is the sum of its topics, each settled with its own payments, so a payment for one month's rent
  // never quietly clears another month.
  const withGeneral = cards.includes(general) ? cards : [...cards, general];
  const net = new Map<string, { name: string; currency: string; amount: number }>();
  const pair = new Map<string, number>();
  // "₹", "Rs", "INR" and no symbol at all (in a room whose currency is ₹) are the same money.
  const SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };
  const cur = (c: string) => {
    const code = normalizeCurrency(c || opts.defaultCurrency || '');
    return code ? SYMBOL[code] ?? code : c || opts.defaultCurrency || '';
  };
  for (const c of withGeneral) {
    c.net.forEach(n => {
      const k = `${n.name.toLowerCase()}|${cur(n.currency)}`;
      net.set(k, { name: n.name, currency: cur(n.currency), amount: (net.get(k)?.amount ?? 0) + n.amount });
    });
    c.money.forEach(m => {
      const [a, b] = m.from.toLowerCase() < m.to.toLowerCase() ? [m.from, m.to] : [m.to, m.from];
      const k = `${a}|${b}|${cur(m.currency)}`;
      pair.set(k, (pair.get(k) ?? 0) + (a === m.from ? m.amount : -m.amount));
    });
  }
  const owes = [...pair.entries()]
    .filter(([, v]) => Math.abs(v) > 0.005)
    .map(([k, v]) => {
      const [a, b, currency] = k.split('|');
      return v > 0 ? { from: a, to: b, amount: Math.round(v * 100) / 100, currency } : { from: b, to: a, amount: Math.round(-v * 100) / 100, currency };
    });
  const all = computeGroupLedger(ws, state.decisions, state.commitments, { conflicts: state.conflicts, evidenceMap: state.evidenceMap, messages, defaultCurrency: opts.defaultCurrency, topics: state.topics });
  const plan = computeGroupPlan(ws, state.decisions, state.commitments, state.evidenceMap, all);
  return {
    topics: cards,
    owes,
    settle: settleUp([...net.values()].map(n => ({ ...n, amount: Math.round(n.amount * 100) / 100 }))),
    spend: totalsText(plan.spend.groupTotals),
    updatedAt: Date.now(),
  };
}
