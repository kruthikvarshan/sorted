import { MetaApiCallResult, MetaModelService } from './metaModelService';

/**
 * The draft-and-approve agent: Muse writes a message about ONE conflict, using only the evidence it is given.
 * It never posts anything. A person reads, edits and approves it first, and any figure in the draft that is not
 * in the conflict details is flagged so an invented amount or date cannot slip through.
 */

export interface DraftContext {
  groupTitle: string;
  senderName: string;
  conflict: { topic: string; description: string; incumbentValue?: string; challengerValue?: string };
  evidence: { speaker: string; quote: string; translation?: string }[];
  relatedDecisions: { topic: string; currentValue: string; status: string }[];
}

export interface Draft {
  text: string;
  /** Figures that appear in the draft but nowhere in the conflict details. */
  ungroundedFigures: string[];
}

export function buildDraftPrompt(ctx: DraftContext) {
  const options =
    ctx.conflict.incumbentValue && ctx.conflict.challengerValue
      ? `Option A (keep the plan): ${ctx.conflict.incumbentValue}\nOption B (change it): ${ctx.conflict.challengerValue}`
      : 'There is no ready-made pair of options: describe the clash and ask how the group wants to handle it.';
  const quotes = ctx.evidence
    .map(e => `- ${e.speaker}: "${e.quote}"${e.translation ? ` (meaning: ${e.translation})` : ''}`)
    .join('\n');
  const decisions = ctx.relatedDecisions.map(d => `- ${d.topic}: ${d.currentValue} (${d.status})`).join('\n') || '- none';

  return [
    {
      role: 'system' as const,
      content: `You write a short message that ${ctx.senderName} can post in the group chat "${ctx.groupTitle}" to settle one conflict.
Rules:
- Use ONLY the facts below. Never invent an amount, date, time, price, name or deadline. If something is unknown, say so or ask.
- Be friendly and brief: 3 to 5 sentences. Do not decide for the group; lay out the options and ask for a reply.
- Write in the language and style the group uses in the quotes (for example Telugu or Hindi typed in English letters mixed with English). If the quotes are plain English, write plain English.
- Refer to people by the names given. Do not quote anyone at length.
- Reply with the message text only, no preface, no explanation.`,
    },
    {
      role: 'user' as const,
      content: `Conflict: ${ctx.conflict.topic}
What clashes: ${ctx.conflict.description}
${options}

What people said:
${quotes || '- (no quotes available)'}

Related decisions:
${decisions}`,
    },
  ];
}

const FIGURE = /[₹$€£]?\s?\d[\d,]*(?:\.\d+)?/g;
const digitsOf = (figure: string) => figure.replace(/[^\d.]/g, '');

/** Numbers of two or more digits in the draft that do not appear anywhere in the details it was given. */
export function findUngroundedFigures(draft: string, ctx: DraftContext): string[] {
  const known = new Set((JSON.stringify(ctx).match(FIGURE) || []).map(digitsOf));
  const found = (draft.match(FIGURE) || []).map(f => f.trim()).filter(f => digitsOf(f).replace('.', '').length >= 2);
  return Array.from(new Set(found.filter(f => !known.has(digitsOf(f)))));
}

export async function draftConflictMessage(
  apiKey: string,
  ctx: DraftContext,
  model: string = MetaModelService.DEFAULT_MODEL
): Promise<MetaApiCallResult<Draft>> {
  try {
    const raw = await MetaModelService.callChatCompletion(apiKey, buildDraftPrompt(ctx), { model, temperature: 0.4 });
    const text = raw.trim().replace(/^["']|["']$/g, '');
    return {
      success: true,
      data: { text, ungroundedFigures: findUngroundedFigures(text, ctx) },
      modelUsed: model,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    return { success: false, error: err.message, modelUsed: model, timestamp: new Date().toISOString() };
  }
}
