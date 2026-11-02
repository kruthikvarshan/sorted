import { amountFromQuotes, amountInText } from './amounts';
import {
  Commitment,
  CommitmentStatus,
  Conflict,
  Decision,
  DecisionHistoryEntry,
  DecisionStatus,
  Evidence,
  GroupIntelligenceState,
  Message,
  PaymentVerification,
  SplitTerms,
} from '../types/groupOs';

/**
 * Model output is treated as a *proposal*. Nothing reaches state until every cited
 * quote is verified verbatim against the real message, and a confirmed decision is
 * never overwritten: a contradicting proposal raises a conflict instead.
 */

export interface EvidenceRef {
  messageId: string;
  quote: string;
  /** English meaning of a non-English quote. The quote itself is still verified verbatim. */
  translation?: string;
}

export type Proposal =
  | {
      kind: 'decision';
      topic: string;
      value: string;
      status: Extract<DecisionStatus, 'proposed' | 'confirmed' | 'rejected' | 'unresolved'>;
      reason?: string;
      /** Set by the model when asked "is this the same thing?" after a would-be contradiction. Used only during extraction. */
      sameSubject?: boolean;
      /** When the decision says what each person pays. */
      split?: SplitTerms;
      evidence: EvidenceRef[];
    }
  | {
      kind: 'commitment';
      ownerName: string;
      description: string;
      dueAt?: string;
      status: Extract<CommitmentStatus, 'proposed' | 'accepted' | 'in_progress' | 'completed' | 'cancelled'>;
      /** True when the person says they paid or sent money. Stays unverified until a receipt backs it. */
      paymentClaim?: boolean;
      /** The receiver said in the chat that they got it. Checked in code: a cited message must be from the payee. */
      receivedConfirmed?: boolean;
      /** For money: who receives it (the owner pays), the amount as a plain number, and the currency symbol. */
      payee?: string;
      amount?: number;
      currency?: string;
      evidence: EvidenceRef[];
    }
  | { kind: 'conflict'; topic: string; description: string; evidence: EvidenceRef[] };

export type ProposalOutcome = 'created' | 'reinforced' | 'updated' | 'unchanged' | 'conflict_raised';

export interface ProposalResult {
  proposal: Proposal;
  accepted: boolean;
  outcome?: ProposalOutcome;
  reason?: string;
}

export interface ApplyContext {
  conversationId: string;
  messages: Message[];
  actor: DecisionHistoryEntry['actorType'];
  actorLabel: string;
  now: string;
}

export type ConflictChoice = 'keep_current' | 'adopt_proposal' | 'dismiss' | 'different_subject';

const DECISION_STATUSES = ['proposed', 'confirmed', 'rejected', 'unresolved'];
const COMMITMENT_STATUSES = ['proposed', 'accepted', 'in_progress', 'completed', 'cancelled'];
/**
 * Backstop for the paymentClaim flag. Descriptions are always written in English (the prompt requires it), so this works
 * for chats in any language. Over-flagging is the safe failure: an item stays "needs clarification" until a receipt backs it.
 */
const PAYMENT_LANGUAGE =
  /\b(pay|paid|payment|payments|transfer|transferred|upi|gpay|refund|reimburse\w*|settle[ds]?|deposit|advance|rent|bill|fee|fees|dues|money|cash)\b|[₹$€£]\s?\d|\brs\.?\s?\d/i;
export const looksLikePayment = (description: string) => PAYMENT_LANGUAGE.test(description);

const COMMITMENT_RANK: Record<string, number> = {
  proposed: 0,
  needs_clarification: 0,
  accepted: 1,
  in_progress: 2,
  completed: 3,
};

/* ---------- text matching ---------- */

const squash = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

const loose = (s: string) =>
  squash(s)
    .replace(/[^\p{L}\p{N}₹$%]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function quoteIsVerbatim(quote: string, content: string): boolean {
  const q = squash(quote)
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/(\.\.\.|…)+$/, '')
    .trim();
  const looseQuote = loose(q);
  if (!looseQuote) return false;
  // Very short quotes are only trusted when they are the entire message ("On it", "k"), not a fragment of a longer one.
  if (looseQuote.length < 6 && looseQuote !== loose(content)) return false;
  return squash(content).includes(q) || loose(content).includes(looseQuote);
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'for', 'to', 'and', 'trip', 'group']);
const tokens = (s: string) => loose(s).split(' ').filter(t => t && !STOPWORDS.has(t));

function setOverlap(a: string[], b: string[]) {
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  A.forEach(t => B.has(t) && inter++);
  return { inter, a: A.size, b: B.size };
}

/** "…day" and "…time" are never the same topic, however similar the rest of the name. */
const KIND_WORD = /\b(time|timing|day|date)\b/i;
const kindWord = (s: string) => {
  const m = s.toLowerCase().match(KIND_WORD)?.[1];
  return m === 'timing' ? 'time' : m === 'date' ? 'day' : m;
};

/** A value that is only a clock time ("7pm", "6:30"), or only a day or date ("Saturday", "Dec 12"). */
export function valueKind(value: string): 'clock' | 'day' | 'other' {
  const v = value.toLowerCase();
  const clock = /\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}:\d{2}\b/.test(v);
  const day = /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|\b\d{1,2}(st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\b(today|tomorrow|tonight|weekend)\b/.test(v);
  return clock && !day ? 'clock' : day && !clock ? 'day' : 'other';
}

export function topicsMatch(a: string, b: string): boolean {
  const ka = kindWord(a);
  const kb = kindWord(b);
  if (ka && kb && ka !== kb) return false;
  const { inter, a: na, b: nb } = setOverlap(tokens(a), tokens(b));
  if (!na || !nb) return false;
  const smaller = Math.min(na, nb);
  const larger = Math.max(na, nb);
  if (inter / (na + nb - inter) >= 0.5) return true;
  return inter === smaller && larger <= smaller + 2;
}

export function valuesAgree(a: string, b: string): boolean {
  const la = loose(a);
  const lb = loose(b);
  if (!la || !lb) return la === lb;
  if (la === lb || la.includes(lb) || lb.includes(la)) return true;
  const { inter, a: na, b: nb } = setOverlap(la.split(' '), lb.split(' '));
  return inter / (na + nb - inter) >= 0.8;
}

const hash = (s: string) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

/* ---------- validation ---------- */

export function summarizeProposal(p: Proposal): string {
  if (p.kind === 'decision') return `Decision "${p.topic}": ${p.value}`;
  if (p.kind === 'commitment') return `Commitment by ${p.ownerName}: ${p.description}`;
  return `Conflict "${p.topic}": ${p.description}`;
}

export function validateProposal(
  p: Proposal,
  messagesById: Map<string, Message>
): { ok: true } | { ok: false; reason: string } {
  const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

  if (p.kind === 'decision') {
    if (!text(p.topic) || !text(p.value)) return { ok: false, reason: 'topic and value are required' };
    if (!DECISION_STATUSES.includes(p.status)) {
      return { ok: false, reason: `status must be one of ${DECISION_STATUSES.join(', ')}` };
    }
  } else if (p.kind === 'commitment') {
    if (!text(p.ownerName) || !text(p.description)) {
      return { ok: false, reason: 'ownerName and description are required' };
    }
    if (!COMMITMENT_STATUSES.includes(p.status)) {
      return { ok: false, reason: `status must be one of ${COMMITMENT_STATUSES.join(', ')}` };
    }
    if (p.amount !== undefined && !(Number.isFinite(p.amount) && p.amount > 0)) {
      return { ok: false, reason: 'amount must be a positive number' };
    }
  } else if (!text(p.topic) || !text(p.description)) {
    return { ok: false, reason: 'topic and description are required' };
  }

  if (!Array.isArray(p.evidence) || p.evidence.length === 0) {
    return { ok: false, reason: 'at least one evidence item {messageId, quote} is required' };
  }
  for (const ref of p.evidence) {
    const msg = messagesById.get(ref?.messageId);
    if (!msg) return { ok: false, reason: `messageId "${ref?.messageId}" does not exist in this conversation` };
    if (!text(ref.quote) || !quoteIsVerbatim(ref.quote, msg.content)) {
      return { ok: false, reason: `quote is not verbatim text from message ${ref.messageId}` };
    }
  }
  return { ok: true };
}

/* ---------- state helpers ---------- */

const computeConfidence = (status: DecisionStatus, supporting: number, contradicting: number) => {
  const base: Record<string, number> = { confirmed: 0.8, proposed: 0.5, unresolved: 0.35, rejected: 0.7, conflicted: 0.4 };
  const score = (base[status] ?? 0.5) + Math.min(supporting - 1, 3) * 0.05 - contradicting * 0.1;
  return Math.round(Math.max(0.1, Math.min(0.97, score)) * 100) / 100;
};

function internEvidence(
  evidenceMap: Record<string, Evidence>,
  refs: EvidenceRef[],
  messagesById: Map<string, Message>,
  explanation: string
): string[] {
  return refs.map(ref => {
    const msg = messagesById.get(ref.messageId)!;
    const id = `ev_${ref.messageId}_${hash(squash(ref.quote))}`;
    const translation = ref.translation?.trim() || undefined;
    if (!evidenceMap[id]) {
      evidenceMap[id] = {
        id,
        messageId: ref.messageId,
        quote: ref.quote.trim(),
        sourceType: 'message',
        verificationStatus: 'supported',
        explanation: `${explanation} (${msg.speakerName}, quote verified verbatim)`,
        ...(translation ? { translation } : {}),
      };
    } else if (translation && !evidenceMap[id].translation) {
      evidenceMap[id].translation = translation;
    }
    return id;
  });
}

const addUnique = (list: string[], ids: string[]) => {
  let changed = false;
  ids.forEach(id => {
    if (!list.includes(id)) {
      list.push(id);
      changed = true;
    }
  });
  return changed;
};

function historyEntry(
  decision: Decision,
  ctx: ApplyContext,
  fields: Pick<DecisionHistoryEntry, 'newValue' | 'newStatus' | 'reason' | 'evidenceIds'> &
    Partial<Pick<DecisionHistoryEntry, 'previousValue' | 'previousStatus'>>
): DecisionHistoryEntry {
  return {
    id: nextId('h'),
    decisionId: decision.id,
    actorType: ctx.actor,
    timestamp: ctx.now,
    ...fields,
  };
}

function raiseConflict(
  state: GroupIntelligenceState,
  ctx: ApplyContext,
  input: {
    topic: string;
    description: string;
    evidenceIds: string[];
    decisionId?: string;
    incumbent?: string;
    challenger?: string;
  }
): Conflict {
  const existing = state.conflicts.find(
    c =>
      c.status === 'open' &&
      ((input.decisionId && c.relatedDecisionIds.includes(input.decisionId)) || topicsMatch(c.topic, input.topic))
  );
  if (existing) {
    addUnique(existing.evidenceIds, input.evidenceIds);
    existing.description = input.description;
    if (input.challenger) existing.challengerValue = input.challenger;
    return existing;
  }

  const isDecision = !!input.decisionId && !!input.challenger;
  const conflict: Conflict = {
    id: nextId('conf'),
    conversationId: ctx.conversationId,
    topic: input.topic,
    description: input.description,
    relatedDecisionIds: input.decisionId ? [input.decisionId] : [],
    evidenceIds: [...input.evidenceIds],
    impactedItemIds: [],
    status: 'open',
    createdAt: ctx.now,
    incumbentValue: input.incumbent,
    challengerValue: input.challenger,
    resolutionOptions: isDecision
      ? [
          {
            label: `Keep "${input.incumbent}"`,
            actionType: 'keep_current',
            description: 'Keep the confirmed plan and set the new proposal aside.',
          },
          {
            label: `Switch to "${input.challenger}"`,
            actionType: 'adopt_proposal',
            description: 'Adopt the new proposal. The earlier value stays in history.',
          },
          {
            label: 'These are different things',
            actionType: 'different_subject',
            description: 'Not a contradiction: keep both. The new value becomes its own item.',
          },
        ]
      : [
          {
            label: 'Mark as resolved',
            actionType: 'dismiss',
            description: 'The group has dealt with this outside the chat.',
          },
        ],
  };
  state.conflicts.unshift(conflict);
  return conflict;
}

/* ---------- applying proposals ---------- */

export function applyProposals(
  input: GroupIntelligenceState,
  proposals: Proposal[],
  ctx: ApplyContext
): { state: GroupIntelligenceState; results: ProposalResult[] } {
  const state = structuredClone(input) as GroupIntelligenceState;
  const messagesById = new Map(ctx.messages.map(m => [m.id, m]));
  const speakerIds = new Map(ctx.messages.map(m => [squash(m.speakerName), m.speakerId]));
  const results: ProposalResult[] = [];

  // Apply in the order things were said, whatever order the model listed them in. Without this a confirmed
  // decision followed by a later contradiction would only raise a conflict if the model happened to list them that way.
  const indexById = new Map(ctx.messages.map((m, i) => [m.id, i]));
  const stamp = (p: Proposal) =>
    p.evidence?.length ? Math.max(...p.evidence.map(e => indexById.get(e.messageId) ?? -1)) : -1;
  const touchIndex = (evidenceIds: string[]) =>
    Math.max(-1, ...evidenceIds.map(id => indexById.get(state.evidenceMap[id]?.messageId ?? '') ?? -1));
  const speakersOf = (p: Proposal) => new Set(p.evidence.map(e => messagesById.get(e.messageId)?.speakerName).filter(Boolean) as string[]);
  /** The person whose message first established this decision. */
  const originalSpeaker = (d: Decision) =>
    d.supportingEvidenceIds.map(id => messagesById.get(state.evidenceMap[id]?.messageId ?? '')?.speakerName).find(Boolean);
  /**
   * A confirmed value may be replaced only by an explicit agreement: the model says "confirmed" and the cited
   * messages come from two or more people, or from the person who set the value in the first place.
   * A single other person contradicting it is a conflict, not a change.
   */
  const isExplicitSupersession = (d: Decision, p: Proposal) => {
    if (p.kind !== 'decision' || p.status !== 'confirmed' || d.status !== 'confirmed') return false;
    const speakers = speakersOf(p);
    const original = originalSpeaker(d);
    return speakers.size >= 2 || (speakers.size === 1 && !!original && speakers.has(original));
  };
  const ordered = proposals
    .map((proposal, position) => ({ proposal, position }))
    .sort((a, b) => stamp(a.proposal) - stamp(b.proposal) || a.position - b.position)
    .map(x => x.proposal);

  for (const proposal of ordered) {
    const check = validateProposal(proposal, messagesById);
    if (!check.ok) {
      results.push({ proposal, accepted: false, reason: check.reason });
      continue;
    }

    let outcome: ProposalOutcome = 'unchanged';
    const lastMsg = messagesById.get(proposal.evidence[proposal.evidence.length - 1].messageId)!;

    if (proposal.kind === 'decision') {
      const evIds = internEvidence(state.evidenceMap, proposal.evidence, messagesById, proposal.reason || 'Cited by model');
      let topic = proposal.topic.trim();
      let existing = state.decisions.find(d => topicsMatch(d.topic, topic));
      // A day and a clock time are never a contradiction ("Saturday" filed under "walk time", then "7pm"): keep them
      // as two items, "walk day" and "walk time", instead of raising a false conflict.
      if (existing) {
        const was = valueKind(existing.currentValue);
        const now = valueKind(proposal.value);
        if (was !== now && was !== 'other' && now !== 'other') {
          const base = existing.topic.replace(/\b(time|timing|day|date)\b/gi, ' ').replace(/\s+/g, ' ').trim() || existing.topic;
          const label = (k: 'clock' | 'day') => (k === 'clock' ? 'time' : 'day');
          existing.topic = `${base} ${label(was)}`;
          topic = `${base} ${label(now)}`;
          existing = state.decisions.find(d => topicsMatch(d.topic, topic));
        }
      }

      if (!existing) {
        const decision: Decision = {
          id: nextId('dec'),
          conversationId: ctx.conversationId,
          topic,
          currentValue: proposal.value.trim(),
          status: proposal.status,
          supportingEvidenceIds: [...evIds],
          contradictingEvidenceIds: [],
          confidence: computeConfidence(proposal.status, evIds.length, 0),
          lastUpdatedAt: ctx.now,
          updatedBy: lastMsg.speakerName,
          history: [],
          ...(proposal.split ? { split: proposal.split } : {}),
        };
        decision.history.push(
          historyEntry(decision, ctx, {
            newValue: decision.currentValue,
            newStatus: decision.status,
            reason: proposal.reason || `First noticed in ${lastMsg.speakerName}'s message.`,
            evidenceIds: evIds,
          })
        );
        state.decisions.unshift(decision);
        outcome = 'created';
      } else if (valuesAgree(existing.currentValue, proposal.value)) {
        const grew = addUnique(existing.supportingEvidenceIds, evIds);
        if (proposal.split && !existing.split) existing.split = proposal.split;
        if (proposal.status === 'confirmed' && (existing.status === 'proposed' || existing.status === 'unresolved')) {
          existing.history.push(
            historyEntry(existing, ctx, {
              previousValue: existing.currentValue,
              newValue: existing.currentValue,
              previousStatus: existing.status,
              newStatus: 'confirmed',
              reason: proposal.reason || 'Group agreement found in a later message.',
              evidenceIds: evIds,
            })
          );
          existing.status = 'confirmed';
          outcome = 'updated';
        } else {
          outcome = grew ? 'reinforced' : 'unchanged';
        }
        if (outcome !== 'unchanged') {
          existing.confidence = computeConfidence(existing.status, existing.supportingEvidenceIds.length, existing.contradictingEvidenceIds.length);
          existing.lastUpdatedAt = ctx.now;
          existing.updatedBy = lastMsg.speakerName;
        }
      } else if (stamp(proposal) < Math.max(touchIndex(existing.supportingEvidenceIds), touchIndex(existing.contradictingEvidenceIds))) {
        // Older than what the decision already rests on (a replayed or out-of-date reading): it cannot change or contradict it.
        outcome = 'unchanged';
      } else if (isExplicitSupersession(existing, proposal)) {
        // Both sides agreed to the change (or the person who set the value changed it themselves): the new value
        // takes over, and the old value, who agreed, and the evidence stay in history. Never silent.
        const previousValue = existing.currentValue;
        existing.history.push(
          historyEntry(existing, ctx, {
            previousValue,
            newValue: proposal.value.trim(),
            previousStatus: 'confirmed',
            newStatus: 'confirmed',
            reason: `Changed by agreement (${Array.from(speakersOf(proposal)).join(' and ')}). The earlier value "${previousValue}" is kept in the history.`,
            evidenceIds: evIds,
          })
        );
        existing.currentValue = proposal.value.trim();
        if (proposal.split) existing.split = proposal.split;
        addUnique(existing.supportingEvidenceIds, evIds);
        existing.confidence = computeConfidence('confirmed', existing.supportingEvidenceIds.length, existing.contradictingEvidenceIds.length);
        existing.lastUpdatedAt = ctx.now;
        existing.updatedBy = lastMsg.speakerName;
        outcome = 'updated';
      } else if (existing.status === 'confirmed' || existing.status === 'conflicted') {
        // Anti-silent-overwrite: keep the confirmed value, flag the disagreement.
        const grew = addUnique(existing.contradictingEvidenceIds, evIds);
        const previousStatus = existing.status;
        existing.status = 'conflicted';
        existing.needsClarification = true;
        existing.clarificationQuestion = `"${existing.currentValue}" is confirmed, but ${lastMsg.speakerName} said "${proposal.value}". Which should the group go with?`;
        existing.confidence = computeConfidence('conflicted', existing.supportingEvidenceIds.length, existing.contradictingEvidenceIds.length);
        existing.lastUpdatedAt = ctx.now;
        existing.updatedBy = lastMsg.speakerName;
        if (grew || previousStatus !== 'conflicted') {
          existing.history.push(
            historyEntry(existing, ctx, {
              previousValue: existing.currentValue,
              newValue: existing.currentValue,
              previousStatus,
              newStatus: 'conflicted',
              reason: `${lastMsg.speakerName} suggested "${proposal.value}", but "${existing.currentValue}" was already confirmed. The confirmed value was kept and the difference flagged.`,
              evidenceIds: evIds,
            })
          );
        }
        raiseConflict(state, ctx, {
          topic: existing.topic,
          description: `${lastMsg.speakerName} proposed "${proposal.value}", which contradicts the confirmed "${existing.currentValue}".`,
          evidenceIds: [...existing.supportingEvidenceIds.slice(0, 1), ...evIds],
          decisionId: existing.id,
          incumbent: existing.currentValue,
          challenger: proposal.value.trim(),
        });
        outcome = grew || previousStatus !== 'conflicted' ? 'conflict_raised' : 'unchanged';
      } else {
        // Earlier value was only a proposal: a revised proposal replaces it, with history.
        existing.history.push(
          historyEntry(existing, ctx, {
            previousValue: existing.currentValue,
            newValue: proposal.value.trim(),
            previousStatus: existing.status,
            newStatus: proposal.status,
            reason: proposal.reason || `Revised by ${lastMsg.speakerName}.`,
            evidenceIds: evIds,
          })
        );
        existing.currentValue = proposal.value.trim();
        if (proposal.split) existing.split = proposal.split;
        existing.status = proposal.status;
        addUnique(existing.supportingEvidenceIds, evIds);
        existing.confidence = computeConfidence(existing.status, existing.supportingEvidenceIds.length, existing.contradictingEvidenceIds.length);
        existing.lastUpdatedAt = ctx.now;
        existing.updatedBy = lastMsg.speakerName;
        outcome = 'updated';
      }
    } else if (proposal.kind === 'commitment') {
      const evIds = internEvidence(state.evidenceMap, proposal.evidence, messagesById, 'Commitment cited by model');
      // "I paid" is a claim, not a payment: no receipt, no completion.
      const unverifiedPayment =
        proposal.status === 'completed' && (proposal.paymentClaim === true || looksLikePayment(proposal.description));
      if (unverifiedPayment) {
        evIds.forEach(id => {
          const ev = state.evidenceMap[id];
          if (ev && ev.verificationStatus === 'supported') {
            ev.verificationStatus = 'claimed_unverified';
            ev.explanation = 'Payment claimed in chat; no receipt has been verified.';
          }
        });
      }
      // A payment confirmed by the person who received it, in their own message, is settled: that is the human check.
      const receiverMessage = proposal.receivedConfirmed && proposal.payee
        ? proposal.evidence.map(e => messagesById.get(e.messageId)).find(m => m && squash(m.speakerName).split(' ')[0] === squash(proposal.payee!).split(' ')[0])
        : undefined;
      const confirmedByReceiver: PaymentVerification | undefined = receiverMessage
        ? { state: 'confirmed', reasons: [`${receiverMessage.speakerName} said in the chat that they received it.`], decidedBy: receiverMessage.speakerName, decidedAt: ctx.now, basis: 'recipient_only' }
        : undefined;
      const effectiveStatus: CommitmentStatus = confirmedByReceiver ? 'completed' : unverifiedPayment ? 'needs_clarification' : proposal.status;
      const owner = squash(proposal.ownerName);
      const sameOwner = state.commitments.filter(c => squash(c.ownerName) === owner);
      // Two payments of different amounts are two payments, however alike their descriptions ("Pay rent share to
      // Kruthik": 9,000 on the 10th, 19,000 on the 25th). The amount comes from the quotes when the model left it out.
      const proposedAmount = proposal.amount ?? (proposal.status === 'completed' && proposal.payee?.trim() ? amountInText(proposal.description) ?? amountFromQuotes(proposal.evidence.map(e => e.quote)) : undefined);
      const otherPayment = (c: Commitment) =>
        proposedAmount !== undefined && c.amount !== undefined && Math.abs(c.amount - proposedAmount) >= 1 && (c.status === 'completed' || proposal.status === 'completed');
      const existing =
        sameOwner.find(c => valuesAgree(c.description, proposal.description) && !otherPayment(c)) ||
        // A retraction rarely repeats the original wording, so match it more loosely.
        (proposal.status === 'cancelled' ? sameOwner.find(c => c.status !== 'cancelled' && topicsMatch(c.description, proposal.description)) : undefined);

      if (!existing && proposal.status === 'cancelled') {
        outcome = 'unchanged'; // nothing was committed, so there is nothing to cancel
      } else if (!existing) {
        state.commitments.unshift({
          id: nextId('com'),
          conversationId: ctx.conversationId,
          ownerId: speakerIds.get(owner) || `u_${owner.replace(/\W+/g, '_')}`,
          ownerName: proposal.ownerName.trim(),
          description: proposal.description.trim(),
          dueAt: proposal.dueAt?.trim() || undefined,
          status: effectiveStatus,
          evidenceIds: evIds,
          lastUpdatedAt: ctx.now,
          ...(proposal.payee?.trim() ? { payee: proposal.payee.trim() } : {}),
          ...(proposedAmount !== undefined ? { amount: proposedAmount } : {}),
          ...(proposal.currency?.trim() ? { currency: proposal.currency.trim() } : {}),
          ...(confirmedByReceiver ? { verification: confirmedByReceiver } : {}),
        });
        outcome = 'created';
      } else {
        const grew = addUnique(existing.evidenceIds, evIds);
        // Normally status only moves forward; an explicit retraction by the owner is the one way back.
        const retract = proposal.status === 'cancelled' && existing.status !== 'cancelled';
        const advance =
          retract ||
          (existing.status !== 'cancelled' &&
            existing.status !== 'needs_clarification' &&
            (COMMITMENT_RANK[effectiveStatus] ?? 0) > (COMMITMENT_RANK[existing.status] ?? 0)) ||
          (unverifiedPayment && existing.status !== 'cancelled' && existing.status !== 'completed' && existing.status !== 'needs_clarification');
        if (confirmedByReceiver && existing.status !== 'cancelled' && existing.verification?.state !== 'confirmed') {
          existing.status = 'completed';
          existing.verification = { ...existing.verification, ...confirmedByReceiver, reasons: confirmedByReceiver.reasons };
        } else if (advance) existing.status = effectiveStatus;
        if (proposal.dueAt && !existing.dueAt) existing.dueAt = proposal.dueAt.trim();
        // A later mention may add the money details the first one lacked; it never silently changes stated ones.
        if (proposal.payee?.trim() && !existing.payee) existing.payee = proposal.payee.trim();
        if (proposal.amount !== undefined && existing.amount === undefined) existing.amount = proposal.amount;
        if (proposal.currency?.trim() && !existing.currency) existing.currency = proposal.currency.trim();
        if (advance || grew) existing.lastUpdatedAt = ctx.now;
        outcome = advance ? 'updated' : grew ? 'reinforced' : 'unchanged';
      }
    } else {
      const evIds = internEvidence(state.evidenceMap, proposal.evidence, messagesById, 'Conflict cited by model');
      const linked = state.decisions.find(d => topicsMatch(d.topic, proposal.topic));
      if (linked && linked.status === 'confirmed') {
        addUnique(linked.contradictingEvidenceIds, evIds);
        linked.status = 'conflicted';
        linked.needsClarification = true;
        linked.clarificationQuestion = proposal.description;
        linked.lastUpdatedAt = ctx.now;
        linked.history.push(
          historyEntry(linked, ctx, {
            previousValue: linked.currentValue,
            newValue: linked.currentValue,
            previousStatus: 'confirmed',
            newStatus: 'conflicted',
            reason: `A problem was raised with a confirmed decision: ${proposal.description}`,
            evidenceIds: evIds,
          })
        );
      }
      const before = state.conflicts.length;
      const conflict = raiseConflict(state, ctx, {
        topic: proposal.topic.trim(),
        description: proposal.description.trim(),
        evidenceIds: evIds,
        decisionId: linked?.id,
      });
      if (linked && !conflict.relatedDecisionIds.includes(linked.id)) conflict.relatedDecisionIds.push(linked.id);
      outcome = state.conflicts.length > before || linked?.status === 'conflicted' ? 'conflict_raised' : 'reinforced';
    }

    results.push({ proposal, accepted: true, outcome });
  }

  return { state, results };
}

/* ---------- explicit human resolution ---------- */

export function resolveConflict(
  input: GroupIntelligenceState,
  conflictId: string,
  choice: ConflictChoice,
  ctx: Pick<ApplyContext, 'now'> & { actorLabel: string }
): GroupIntelligenceState {
  const state = structuredClone(input) as GroupIntelligenceState;
  const conflict = state.conflicts.find(c => c.id === conflictId);
  if (!conflict || conflict.status !== 'open') return state;

  const evId = `ev_user_resolution_${hash(conflictId + choice)}`;
  state.evidenceMap[evId] = {
    id: evId,
    messageId: 'user_action_resolve_conflict',
    quote: `${ctx.actorLabel} chose: ${choice === 'adopt_proposal' ? 'adopt the new proposal' : choice === 'keep_current' ? 'keep the confirmed plan' : choice === 'different_subject' ? 'these are two different things' : 'mark resolved'}`,
    sourceType: 'user_confirmation',
    verificationStatus: 'supported',
    explanation: 'Explicit user resolution of an open conflict.',
  };

  conflict.status = choice === 'dismiss' || choice === 'different_subject' ? 'dismissed' : 'resolved';
  conflict.resolvedAt = ctx.now;

  if (choice === 'different_subject') {
    // The extractor filed two different things under one topic. Keep both: the original goes back to normal and the
    // challenging value becomes its own item, so nothing the group said is lost.
    conflict.relatedDecisionIds.forEach(id => {
      const decision = state.decisions.find(d => d.id === id);
      if (!decision) return;
      const moved = [...decision.contradictingEvidenceIds];
      decision.history.push({
        id: nextId('h'),
        decisionId: decision.id,
        previousValue: decision.currentValue,
        newValue: decision.currentValue,
        previousStatus: decision.status,
        newStatus: 'confirmed',
        reason: `${ctx.actorLabel} said the other value is a different thing, so the disagreement was dismissed.`,
        evidenceIds: [evId],
        actorType: 'user',
        timestamp: ctx.now,
      });
      decision.contradictingEvidenceIds = [];
      decision.status = 'confirmed';
      decision.needsClarification = false;
      decision.clarificationQuestion = undefined;
      decision.confidence = computeConfidence('confirmed', decision.supportingEvidenceIds.length, 0);
      decision.lastUpdatedAt = ctx.now;

      if (conflict.challengerValue) {
        const separate: Decision = {
          id: nextId('dec'),
          conversationId: decision.conversationId,
          topic: `${decision.topic} (separate item)`,
          currentValue: conflict.challengerValue,
          status: 'proposed',
          supportingEvidenceIds: moved,
          contradictingEvidenceIds: [],
          confidence: computeConfidence('proposed', Math.max(1, moved.length), 0),
          lastUpdatedAt: ctx.now,
          updatedBy: ctx.actorLabel,
          history: [],
        };
        separate.history.push({
          id: nextId('h'),
          decisionId: separate.id,
          newValue: separate.currentValue,
          newStatus: 'proposed',
          reason: `Split out of "${decision.topic}" by ${ctx.actorLabel}: it is a different thing.`,
          evidenceIds: moved.length ? moved : [evId],
          actorType: 'user',
          timestamp: ctx.now,
        });
        state.decisions.unshift(separate);
      }
    });
    return state;
  }

  conflict.relatedDecisionIds.forEach(id => {
    const decision = state.decisions.find(d => d.id === id);
    if (!decision) return;
    const previousValue = decision.currentValue;
    const adopting = choice === 'adopt_proposal' && !!conflict.challengerValue;
    decision.history.push({
      id: nextId('h'),
      decisionId: decision.id,
      previousValue,
      newValue: adopting ? conflict.challengerValue! : previousValue,
      previousStatus: decision.status,
      newStatus: 'confirmed',
      reason: adopting
        ? `${ctx.actorLabel} adopted the new proposal; the earlier value is kept in history.`
        : `${ctx.actorLabel} kept the confirmed plan.`,
      evidenceIds: [evId],
      actorType: 'user',
      timestamp: ctx.now,
    });
    if (adopting) decision.currentValue = conflict.challengerValue!;
    decision.status = 'confirmed';
    decision.needsClarification = false;
    decision.clarificationQuestion = undefined;
    addUnique(decision.supportingEvidenceIds, [evId]);
    decision.confidence = computeConfidence('confirmed', decision.supportingEvidenceIds.length, decision.contradictingEvidenceIds.length);
    decision.lastUpdatedAt = ctx.now;
    decision.updatedBy = ctx.actorLabel;
  });

  return state;
}

/** The receiver saying they got it: "got it", "received", "aa gaya", "mil gaya", "vachindi"… */
const RECEIVED = /\b(got it|received|recieved|aa gaya|aagaya|aa gya|aaya|mil gaya|mila|mil gya|credited|vachindi|vachayi|done thanks|thanks bhai)\b/i;

/**
 * A payment someone claimed ("paid you 800", "bhej diya") is confirmed when the person who received it replies within
 * the next few messages that they got it, and the reply names no other amount. Done in code, so a missed
 * "receivedConfirmed" from the model does not leave a paid debt looking unpaid.
 */
export function confirmFromReplies(state: GroupIntelligenceState, messages: Message[]): GroupIntelligenceState {
  const at = new Map(messages.map((m, i) => [m.id, i]));
  const amounts = (t: string) => (t.replace(/(\d),(\d)/g, '$1$2').match(/\d+(?:\.\d+)?\s?k\b|\d{2,}/gi) ?? []).map(x => (/k$/i.test(x.trim()) ? parseFloat(x) * 1000 : parseFloat(x)));
  let changed = false;
  const commitments = state.commitments.map(c => {
    if (c.status !== 'needs_clarification' || !c.payee || c.verification?.state === 'disputed') return c;
    const last = Math.max(...c.evidenceIds.map(id => at.get(state.evidenceMap[id]?.messageId ?? '') ?? -1));
    if (last < 0) return c;
    const reply = messages.slice(last + 1, last + 9).find(m => {
      const payee = squash(c.payee!).split(' ')[0];
      if (squash(m.speakerName).split(' ')[0] !== payee || !RECEIVED.test(m.content)) return false;
      const said = amounts(m.content);
      return !said.length || !c.amount || said.some(n => Math.abs(n - c.amount!) < 1);
    });
    if (!reply) return c;
    changed = true;
    const verification: PaymentVerification = { state: 'confirmed', reasons: [`${reply.speakerName} replied that they got it: "${reply.content.slice(0, 80)}"`], decidedBy: reply.speakerName, decidedAt: '', basis: 'recipient_only' };
    return { ...c, status: 'completed' as const, verification };
  });
  return changed ? { ...state, commitments } : state;
}
