import { GroupIntelligenceState, Message, Topic } from '../types/groupOs';
import { topicMessages } from '../engine/topics';
import { MetaModelService } from './metaModelService';

/**
 * "@Sorted what did we decide about the villa?" in a long group chat. The question is matched to the topics it is
 * about first, so the model sees those topics' results and recent messages, not 2,000 lines. The answer is posted in
 * the group, so only group information is used, never anyone's private data.
 */

const words = (s: string) => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(w => !STOP.has(w)));
const STOP = new Set(['what', 'did', 'the', 'and', 'for', 'who', 'how', 'much', 'are', 'was', 'were', 'about', 'with', 'that', 'this', 'have', 'has', 'groupos', 'sorted', 'decide', 'decided', 'does', 'any']);

/** Topics most likely meant by the question, best first. Ties go to the most recently active. */
export function relevantTopics(question: string, topics: Topic[], state: GroupIntelligenceState, max = 3): Topic[] {
  const q = words(question);
  const score = (t: Topic) => {
    const text = [t.title, t.summary ?? '', ...state.decisions.filter(d => d.topicId === t.id).map(d => `${d.topic} ${d.currentValue}`)].join(' ');
    const w = words(text);
    let s = 0;
    q.forEach(x => w.has(x) && (s += 1));
    return s;
  };
  return topics
    .map(t => ({ t, s: score(t) }))
    .sort((a, b) => b.s - a.s || b.t.lastAt - a.t.lastAt)
    .filter((x, i) => x.s > 0 || i === 0)
    .slice(0, max)
    .map(x => x.t);
}

export function buildGroupQuestion(question: string, groupTitle: string, topics: Topic[], state: GroupIntelligenceState, messages: Message[], moneyLines: string[], asker?: string) {
  const picked = relevantTopics(question, topics, state);
  const blocks = picked.map(t => {
    const d = state.decisions.filter(x => x.topicId === t.id).map(x => `  - ${x.topic}: ${x.currentValue} (${x.status})`).join('\n') || '  - none';
    const c = state.commitments.filter(x => x.topicId === t.id).map(x => `  - ${x.ownerName}: ${x.description} (${x.status})`).join('\n') || '  - none';
    const k = state.conflicts.filter(x => x.topicId === t.id && x.status === 'open').map(x => `  - ${x.topic}: ${x.description}`).join('\n') || '  - none';
    const recent = topicMessages(t, messages).slice(-12).map(m => `  ${m.speakerName}: ${m.content}`).join('\n');
    return `TOPIC "${t.title}" (${t.status})${t.summary ? `: ${t.summary}` : ''}\nDecisions:\n${d}\nPromises:\n${c}\nOpen disagreements:\n${k}\nLatest messages:\n${recent}`;
  });
  const others = topics.filter(t => !picked.includes(t)).map(t => `${t.title} (${t.status})`).join(', ');
  return [
    {
      role: 'system' as const,
      content: `You are Sorted, a member of the WhatsApp group "${groupTitle}". Answer the question in 1 to 4 short lines, in the language the question is written in, like a helpful friend.
Use only the facts below. Name the topic you are answering from. If something is not decided yet or people disagree, say so plainly. Money totals in "Money" were worked out by the app: quote them exactly, never add numbers yourself. If the facts do not answer it, say you could not find it in the chat.${asker ? `\nThe question is from ${asker}: "I", "me" and "my" mean ${asker}. Answer them directly ("You owe…").` : ''}`,
    },
    {
      role: 'user' as const,
      content: `${blocks.join('\n\n')}\n\nOther topics in this group: ${others || 'none'}\n\nMoney (exact):\n${moneyLines.map(l => `- ${l}`).join('\n') || '- nothing owed'}\n\nQuestion: ${question}`,
    },
  ];
}

export async function answerGroupQuestion(
  apiKey: string,
  question: string,
  ctx: { groupTitle: string; topics: Topic[]; state: GroupIntelligenceState; messages: Message[]; moneyLines: string[]; asker?: string }
): Promise<{ text: string; ok: boolean; model: string }> {
  const model = MetaModelService.DEFAULT_MODEL;
  try {
    const text = await MetaModelService.callChatCompletion(apiKey, buildGroupQuestion(question, ctx.groupTitle, ctx.topics, ctx.state, ctx.messages, ctx.moneyLines, ctx.asker), {
      model,
      temperature: 0.2,
      max_tokens: 6000,
      reasoningEffort: 'low',
    });
    return { text: text.trim(), ok: true, model };
  } catch {
    return { text: "I couldn't reach Meta AI just now. Try again in a moment.", ok: false, model };
  }
}
