import { IntelligenceRun, Message, Workspace } from '../types/groupOs';

/**
 * How current each group's analysis is. A group is "stale" when its chat has more messages than the last analysis saw,
 * so nothing on the private screen can quietly present old results as if they were up to date.
 */

export type FreshnessState = 'never' | 'current' | 'stale' | 'unknown';

export interface GroupFreshness {
  workspaceId: string;
  title: string;
  state: FreshnessState;
  analyzedAt?: string;
  messagesNow: number;
  newMessages: number;
}

export function groupFreshness(
  workspaces: Workspace[],
  scopedIds: string[],
  runsByWs: Record<string, IntelligenceRun | undefined>,
  messagesByWs: Record<string, Message[] | undefined>
): GroupFreshness[] {
  return workspaces
    .filter(w => scopedIds.includes(w.id))
    .map(w => {
      const run = runsByWs[w.id];
      const messagesNow = (messagesByWs[w.id] || []).length;
      if (!run) return { workspaceId: w.id, title: w.title, state: 'never' as const, messagesNow, newMessages: 0 };
      // No count recorded, or the chat text is not kept under the retention setting: we cannot tell.
      if (run.messageCount === undefined || messagesNow === 0) {
        return { workspaceId: w.id, title: w.title, state: 'unknown' as const, analyzedAt: run.at, messagesNow, newMessages: 0 };
      }
      const newMessages = Math.max(0, messagesNow - run.messageCount);
      return { workspaceId: w.id, title: w.title, state: newMessages > 0 ? ('stale' as const) : ('current' as const), analyzedAt: run.at, messagesNow, newMessages };
    });
}

/** Groups worth re-analyzing: never analyzed, or with messages the last analysis did not see. */
export const needsRefresh = (f: GroupFreshness) => (f.state === 'never' || f.state === 'stale') && f.messagesNow > 0;
