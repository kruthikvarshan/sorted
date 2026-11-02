import { Message } from '../types/groupOs';
import { EvidenceRef, Proposal } from './eventReducer';

/**
 * Offline, model-free fallback. Deliberately conservative: it only reads surface patterns,
 * gives every decision its own topic (so it can never invent a conflict between unrelated
 * messages), and its output is labelled "local heuristic" wherever it is shown.
 */

const MONEY = /(?:₹|rs\.?\s?|inr\s?|\$)\s?\d[\d,]*(?:\.\d+)?\s?k?|\b\d[\d,]*\s?k\b(?=\s|$|[.,!?])/i;
const DAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|tonight)\b/i;
const AGREED = /\b(agreed|confirmed|locked|booked|finali[sz]ed|sounds good|deal|it's official|done)\b/i;
const COMMIT = /\b(i will|i'll|i am going to|i'm going to|i took responsibility|i can take|i'll handle|i got this)\b/i;
const DONE = /\b(done|booked|paid|sent|transferred|completed)\b/i;
const CONSTRAINT = /\b(cannot|can't|can not|impossible|denied|won't be able|conflict|clash)\b/i;

const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1).trim()}…` : text);

export function heuristicProposals(messages: Message[]): Proposal[] {
  const proposals: Proposal[] = [];

  for (const m of messages) {
    if (m.type === 'system') continue;
    const text = m.content.trim();
    if (text.length < 12) continue;
    const evidence: EvidenceRef[] = [{ messageId: m.id, quote: text }];
    const money = text.match(MONEY)?.[0]?.trim();
    const day = text.match(DAY)?.[0];
    const agreed = AGREED.test(text);

    if (CONSTRAINT.test(text)) {
      proposals.push({ kind: 'conflict', topic: `Constraint raised by ${m.speakerName}`, description: clip(text, 200), evidence });
    }

    if (COMMIT.test(text)) {
      proposals.push({
        kind: 'commitment',
        ownerName: m.speakerName,
        description: clip(text, 160),
        status: DONE.test(text) ? 'completed' : 'accepted',
        evidence,
      });
    }

    if (money || day) {
      proposals.push({
        kind: 'decision',
        topic: money ? `Cost ${money}` : `Plan ${day}`,
        value: clip(text),
        status: agreed ? 'confirmed' : 'proposed',
        reason: 'Pattern match (no model): amount or day mentioned' + (agreed ? ' with an agreement phrase.' : '.'),
        evidence,
      });
    }
  }

  return proposals;
}
