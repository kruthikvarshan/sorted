import { Message, Topic, TopicKind } from '../types/groupOs';

/**
 * Long chats, thread by thread. A real group runs for months with several plans at once ("rent" and "Goa" in the same
 * hour), so every message is tagged to a topic, one by one, and each topic is then read on its own. The model proposes
 * the tags; this file checks them in code: every message gets exactly one topic, unknown ids are refused, and
 * anything the model skipped goes to general chat instead of being lost.
 */

export const CHAT = 'chat';
const KINDS: TopicKind[] = ['trip', 'bills', 'event', 'purchase', 'plan', 'other'];
/** A quiet gap this long starts a new session. */
export const SESSION_GAP_MS = 6 * 60 * 60 * 1000;
export const BATCH_SIZE = 150;

/** Indices where a new session starts (always includes 0). */
export function sessionStarts(messages: Message[], gapMs = SESSION_GAP_MS): number[] {
  const starts: number[] = messages.length ? [0] : [];
  for (let i = 1; i < messages.length; i++) {
    if (messages[i].createdAt - messages[i - 1].createdAt > gapMs) starts.push(i);
  }
  return starts;
}

/**
 * The unread messages, cut into batches of about `size`. Cuts prefer session boundaries so one conversation is not
 * split across two batches, but a batch never exceeds `size`.
 */
export function unreadBatches(messages: Message[], readThrough: number, size = BATCH_SIZE): Message[][] {
  const starts = new Set(sessionStarts(messages));
  const batches: Message[][] = [];
  let current: Message[] = [];
  for (let i = readThrough; i < messages.length; i++) {
    const atBoundary = starts.has(i) && current.length >= size * 0.6;
    if (current.length >= size || atBoundary) {
      batches.push(current);
      current = [];
    }
    current.push(messages[i]);
  }
  if (current.length) batches.push(current);
  return batches;
}

/** What the model returns for one batch. Keys are existing topic ids or "new1", "new2"…; "chat" means no topic. */
export interface TaggingReply {
  newTopics: { key: string; title: string; kind?: string; summary?: string }[];
  assign: Record<string, string>;
  closed?: string[];
  summaries?: Record<string, string>;
}

export interface TaggingResult {
  topics: Topic[];
  /** Topic id → ids of messages in this batch that belong to it. */
  touched: Map<string, string[]>;
  /** What the code had to correct, so the eval and trace can show it. */
  corrections: string[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'topic';

/** Apply one batch's tags to the topic list, checking every part of the reply. */
export function applyTagging(topics: Topic[], batch: Message[], reply: TaggingReply, now = Date.now()): TaggingResult {
  const out = topics.map(t => ({ ...t, messageIds: [...t.messageIds], people: [...t.people] }));
  const byId = new Map(out.map(t => [t.id, t]));
  const corrections: string[] = [];
  const created = new Map<string, Topic>();

  for (const n of reply.newTopics ?? []) {
    if (!n?.key || !n.title?.trim()) continue;
    // A "new" topic with the same title as an existing open one is the same topic.
    const same = out.find(t => t.title.trim().toLowerCase() === n.title.trim().toLowerCase());
    if (same) {
      created.set(n.key, same);
      corrections.push(`"${n.title}" already existed, so it was not created twice`);
      continue;
    }
    let id = `t_${slug(n.title)}`;
    while (byId.has(id)) id += '_2';
    const kind = KINDS.includes(n.kind as TopicKind) ? (n.kind as TopicKind) : 'other';
    const topic: Topic = { id, title: n.title.trim().slice(0, 60), kind, status: 'open', messageIds: [], people: [], firstAt: now, lastAt: 0, summary: n.summary?.slice(0, 200) };
    out.push(topic);
    byId.set(id, topic);
    created.set(n.key, topic);
  }

  const touched = new Map<string, string[]>();
  const batchIds = new Set(batch.map(m => m.id));
  for (const key of Object.keys(reply.assign ?? {})) if (!batchIds.has(key)) corrections.push(`ignored a tag for unknown message ${key}`);

  for (const m of batch) {
    const key = reply.assign?.[m.id];
    const topic = key === undefined || key === CHAT ? undefined : byId.get(key) ?? created.get(key);
    if (key === undefined) corrections.push(`message ${m.id} had no tag, so it went to general chat`);
    else if (key !== CHAT && !topic) corrections.push(`message ${m.id} was tagged to unknown topic "${key}", so it went to general chat`);
    if (!topic) continue;
    if (!topic.messageIds.includes(m.id)) topic.messageIds.push(m.id);
    if (!topic.people.includes(m.speakerName)) topic.people.push(m.speakerName);
    topic.firstAt = Math.min(topic.firstAt || m.createdAt, m.createdAt);
    topic.lastAt = Math.max(topic.lastAt, m.createdAt);
    // Talking about a topic again reopens it.
    topic.status = 'open';
    touched.set(topic.id, [...(touched.get(topic.id) ?? []), m.id]);
  }

  for (const id of reply.closed ?? []) {
    const t = byId.get(id) ?? created.get(id);
    if (t && !touched.has(t.id)) t.status = 'closed';
  }
  for (const [key, summary] of Object.entries(reply.summaries ?? {})) {
    const t = byId.get(key) ?? created.get(key);
    if (t && summary) t.summary = summary.slice(0, 200);
  }

  // A topic that ended up with no messages (the model announced it but never used it) is dropped.
  return { topics: out.filter(t => t.messageIds.length > 0), touched, corrections };
}

/** Parse the model's JSON. Accepts {"assign":{id:key}} or {"assign":[[id,key],...]}. */
export function parseTaggingReply(raw: string): TaggingReply | null {
  try {
    const cleaned = raw.replace(/```json\n?|```/g, '');
    const obj = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
    const assign: Record<string, string> = {};
    if (Array.isArray(obj.assign)) obj.assign.forEach((p: unknown) => Array.isArray(p) && p.length >= 2 && (assign[String(p[0])] = String(p[1])));
    else if (obj.assign && typeof obj.assign === 'object') Object.entries(obj.assign).forEach(([k, v]) => (assign[k] = String(v)));
    return {
      newTopics: Array.isArray(obj.newTopics) ? obj.newTopics : [],
      assign,
      closed: Array.isArray(obj.closed) ? obj.closed.map(String) : [],
      summaries: obj.summaries && typeof obj.summaries === 'object' ? obj.summaries : {},
    };
  } catch {
    return null;
  }
}

/** The messages of one topic, in chat order. */
export const topicMessages = (topic: Topic, messages: Message[]) => {
  const ids = new Set(topic.messageIds);
  return messages.filter(m => ids.has(m.id));
};

/** Which topic a message was tagged to. */
export const topicOf = (topics: Topic[], messageId: string) => topics.find(t => t.messageIds.includes(messageId));
