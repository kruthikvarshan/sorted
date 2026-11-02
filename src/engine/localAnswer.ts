import { Commitment, Conflict, Decision, Evidence } from '../types/groupOs';

/**
 * Model-free answer for the active group, composed only from tracked state. Items are ranked by word overlap
 * with the question and cited with the real message ids behind their evidence.
 */

export interface LocalAnswerInput {
  workspaceTitle: string;
  query: string;
  decisions: Decision[];
  commitments: Commitment[];
  conflicts: Conflict[];
  evidenceMap: Record<string, Evidence>;
}

const FILLER = new Set([
  'what', 'whats', 'is', 'are', 'the', 'a', 'an', 'of', 'for', 'to', 'and', 'on', 'in', 'at', 'do', 'does', 'did',
  'we', 'our', 'us', 'my', 'me', 'i', 'you', 'who', 'when', 'where', 'how', 'why', 'which', 'about', 'tell', 'any',
  'there', 'with', 'it', 'this', 'that', 'have', 'has', 'been', 'so', 'far', 'groupos',
]);

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}₹$%\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !FILLER.has(w));

const score = (queryWords: Set<string>, text: string) => words(text).filter(w => queryWords.has(w)).length;

const cite = (ids: string[], evidenceMap: Record<string, Evidence>) => {
  const first = ids.map(id => evidenceMap[id]?.messageId).find(id => id && !id.startsWith('user_action'));
  return first ? ` [${first}]` : '';
};

export function localGroupAnswer(input: LocalAnswerInput): string {
  const { workspaceTitle, query, decisions, commitments, conflicts, evidenceMap } = input;
  const open = conflicts.filter(c => c.status === 'open');
  if (decisions.length === 0 && commitments.length === 0 && open.length === 0) {
    return `Nothing is tracked yet in "${workspaceTitle}". Run Meta AI on this chat to extract decisions and commitments, or keep chatting.`;
  }

  const q = new Set(words(query));
  type Item = { score: number; line: string };
  const items: Item[] = [
    ...decisions.map(d => ({
      score: score(q, `${d.topic} ${d.currentValue}`),
      line: `• ${d.topic}: ${d.currentValue} (${d.status})${cite(d.supportingEvidenceIds, evidenceMap)}`,
    })),
    ...commitments.map(c => ({
      score: score(q, `${c.ownerName} ${c.description}`),
      line: `• ${c.ownerName}: ${c.description} (${c.status.replace('_', ' ')})${cite(c.evidenceIds, evidenceMap)}`,
    })),
    ...open.map(c => ({
      score: score(q, `${c.topic} ${c.description}`) + 1, // open conflicts always matter
      line: `• Open conflict on ${c.topic}: ${c.description}${cite(c.evidenceIds, evidenceMap)}`,
    })),
  ];

  const relevant = items.filter(i => i.score > 0).sort((a, b) => b.score - a.score);
  if (relevant.length > 0 && relevant.some(i => i.score > 1 || q.size === 0 || !open.length)) {
    return [`From what is tracked in "${workspaceTitle}":`, ...relevant.slice(0, 5).map(i => i.line)].join('\n');
  }

  return [
    `"${workspaceTitle}" currently tracks ${decisions.length} decision${decisions.length === 1 ? '' : 's'}, ${commitments.length} commitment${commitments.length === 1 ? '' : 's'} and ${open.length} open conflict${open.length === 1 ? '' : 's'}. Nothing tracked matches your question directly; the closest items:`,
    ...items.sort((a, b) => b.score - a.score).slice(0, 4).map(i => i.line),
  ].join('\n');
}
