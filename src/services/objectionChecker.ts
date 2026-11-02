import { Proposal, quoteIsVerbatim } from '../engine/eventReducer';
import { Message } from '../types/groupOs';
import { MetaModelService } from './metaModelService';

/**
 * A suggested cost is not an obligation if someone turned it down, and people turn things down in every language
 * ("no way", "vaddu", "nahi yaar"). This asks the model, per suggested cost, whether anyone other than the proposer
 * objected. Every answer must quote the objecting message word for word, and that is checked in code. It fails open.
 */

type CostProposal = Extract<Proposal, { kind: 'decision' }>;

const PLAN = /\b(date|day|time|leav\w*|depart\w*|arriv\w*|book\w*|ticket|train|flight|bus|villa|hotel|stay|venue|trip|dinner|meet\w*|plan)\b/i;

/** What can be objected to: a suggested cost, or any plan or booking (a person may say they cannot make it). */
export const suggestedCosts = (proposals: Proposal[]): CostProposal[] =>
  proposals.filter(
    (p): p is CostProposal => p.kind === 'decision' && p.status !== 'rejected' && ((!!p.split && p.status !== 'confirmed') || PLAN.test(`${p.topic} ${p.value}`))
  );

export function buildObjectionPrompt(costs: CostProposal[], messages: Message[]) {
  const list = costs.map((c, id) => `${id}. "${c.topic}": ${c.value}`).join('\n');
  const chat = messages.map(m => `[${m.id}] ${m.speakerName}: ${m.content}`).join('\n');
  return [
    {
      role: 'system' as const,
      content: `You read a group chat. For each numbered item (a suggested cost, or a plan or booking), decide whether a person other than whoever proposed it objected: refused, said it is too expensive or breaks their budget, declined to pay, or said they cannot make that date or time. Messages may be in any language.
Only count a real objection to that item. If later messages settle it (the people agree on a new arrangement: "ok fine", "deal", "then you pay 4,000"), it is NOT an objection any more: leave it out. A question, a joke or enthusiasm is not one. Quote the objecting message exactly as written.
Reply with JSON only: {"results":[{"id":0,"objected":true,"messageId":"...","quote":"exact words from that message"}]}. Include only costs that were objected to.`,
    },
    { role: 'user' as const, content: `Items:\n${list}\n\nChat:\n${chat}` },
  ];
}

export function parseObjections(raw: string, costs: CostProposal[], messages: Message[]): Proposal[] {
  try {
    const cleaned = raw.replace(/```json\n?|```/g, '');
    const obj = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
    if (!Array.isArray(obj?.results)) return [];
    const byId = new Map(messages.map(m => [m.id, m]));
    const out: Proposal[] = [];
    const used = new Set<string>();
    for (const r of obj.results) {
      const cost = Number.isInteger(r?.id) ? costs[r.id] : undefined;
      const msg = typeof r?.messageId === 'string' ? byId.get(r.messageId) : undefined;
      if (!cost || !msg || r.objected !== true || typeof r.quote !== 'string' || !quoteIsVerbatim(r.quote, msg.content)) continue;
      // One message is one objection, even if the model ties it to several items.
      if (used.has(msg.id)) continue;
      used.add(msg.id);
      out.push({
        kind: 'conflict',
        topic: cost.topic,
        description: `${msg.speakerName} disagrees with "${cost.value}": "${msg.content.length > 90 ? `${msg.content.slice(0, 90)}…` : msg.content}"`,
        evidence: [{ messageId: msg.id, quote: r.quote }],
      });
    }
    return out;
  } catch {
    return [];
  }
}

export async function findObjections(apiKey: string, proposals: Proposal[], messages: Message[], model: string): Promise<Proposal[]> {
  const costs = suggestedCosts(proposals);
  if (costs.length === 0) return [];
  try {
    const raw = await MetaModelService.callChatCompletion(apiKey, buildObjectionPrompt(costs, messages), { model, temperature: 0, max_tokens: 6000 });
    return parseObjections(raw, costs, messages);
  } catch {
    return [];
  }
}
