import { Commitment, Decision, Evidence, InAppNotification, User, Workspace } from '../types/groupOs';
import { formatMoney } from './ledger';
import { isMine } from './privateView';
import { sameName } from './receiptVerifier';
import { computeMyShares } from './shares';

/**
 * Reminders are computed from what is actually open, never invented. Each has a stable id built from the item and
 * its state, so checking twice with nothing new adds nothing, and an item that gets resolved drops its reminder.
 */

export interface Reminder {
  id: string;
  workspaceId: string;
  workspaceTitle: string;
  title: string;
  message: string;
  evidenceMessageId?: string;
}

interface Inputs {
  workspaces: Workspace[];
  scopedIds: string[];
  commitmentsByWs: Record<string, Commitment[]>;
  /** Needed to remind people of the shares they owe or are collecting. */
  decisionsByWs?: Record<string, Decision[]>;
  evidenceByWs: Record<string, Record<string, Evidence>>;
  user: User;
}

const OPEN = new Set(['proposed', 'accepted', 'in_progress']);

export function computeReminders(input: Inputs): Reminder[] {
  const out: Reminder[] = [];
  for (const ws of input.workspaces.filter(w => input.scopedIds.includes(w.id))) {
    const evidence = input.evidenceByWs[ws.id] || {};
    const messageIdOf = (c: Commitment) => c.evidenceIds.map(id => evidence[id]?.messageId).find(id => id && !id.startsWith('user_action'));

    for (const c of input.commitmentsByWs[ws.id] || []) {
      if (isMine(c, input.user) && OPEN.has(c.status)) {
        out.push({
          id: `remind_owe_${c.id}_${c.status}`,
          workspaceId: ws.id,
          workspaceTitle: ws.title,
          title: c.status === 'proposed' ? 'A tentative promise of yours' : 'You committed to this',
          message: `${c.description}${c.dueAt ? ` (due ${c.dueAt})` : ''}`,
          evidenceMessageId: messageIdOf(c),
        });
      }

      const waitingOnMe =
        c.status === 'needs_clarification' &&
        !!c.payee &&
        sameName(input.user.name, c.payee) === true &&
        c.verification?.state !== 'confirmed' &&
        c.verification?.state !== 'disputed';
      if (waitingOnMe) {
        const receipt = c.verification?.state === 'receipt_consistent' ? ' A receipt agrees with it.' : '';
        out.push({
          id: `remind_confirm_${c.id}_${c.verification?.state ?? 'claim'}`,
          workspaceId: ws.id,
          workspaceTitle: ws.title,
          title: 'Someone says they paid you',
          message: `${c.ownerName} says they paid you${c.amount ? ` ${formatMoney(c.amount, c.currency ?? '')}` : ''}.${receipt} Confirm it or say it was not received.`,
          evidenceMessageId: messageIdOf(c),
        });
      }
    }
  }

  // Shares: what you owe from agreed cost splits, and what you are collecting that people have not paid yet.
  const { owed, collecting } = computeMyShares(input.workspaces, input.scopedIds, input.decisionsByWs ?? {}, input.commitmentsByWs, input.user);
  for (const s of owed.filter(x => x.state === 'unpaid')) {
    out.push({
      id: `remind_share_${s.decisionId}`,
      workspaceId: s.workspaceId,
      workspaceTitle: s.workspaceTitle,
      title: 'You owe your share',
      message: `${s.topic}: ${formatMoney(s.amount, s.currency)} in ${s.workspaceTitle}${s.collector ? `, to ${s.collector}` : ''}. Not paid yet.`,
    });
  }
  for (const c of collecting) {
    const waiting = c.people.filter(p => p.state === 'unpaid');
    if (waiting.length === 0) continue;
    out.push({
      id: `remind_collect_${c.decisionId}_${waiting.map(p => p.name).sort().join('-')}`,
      workspaceId: c.workspaceId,
      workspaceTitle: c.workspaceTitle,
      title: 'Money you are collecting',
      message: `${c.topic}: ${waiting.map(p => p.name).join(', ')} ${waiting.length === 1 ? 'has' : 'have'} not paid ${formatMoney(c.amount, c.currency)} yet.`,
    });
  }
  return out;
}

/** Bring the reminder notifications in line with what is open now. Other notifications are left alone. */
export function reconcileReminderNotifications(
  existing: InAppNotification[],
  wanted: Reminder[],
  userId: string,
  now: string
): { notifications: InAppNotification[]; added: number; removed: number } {
  const wantedIds = new Set(wanted.map(w => w.id));
  const kept = existing.filter(n => !n.id.startsWith('remind_') || wantedIds.has(n.id));
  const removed = existing.length - kept.length;
  const have = new Set(kept.map(n => n.id));
  const fresh: InAppNotification[] = wanted
    .filter(w => !have.has(w.id))
    .map(w => ({
      id: w.id,
      userId,
      conversationId: w.workspaceId,
      conversationName: w.workspaceTitle,
      title: w.title,
      message: w.message,
      type: 'reminder' as const,
      createdAt: now,
      isRead: false,
      evidenceMessageId: w.evidenceMessageId,
    }));
  return { notifications: [...fresh, ...kept], added: fresh.length, removed };
}
