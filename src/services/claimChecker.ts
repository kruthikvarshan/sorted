import { Proposal, summarizeProposal } from '../engine/eventReducer';
import type { Message } from '../types/groupOs';
import { MetaApiCallResult, MetaModelService } from './metaModelService';

/**
 * A quote can exist in the chat and still not support the claim ("WiFi total: 2400" backed by a message about the
 * electricity bill). This asks the model to act as a strict fact-checker on each result, looking only at the quotes
 * cited for it. It is a second opinion, so it fails open: if it breaks, nothing is dropped.
 */

export type Verdict = 'supported' | 'unsupported' | 'unclear';
export interface ClaimCheck {
  id: number;
  verdict: Verdict;
  reason: string;
}

const describe = (p: Proposal): string => {
  if (p.kind === 'decision') {
    const split = p.split ? (p.split.perPerson ? `; each person pays ${p.split.perPerson}${p.split.currency ?? ''}` : `; total ${p.split.total}${p.split.currency ?? ''} shared`) : '';
    return `Decision "${p.topic}" is "${p.value}" (${p.status}${split})`;
  }
  if (p.kind === 'commitment') {
    const money = p.amount ? `, amount ${p.amount}${p.currency ?? ''}${p.payee ? ` to ${p.payee}` : ''}` : '';
    return `${p.ownerName} promised: ${p.description} (${p.status}${money})`;
  }
  return `Clash "${p.topic}": ${p.description}`;
};

/**
 * Each quote goes to the checker with who wrote it and the message just before it: in a chat, "paid you 800" or
 * "got it" only makes sense knowing who said it and to whom.
 */
export function buildCheckPrompt(proposals: Proposal[], messages: Message[] = []) {
  const at = new Map(messages.map((m, i) => [m.id, i]));
  const said = (messageId: string, quote: string, translation?: string) => {
    const i = at.get(messageId);
    const m = i !== undefined ? messages[i] : undefined;
    const prev = i ? messages[i - 1] : undefined;
    const text = `"${quote}"${translation ? ` (meaning: ${translation})` : ''}`;
    if (!m) return `  - ${text}`;
    return `  - ${m.speakerName} wrote ${text}${prev ? ` (just after ${prev.speakerName}: "${prev.content.slice(0, 140)}")` : ''}`;
  };
  const claims = proposals
    .map((p, id) => {
      const quotes = p.evidence.map(e => said(e.messageId, e.quote, e.translation)).join('\n');
      return `${id}. ${describe(p)}\n${quotes}`;
    })
    .join('\n\n');

  return [
    {
      role: 'system' as const,
      content: `You are a strict fact-checker. Each numbered claim comes with the exact quotes cited for it. Decide whether those quotes, read literally, SUPPORT the claim: the same subject (what it is about), the same number or value, and the same person.
- "unsupported": the quotes are about something else, the number belongs to a different item, or the claim says more than the quotes do.
- "unclear": the quotes fit but are ambiguous.
- "supported": the quotes clearly say it.
Each quote names who wrote it and the message just before it. "I", "me" and "you" mean the writer and the person they are talking to, usually the one just before. Short chat replies like "paid you 800", "sent", "bhej diya", "got it", "aa gaya", "received" do support a payment between the writer and that person.
Judge only from the quotes. Reply with JSON only: {"results":[{"id":0,"verdict":"supported|unsupported|unclear","reason":"one short sentence"}]} with one entry per claim.`,
    },
    { role: 'user' as const, content: claims },
  ];
}

export function parseChecks(raw: string, count: number): ClaimCheck[] | null {
  try {
    const cleaned = raw.replace(/```json\n?|```/g, '');
    const obj = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
    if (!Array.isArray(obj?.results)) return null;
    const out: ClaimCheck[] = obj.results
      .filter((r: any) => Number.isInteger(r?.id) && r.id >= 0 && r.id < count && ['supported', 'unsupported', 'unclear'].includes(r?.verdict))
      .map((r: any) => ({ id: r.id, verdict: r.verdict as Verdict, reason: typeof r.reason === 'string' ? r.reason : '' }));
    return out.length ? out : null;
  } catch {
    return null;
  }
}

export async function checkClaims(
  apiKey: string,
  proposals: Proposal[],
  model: string = MetaModelService.DEFAULT_MODEL,
  messages: Message[] = []
): Promise<MetaApiCallResult<ClaimCheck[] | null>> {
  try {
    const raw = await MetaModelService.callChatCompletion(apiKey, buildCheckPrompt(proposals, messages), { model, temperature: 0, max_tokens: 6000 });
    return { success: true, data: parseChecks(raw, proposals.length), modelUsed: model, timestamp: new Date().toISOString() };
  } catch (err: any) {
    return { success: false, error: err.message, modelUsed: model, timestamp: new Date().toISOString() };
  }
}

/**
 * Drop only what the checker called unsupported. If it called almost everything unsupported it is probably the
 * checker that is wrong, so nothing is dropped.
 */
export function applyChecks(proposals: Proposal[], checks: ClaimCheck[] | null) {
  if (!checks) return { kept: proposals, dropped: [] as { summary: string; reason: string }[], ignored: false };
  const unsupported = new Map(checks.filter(c => c.verdict === 'unsupported').map(c => [c.id, c.reason]));
  const distrust = unsupported.size >= Math.max(3, Math.ceil(proposals.length * 0.6));
  if (distrust) return { kept: proposals, dropped: [], ignored: true };

  const kept: Proposal[] = [];
  const dropped: { summary: string; reason: string }[] = [];
  proposals.forEach((p, id) => {
    if (unsupported.has(id)) dropped.push({ summary: summarizeProposal(p), reason: `The quotes do not support this: ${unsupported.get(id) || 'they are about something else.'}` });
    else kept.push(p);
  });
  return { kept, dropped, ignored: false };
}
