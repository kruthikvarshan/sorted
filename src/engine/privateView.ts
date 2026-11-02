import { Commitment, Conflict, Decision, Evidence, User, Workspace } from '../types/groupOs';

/**
 * The private layer is built only from groups the user put in scope. Everything here is a pure
 * function of (state, scope), so unchecking a group removes its items immediately and tests can prove it.
 */

export interface PrivateCommitmentItem {
  workspaceId: string;
  workspaceTitle: string;
  commitment: Commitment;
  messageId?: string;
}

export interface PrivateConflictItem {
  workspaceId: string;
  workspaceTitle: string;
  conflict: Conflict;
  messageId?: string;
}

export interface PrivateView {
  groupCount: number;
  commitments: PrivateCommitmentItem[];
  conflicts: PrivateConflictItem[];
}

export interface PrivateViewInputs {
  workspaces: Workspace[];
  scopedIds: string[];
  decisionsByWs: Record<string, Decision[]>;
  commitmentsByWs: Record<string, Commitment[]>;
  conflictsByWs: Record<string, Conflict[]>;
  evidenceByWs: Record<string, Record<string, Evidence>>;
  user: User;
}

export interface GroupSummaryForModel {
  title: string;
  decisions: string;
  myCommitments: string;
  openConflicts: string;
}

const CLOSED = new Set(['completed', 'cancelled']);
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const isMine = (c: Commitment, user: User) => c.ownerId === user.id || sameName(c.ownerName, user.name);

const firstMessageId = (ids: string[], evidence: Record<string, Evidence> | undefined) =>
  ids.map(id => evidence?.[id]?.messageId).find(Boolean);

export function inScopeWorkspaces(workspaces: Workspace[], scopedIds: string[]) {
  return workspaces.filter(w => scopedIds.includes(w.id));
}

export function buildPrivateView(input: PrivateViewInputs): PrivateView {
  const groups = inScopeWorkspaces(input.workspaces, input.scopedIds);

  const commitments = groups
    .flatMap(w =>
      (input.commitmentsByWs[w.id] || [])
        .filter(c => isMine(c, input.user))
        .map(c => ({
          workspaceId: w.id,
          workspaceTitle: w.title,
          commitment: c,
          messageId: firstMessageId(c.evidenceIds, input.evidenceByWs[w.id]),
        }))
    )
    .sort((a, b) => Number(CLOSED.has(a.commitment.status)) - Number(CLOSED.has(b.commitment.status)));

  const conflicts = groups.flatMap(w =>
    (input.conflictsByWs[w.id] || [])
      .filter(c => c.status === 'open')
      .map(c => ({
        workspaceId: w.id,
        workspaceTitle: w.title,
        conflict: c,
        messageId: firstMessageId(c.evidenceIds, input.evidenceByWs[w.id]),
      }))
  );

  return { groupCount: groups.length, commitments, conflicts };
}

/** What the model may see: only in-scope groups, nothing else. */
export function summarizeGroupsForModel(input: PrivateViewInputs): GroupSummaryForModel[] {
  return inScopeWorkspaces(input.workspaces, input.scopedIds).map(w => ({
    title: w.title,
    decisions:
      (input.decisionsByWs[w.id] || []).map(d => `${d.topic}: ${d.currentValue} (${d.status})`).join('; ') || 'None',
    myCommitments:
      (input.commitmentsByWs[w.id] || [])
        .filter(c => isMine(c, input.user))
        .map(c => `${c.description} (${c.status}${c.dueAt ? `, due ${c.dueAt}` : ''})`)
        .join('; ') || 'None',
    openConflicts:
      (input.conflictsByWs[w.id] || [])
        .filter(c => c.status === 'open')
        .map(c => `${c.topic}: ${c.description}`)
        .join('; ') || 'None',
  }));
}

/** Model-free answer composed from real state. Always a summary, never keyword-matched canned text. */
export function localPrivateAnswer(view: PrivateView, money?: { totalsText: string; owedText?: string; lines: string[] }): string {
  if (view.groupCount === 0) {
    return 'No groups are in your scope, so there is nothing for the assistant to read. Tick at least one group above.';
  }
  const open = view.commitments.filter(i => !CLOSED.has(i.commitment.status));
  const lines: string[] = [
    `Across ${view.groupCount} group${view.groupCount === 1 ? '' : 's'} in your scope you have ${open.length} open commitment${open.length === 1 ? '' : 's'}.`,
  ];
  open.slice(0, 6).forEach(i => lines.push(`• [${i.workspaceTitle}] ${i.commitment.description} (${i.commitment.status.replace('_', ' ')})`));
  if (money && money.lines.length > 0) {
    lines.push(`In total you still owe ${money.totalsText}${money.owedText && money.owedText !== 'nothing' ? `, and you are owed ${money.owedText}` : ''}.`);
    money.lines.slice(0, 8).forEach(l => lines.push(`• ${l}`));
  }
  if (view.conflicts.length > 0) {
    lines.push(`Open conflicts in these groups: ${view.conflicts.length}.`);
    view.conflicts.slice(0, 4).forEach(i => lines.push(`• [${i.workspaceTitle}] ${i.conflict.topic}: ${i.conflict.description}`));
  }
  return lines.join('\n');
}
