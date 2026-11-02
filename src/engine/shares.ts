import { Commitment, Decision, GroupIntelligenceState, User, Workspace } from '../types/groupOs';
import { normalizeCurrency, sameName } from './receiptVerifier';

/**
 * A decision such as "Rent share per person: 9000 each" is an obligation for every member it covers. This turns those
 * decisions into "what each person owes", with a state per person, and totals computed in code so a model never has to add.
 */

export type ShareState = 'unpaid' | 'claimed' | 'paid';

export interface ShareLine {
  /** False while the split is only suggested and nobody has agreed to it yet. */
  agreed: boolean;
  decisionId: string;
  workspaceId: string;
  workspaceTitle: string;
  topic: string;
  amount: number;
  currency: string;
  collector?: string;
  state: ShareState;
}

export interface CollectedShare {
  decisionId: string;
  workspaceId: string;
  workspaceTitle: string;
  topic: string;
  amount: number;
  currency: string;
  people: { name: string; state: ShareState }[];
}

const isMember = (ws: Workspace, name: string) => ws.participants.some(p => sameName(name, p.name) === true);

function members(decision: Decision, ws: Workspace): string[] {
  const split = decision.split!;
  return split.among === 'everyone' ? ws.participants.map(p => p.name) : split.among;
}

/** Where one person stands on one share, from the payment commitments recorded for it. */
export function shareStateFor(decision: Decision, person: string, commitments: Commitment[]): ShareState {
  const mine = commitments.filter(c => c.shareOfDecisionId === decision.id && sameName(person, c.ownerName) === true && c.status !== 'cancelled');
  if (mine.some(c => c.status === 'completed')) return 'paid';
  if (mine.some(c => c.status === 'needs_clarification' && c.verification?.state !== 'disputed')) return 'claimed';
  return 'unpaid';
}

/** A bill filed under "…due date" is still the bill: show it by its name. */
export const billName = (topic: string): string => topic.replace(/\b(due date|deadline|due)\b/gi, ' ').replace(/\s+/g, ' ').trim() || topic;

/** A split counts once it is agreed or simply suggested. One the group disagrees about, tabled or rejected waits until it is settled. */
export const countsAsOwed = (d: Decision) => !!d.split && (d.status === 'confirmed' || d.status === 'proposed');
const counts = countsAsOwed;

/**
 * The splits of one group, cleaned up. A model may record one bill twice ("Electricity share: 606 each" and
 * "Electricity bill: 1,820 total"); those are the same bill, so only one is kept. A split with no currency takes the
 * group's currency when the other splits agree on one.
 */
export function groupSplits(ws: Workspace, decisions: Decision[]): Decision[] {
  const all = decisions.filter(counts);
  const currencies = new Set(all.map(d => d.split!.currency).filter((c): c is string => !!c).map(currencyKey));
  const fallback = currencies.size === 1 ? all.map(d => d.split!.currency).find(Boolean) : undefined;
  const kept: Decision[] = [];
  for (const d of all) {
    const withCurrency = d.split!.currency || !fallback ? d : { ...d, split: { ...d.split!, currency: fallback } };
    const amount = perShare(withCurrency.split!, members(withCurrency, ws).length);
    const twin = kept.findIndex(k => {
      const sameCollector = !k.split!.collector || !withCurrency.split!.collector || sameName(k.split!.collector, withCurrency.split!.collector) === true;
      const sameCurrency = !k.split!.currency || !withCurrency.split!.currency || currencyKey(k.split!.currency) === currencyKey(withCurrency.split!.currency);
      return sameCollector && sameCurrency && Math.abs(perShare(k.split!, members(k, ws).length) - amount) <= Math.max(1, amount * 0.01);
    });
    if (twin === -1) kept.push(withCurrency);
    // Keep the one that states what each person pays, since that is what the chat said.
    else if (kept[twin].split!.perPerson === 0 && withCurrency.split!.perPerson > 0) kept[twin] = withCurrency;
  }
  return kept;
}

/** What each person pays: stated directly, or the total divided by the number of people it covers. */
export function perShare(split: NonNullable<Decision['split']>, count: number): number {
  if (split.perPerson > 0) return split.perPerson;
  return split.total && count > 0 ? Math.round((split.total / count) * 100) / 100 : 0;
}

export function computeMyShares(
  workspaces: Workspace[],
  scopedIds: string[],
  decisionsByWs: Record<string, Decision[]>,
  commitmentsByWs: Record<string, Commitment[]>,
  user: User
): { owed: ShareLine[]; collecting: CollectedShare[] } {
  const owed: ShareLine[] = [];
  const collecting: CollectedShare[] = [];

  for (const ws of workspaces.filter(w => scopedIds.includes(w.id))) {
    const commitments = commitmentsByWs[ws.id] || [];
    for (const d of groupSplits(ws, decisionsByWs[ws.id] || [])) {
      const split = d.split!;
      const everyone = members(d, ws);
      const iAmCollector = !!split.collector && sameName(user.name, split.collector) === true;
      const covered = split.among === 'everyone' ? isMember(ws, user.name) : split.among.some(n => sameName(user.name, n) === true);
      const amount = perShare(split, everyone.length);
      if (!amount) continue;
      const base = { agreed: d.status === 'confirmed', decisionId: d.id, workspaceId: ws.id, workspaceTitle: ws.title, topic: billName(d.topic), amount, currency: split.currency ?? '' };

      if (iAmCollector) {
        collecting.push({ ...base, people: everyone.filter(n => sameName(user.name, n) !== true).map(name => ({ name, state: shareStateFor(d, name, commitments) })) });
      } else if (covered) {
        owed.push({ ...base, collector: split.collector, state: shareStateFor(d, user.name, commitments) });
      }
    }
  }
  return { owed, collecting };
}

/** Someone picks who receives a split's money, or says it is paid to someone outside the group. Idempotent. */
export function setCollector(input: GroupIntelligenceState, decisionId: string, who: string | 'outside'): GroupIntelligenceState {
  const state = structuredClone(input) as GroupIntelligenceState;
  const decision = state.decisions.find(d => d.id === decisionId);
  if (!decision?.split) return state;
  if (who === 'outside') {
    decision.split.outside = true;
    delete decision.split.collector;
  } else {
    decision.split.collector = who;
    delete decision.split.outside;
  }
  return state;
}

/** "I paid my share": records a claim (not a payment) that the recipient can confirm like any other. Idempotent. */
export function markSharePaid(
  input: GroupIntelligenceState,
  decisionId: string,
  userName: string,
  ctx: { now: string; groupSize?: number }
): GroupIntelligenceState {
  const state = structuredClone(input) as GroupIntelligenceState;
  const decision = state.decisions.find(d => d.id === decisionId);
  if (!decision?.split) return state;
  if (shareStateFor(decision, userName, state.commitments) !== 'unpaid') return state;
  const amount = perShare(decision.split, ctx.groupSize ?? 0);
  if (!amount) return state;

  const key = `${decisionId}_${userName.toLowerCase().replace(/\W+/g, '_')}`;
  const evId = `ev_share_${key}`;
  state.evidenceMap[evId] = {
    id: evId,
    messageId: 'user_action_share_paid',
    quote: `${userName} says they paid their share of ${billName(decision.topic)} (${decision.split.currency ?? ''}${amount}).`,
    sourceType: 'user_confirmation',
    verificationStatus: 'claimed_unverified',
    explanation: 'Reported by the person who paid. Not yet confirmed by the recipient.',
  };
  state.commitments.unshift({
    id: `com_share_${key}`,
    conversationId: decision.conversationId,
    ownerId: `u_${userName.toLowerCase()}`,
    ownerName: userName,
    description: `Paid my share of ${billName(decision.topic)}`,
    status: 'needs_clarification',
    evidenceIds: [evId],
    lastUpdatedAt: ctx.now,
    amount,
    ...(decision.split.currency ? { currency: decision.split.currency } : {}),
    ...(decision.split.collector ? { payee: decision.split.collector } : {}),
    shareOfDecisionId: decisionId,
  });
  return state;
}

const currencyKey = (c: string) => normalizeCurrency(c) ?? '';
