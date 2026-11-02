import { CHAT, parseTaggingReply, TaggingReply } from '../engine/topics';
import { Message, Topic } from '../types/groupOs';
import { MetaModelService } from './metaModelService';

/**
 * Muse Spark sorts a batch of messages into topics. It sees the existing topics, the last few messages before the
 * batch (with their topics, for continuity), and the batch. It returns one tag per message, checked in code by
 * applyTagging.
 */

const SYSTEM = `You sort a WhatsApp group chat into TOPICS, message by message.

A topic is one real-world thing the group is organising, deciding or paying for: a trip, one month's rent and bills, a gift collection, an event or party, a purchase, a repair, a match or outing. Use "chat" for greetings, jokes, memes, gossip and anything not tied to a plan or money.

Rules:
- Tag EVERY message id in the batch exactly once.
- Reuse an existing topic whenever a message continues it, even a short reply like "ok", "done", "👍" or "same": look at who is replying, what they reply to, and the timing.
- Start a new topic only when a genuinely new plan, bill, event or purchase begins: something with a decision, a date, a booking, a cost, a payment or a promise. Snacks, food orders, "let's watch a movie sometime", memes and passing ideas with no time, booking or money are "chat".
- Keep topics a size people can follow. Small parts of a plan stay in that plan's topic (the gift for a wedding, the dinner on a birthday). But a big plan with separate parts discussed on different days gets one topic per part, titled with the plan first: "Goa trip: stay", "Goa trip: travel", "Goa trip: activities", "Goa trip: settling up".
- Recurring bills get one topic per month ("Rent & bills, November").
- Anything about money, a payment, a booking, a date or a promise belongs to a topic, never to "chat".
- Titles are short and specific, with a month or place when it helps ("Goa trip, Nov", "Fridge repair", "Ravi's birthday gift").
- Messages may be in English, Telugu, Hindi or a mix, often in English letters. Understand them as written.
- Mark a topic "closed" only when it is clearly finished: paid off, done, the trip is over. Never close a topic that had a message in this batch.
- Give each topic you used a one-line summary of where it stands now.

Reply with JSON only:
{"newTopics":[{"key":"new1","title":"…","kind":"trip|bills|event|purchase|plan|other","summary":"…"}],
 "assign":[["<messageId>","<topicId or new1 or chat>"]],
 "closed":["<topicId>"],
 "summaries":{"<topicId or new1>":"…"}}`;

const day = (ms: number) => new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const line = (m: Message) => `[${m.id}] ${day(m.createdAt)} ${m.speakerName}: ${m.content.replace(/\s+/g, ' ').slice(0, 400)}`;

export function buildTaggingPrompt(topics: Topic[], before: Message[], batch: Message[]) {
  const open = topics
    .slice()
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, 40)
    .map(t => `- ${t.id} | ${t.title} | ${t.kind} | ${t.status} | last ${t.lastAt ? day(t.lastAt) : '—'}${t.summary ? ` | ${t.summary}` : ''}`)
    .join('\n');
  const topicOfMsg = new Map<string, string>();
  topics.forEach(t => t.messageIds.forEach(id => topicOfMsg.set(id, t.id)));
  const context = before.map(m => `${line(m)}   ← ${topicOfMsg.get(m.id) ?? CHAT}`).join('\n');
  return [
    { role: 'system' as const, content: SYSTEM },
    {
      role: 'user' as const,
      content: `Existing topics:\n${open || '(none yet)'}\n\nJust before this batch (already tagged):\n${context || '(start of chat)'}\n\nBatch to tag (${batch.length} messages):\n${batch.map(line).join('\n')}`,
    },
  ];
}

export async function tagBatch(
  apiKey: string,
  topics: Topic[],
  before: Message[],
  batch: Message[],
  model: string = MetaModelService.DEFAULT_MODEL
): Promise<TaggingReply> {
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await MetaModelService.callChatCompletion(apiKey, buildTaggingPrompt(topics, before, batch), {
        model,
        temperature: 0,
        max_tokens: 16000,
        reasoningEffort: attempt === 0 ? 'low' : 'minimal',
      });
      const reply = parseTaggingReply(raw);
      if (reply && Object.keys(reply.assign).length > 0) return reply;
      lastError = 'the reply had no tags';
    } catch (err: any) {
      lastError = err?.message ?? String(err);
    }
  }
  throw new Error(`Topic tagging failed: ${lastError}`);
}
