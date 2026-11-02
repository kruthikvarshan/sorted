import { Commitment, Decision, Evidence, Workspace } from '../types/groupOs';
import { formatMoney } from './ledger';
import { GroupLedger } from './settle';
import { normalizeCurrency, sameName } from './receiptVerifier';

/**
 * The same idea as the money ledger, for the plan: what is fixed on the schedule, what is not fixed yet, what is due,
 * and what the group is spending. Everything comes from what the chat decided; nothing is looked up or invented.
 */

export type PlanKind = 'fixed' | 'tentative' | 'due';

export interface PlanItem {
  id: string;
  kind: PlanKind;
  title: string;
  /** The value as the chat said it ("Friday, 8 PM", "Nov 7 check-in"). */
  when: string;
  owner?: string;
  messageId?: string;
  /** Why it is not fixed: suggested, disagreed about or put off. */
  note?: string;
  sortKey: number;
}

export interface SpendTotals {
  currency: string;
  amount: number;
}

export interface GroupPlan {
  workspaceId: string;
  title: string;
  fixed: PlanItem[];
  tentative: PlanItem[];
  due: PlanItem[];
  spend: {
    groupTotals: SpendTotals[];
    byPerson: { name: string; totals: SpendTotals[]; ifApproved: SpendTotals[] }[];
  };
}

const SCHEDULE_WORDS =
  /\b(date|day|time|check[- ]?in|check[- ]?out|depart\w*|arriv\w*|leav\w*|reach|train|flight|bus|ticket|deadline|due|schedule|meeting|booking|booked|ceremony|pickup|pick[- ]?up|walk|dinner|lunch|visit|return)\b|\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const COST_TOPIC = /\b(cost|price|budget|fee|rate|amount|rent|rental|share|total)\b/i;
const CLOCK_OR_DATE = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i;

/** A cost is not an event: "Scooty rental cost, 400 a day" has the word "day" but belongs under spend. */
export const isScheduleDecision = (d: Decision) =>
  SCHEDULE_WORDS.test(`${d.topic} ${d.currentValue}`) && (!COST_TOPIC.test(d.topic) || CLOCK_OR_DATE.test(d.currentValue));

/** A rough position in time, only to put items in a sensible order. Items with no clue keep their original order, last. */
export function whenKey(text: string, fallback: number): number {
  const t = text.toLowerCase();
  const md = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/) ?? t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/);
  let base: number | undefined;
  if (md) {
    const month = MONTHS.indexOf(isNaN(Number(md[1])) ? md[1] : md[2]);
    const day = Number(isNaN(Number(md[1])) ? md[2] : md[1]);
    base = 1_000_000 + month * 3_100 + day * 100;
  } else {
    const wd = WEEKDAYS.findIndex(w => t.includes(w));
    if (wd >= 0) base = 500_000 + wd * 1_000;
  }
  if (base === undefined) return 9_000_000_000 + fallback;
  const tm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/);
  if (tm) {
    let h = Number(tm[1]) % 12;
    if (tm[3] === 'pm') h += 12;
    base += h * 4 + Math.floor(Number(tm[2] ?? 0) / 15);
  }
  return base;
}

const ckey = (c: string) => normalizeCurrency(c) ?? '';
const SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };
const symbolOf = (code: string) => SYMBOL[code] ?? (code ? `${code} ` : '');
export const totalsText = (rows: SpendTotals[]) => (rows.length ? rows.map(t => formatMoney(t.amount, symbolOf(t.currency))).join(' and ') : 'nothing');

function bump(map: Map<string, number>, currency: string, amount: number) {
  map.set(ckey(currency), (map.get(ckey(currency)) ?? 0) + amount);
}
const rows = (map: Map<string, number>): SpendTotals[] => Array.from(map.entries()).map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 }));

export function computeGroupPlan(
  ws: Workspace,
  decisions: Decision[],
  commitments: Commitment[],
  evidenceMap: Record<string, Evidence>,
  ledger: GroupLedger
): GroupPlan {
  const messageOf = (d: Decision) => evidenceMap[d.supportingEvidenceIds[0]]?.messageId;
  const fixed: PlanItem[] = [];
  const tentative: PlanItem[] = [];

  decisions.filter(isScheduleDecision).forEach((d, i) => {
    const waiting = ledger.waiting.find(w => w.topic.toLowerCase() === d.topic.toLowerCase());
    const base = { id: d.id, title: d.topic, when: d.currentValue, messageId: messageOf(d), sortKey: whenKey(`${d.topic} ${d.currentValue}`, i) };
    if (d.status === 'confirmed' && !waiting) fixed.push({ ...base, kind: 'fixed' });
    else if (d.status !== 'rejected')
      tentative.push({
        ...base,
        kind: 'tentative',
        note: d.status === 'conflicted' ? 'the group disagrees about it' : d.status === 'unresolved' ? 'put off for later' : 'suggested, not agreed yet',
      });
  });

  const due: PlanItem[] = commitments
    .filter(c => c.dueAt && c.status !== 'completed' && c.status !== 'cancelled')
    .map((c, i) => ({ id: c.id, kind: 'due' as const, title: c.description, when: c.dueAt!, owner: c.ownerName, sortKey: whenKey(c.dueAt!, i) }));

  const sort = (a: PlanItem, b: PlanItem) => a.sortKey - b.sortKey;
  fixed.sort(sort);
  tentative.sort(sort);
  due.sort(sort);

  // Spend: what each person's counted shares add up to, and what they would add if the disputed ones go ahead.
  const group = new Map<string, number>();
  const per = new Map<string, { mine: Map<string, number>; ifApproved: Map<string, number> }>();
  const person = (name: string) => {
    const key = name.trim().toLowerCase();
    if (!per.has(key)) per.set(key, { mine: new Map(), ifApproved: new Map() });
    return per.get(key)!;
  };
  const display = new Map<string, string>();
  for (const b of ledger.bills) {
    bump(group, b.currency, b.total);
    for (const name of b.people) {
      display.set(name.trim().toLowerCase(), name);
      bump(person(name).mine, b.currency, b.each);
    }
  }
  for (const w of ledger.waiting) {
    if (!w.eachAmount) continue;
    for (const name of w.appliesTo ?? []) {
      display.set(name.trim().toLowerCase(), name);
      bump(person(name).ifApproved, w.currency ?? '', w.eachAmount);
    }
  }

  return {
    workspaceId: ws.id,
    title: ws.title,
    fixed,
    tentative,
    due,
    spend: {
      groupTotals: rows(group),
      byPerson: Array.from(per.entries()).map(([key, v]) => ({ name: display.get(key) ?? key, totals: rows(v.mine), ifApproved: rows(v.ifApproved) })),
    },
  };
}

/* ---------- one person's plan across groups ---------- */

export interface MyPlanGroup {
  workspaceId: string;
  title: string;
  fixed: PlanItem[];
  tentative: PlanItem[];
  mine: PlanItem[];
  spend: SpendTotals[];
  ifApproved: SpendTotals[];
}

export interface MyPlan {
  groups: MyPlanGroup[];
  /** Everything fixed across groups in time order, tagged with its group. */
  timeline: (PlanItem & { group: string; workspaceId: string })[];
  spendText: string;
  ifApprovedText: string;
  spendTotals: SpendTotals[];
}

export function computeMyPlan(plans: GroupPlan[], workspaces: Workspace[], userName: string): MyPlan {
  const groups: MyPlanGroup[] = [];
  const total = new Map<string, number>();
  const maybe = new Map<string, number>();
  for (const p of plans) {
    const ws = workspaces.find(w => w.id === p.workspaceId);
    if (!ws?.participants.some(x => sameName(userName, x.name) === true)) continue;
    const me = p.spend.byPerson.find(x => sameName(userName, x.name) === true);
    const mine = p.due.filter(i => i.owner && sameName(userName, i.owner) === true);
    me?.totals.forEach(t => bump(total, t.currency, t.amount));
    me?.ifApproved.forEach(t => bump(maybe, t.currency, t.amount));
    if (p.fixed.length || p.tentative.length || mine.length || me) {
      groups.push({ workspaceId: p.workspaceId, title: p.title, fixed: p.fixed, tentative: p.tentative, mine, spend: me?.totals ?? [], ifApproved: me?.ifApproved ?? [] });
    }
  }
  const timeline = groups
    .flatMap(g => [...g.fixed, ...g.mine].map(i => ({ ...i, group: g.title, workspaceId: g.workspaceId })))
    .sort((a, b) => a.sortKey - b.sortKey);
  return { groups, timeline, spendTotals: rows(total), spendText: totalsText(rows(total)), ifApprovedText: totalsText(rows(maybe)) };
}
