import { applyProposals, confirmFromReplies } from '../engine/eventReducer';
import { applyTagging, topicMessages, unreadBatches } from '../engine/topics';
import { GroupIntelligenceState, Message, Topic } from '../types/groupOs';
import { extractWithMeta, HAS_AMOUNT, MONEY_MOVED } from './metaToolPipeline';
import { tagBatch } from './topicTagger';

/**
 * Reading a group the way it really is: long, with several threads at once.
 *  1. Only messages not read before are looked at (state.readThrough).
 *  2. They are tagged to topics in batches (Muse Spark), checked in code.
 *  3. Each topic that got new messages is analysed on its own: that topic's messages and that topic's results only,
 *     so the input stays short and money stays with its topic.
 *  4. Payment sweep: any new message that says money moved ("10,000 bheja Aniket ko", "haan aagaya") with no payment
 *     recorded from it gets one more, focused look with the messages around it. A missed payment would leave someone
 *     owing money they already paid, so these are not left to one pass.
 * The same function runs in the browser, on the WhatsApp server and in the live rooms.
 */

export interface AnalyzeProgress {
  stage: 'tagging' | 'analysing' | 'done';
  done: number;
  total: number;
  label?: string;
}

export interface AnalyzeReport {
  newMessages: number;
  batches: number;
  topicsCreated: string[];
  topicsUpdated: string[];
  corrections: string[];
  tokens: number;
  calls: number;
  failedTopics: { title: string; error: string }[];
  /** Payment messages that got the sweep's second look. */
  paymentsSwept?: number;
  ms: number;
}

export interface AnalyzeOptions {
  apiKey: string;
  groupId: string;
  model?: string;
  verifyClaims?: boolean;
  /** Topics analysed at the same time. */
  concurrency?: number;
  /** A topic's new messages are read in windows of this many, in order, each building on the results so far. */
  windowSize?: number;
  onProgress?: (p: AnalyzeProgress) => void;
  /** Called with the results so far: after the topics are known, and after each topic is read (for live progress). */
  onPartial?: (state: GroupIntelligenceState) => void;
  now?: () => string;
}

/** Payments looked at together in one sweep call. */
const SWEEP_BATCH = 8;

const EMPTY: GroupIntelligenceState = { decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [] };

/** The part of the group's results that belongs to one topic. */
export function topicSlice(state: GroupIntelligenceState, topicId: string): GroupIntelligenceState {
  return {
    decisions: state.decisions.filter(d => d.topicId === topicId),
    commitments: state.commitments.filter(c => c.topicId === topicId),
    conflicts: state.conflicts.filter(c => c.topicId === topicId),
    evidenceMap: state.evidenceMap,
    history: [],
  };
}

/** Put a topic's updated results back into the group's results. */
export function mergeTopic(state: GroupIntelligenceState, topicId: string, slice: GroupIntelligenceState): GroupIntelligenceState {
  const tag = <T extends { topicId?: string }>(x: T): T => ({ ...x, topicId });
  return {
    ...state,
    decisions: [...state.decisions.filter(d => d.topicId !== topicId), ...slice.decisions.map(tag)],
    commitments: [...state.commitments.filter(c => c.topicId !== topicId), ...slice.commitments.map(tag)],
    conflicts: [...state.conflicts.filter(c => c.topicId !== topicId), ...slice.conflicts.map(tag)],
    evidenceMap: { ...state.evidenceMap, ...slice.evidenceMap },
  };
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await run(queue.shift()!);
  }));
}

export async function analyzeGroup(messages: Message[], start: GroupIntelligenceState | undefined, opts: AnalyzeOptions): Promise<{ state: GroupIntelligenceState; report: AnalyzeReport }> {
  const began = Date.now();
  let state: GroupIntelligenceState = { ...EMPTY, ...start, topics: start?.topics ?? [], readThrough: Math.min(start?.readThrough ?? 0, messages.length) };
  const report: AnalyzeReport = { newMessages: messages.length - state.readThrough!, batches: 0, topicsCreated: [], topicsUpdated: [], corrections: [], tokens: 0, calls: 0, failedTopics: [], ms: 0 };

  // 1 + 2: tag the unread messages, batch by batch (each batch sees the topics the previous one made).
  const batches = unreadBatches(messages, state.readThrough!);
  report.batches = batches.length;
  const touched = new Set<string>();
  // Which messages are new in each topic: those are what each topic's reading must cover, all of them.
  const fresh = new Map<string, Set<string>>();
  const known = new Set((state.topics ?? []).map(t => t.id));
  for (let i = 0; i < batches.length; i++) {
    opts.onProgress?.({ stage: 'tagging', done: i, total: batches.length });
    if (i > 0) opts.onPartial?.(state);
    const batch = batches[i];
    const firstIndex = messages.indexOf(batch[0]);
    const before = messages.slice(Math.max(0, firstIndex - 15), firstIndex);
    const reply = await tagBatch(opts.apiKey, state.topics!, before, batch, opts.model);
    report.calls++;
    const result = applyTagging(state.topics!, batch, reply, batch[0].createdAt);
    report.corrections.push(...result.corrections);
    result.touched.forEach((ids, id) => {
      touched.add(id);
      const set = fresh.get(id) ?? new Set<string>();
      ids.forEach(x => set.add(x));
      fresh.set(id, set);
    });
    // Progress is saved batch by batch, so a failure later does not lose what was read.
    state = { ...state, topics: result.topics, readThrough: firstIndex + batch.length };
  }

  opts.onPartial?.(state);

  // 3: analyse each topic that got new messages, on its own.
  const topics = (state.topics ?? []).filter(t => touched.has(t.id));
  report.topicsCreated = topics.filter(t => !known.has(t.id)).map(t => t.title);
  report.topicsUpdated = topics.filter(t => known.has(t.id)).map(t => t.title);
  let done = 0;
  await pool(topics, opts.concurrency ?? 4, async (topic: Topic) => {
    opts.onProgress?.({ stage: 'analysing', done, total: topics.length, label: topic.title });
    const all = topicMessages(topic, messages);
    const isNew = fresh.get(topic.id) ?? new Set<string>();
    const first = Math.max(0, all.findIndex(m => isNew.has(m.id)));
    const size = opts.windowSize ?? 120;
    const CONTEXT = 15;
    let slice = topicSlice(state, topic.id);
    try {
      // Every new message of the topic is read, in order, a window at a time; each window sees the results so far
      // and a few earlier messages for context, so a 900-message topic is read in full, not just its end.
      for (let start = first; start < all.length; start += size) {
        const transcript = all.slice(Math.max(0, start - CONTEXT), start + size);
        const res = await extractWithMeta(
          opts.apiKey,
          transcript,
          slice.decisions.map(d => ({ topic: d.topic, currentValue: d.currentValue, status: d.status })),
          {
            model: opts.model,
            verifyClaims: opts.verifyClaims ?? true,
            state: slice,
            existingCommitments: slice.commitments.map(c => ({ ownerName: c.ownerName, description: c.description, status: c.status })),
          }
        );
        report.calls += 1 + (res.checked ? 1 : 0);
        report.tokens += res.tokens.prompt + res.tokens.completion;
        slice = applyProposals(slice, res.proposals, {
          conversationId: opts.groupId,
          messages: transcript,
          actor: 'model',
          actorLabel: 'Meta AI',
          now: opts.now?.() ?? new Date().toLocaleString(),
        }).state;
        // Results appear window by window, not only when the whole topic is done.
        state = mergeTopic(state, topic.id, slice);
        opts.onPartial?.(state);
      }

      // 4: the payment sweep, a few payments at a time, each with the messages just before and after it.
      const backed = new Set(slice.commitments.flatMap(c => c.evidenceIds.map(id => slice.evidenceMap[id]?.messageId)));
      const missed = all.filter(m => isNew.has(m.id) && m.speakerId !== 'groupos' && HAS_AMOUNT.test(m.content) && MONEY_MOVED.test(m.content) && !backed.has(m.id));
      for (let i = 0; i < missed.length; i += SWEEP_BATCH) {
        const around = new Set<number>();
        for (const m of missed.slice(i, i + SWEEP_BATCH)) {
          const at = all.indexOf(m);
          for (let j = Math.max(0, at - 6); j <= Math.min(all.length - 1, at + 3); j++) around.add(j);
        }
        const transcript = [...around].sort((a, b) => a - b).map(j => all[j]);
        const res = await extractWithMeta(
          opts.apiKey,
          transcript,
          slice.decisions.map(d => ({ topic: d.topic, currentValue: d.currentValue, status: d.status })),
          {
            model: opts.model,
            verifyClaims: opts.verifyClaims ?? true,
            state: slice,
            existingCommitments: slice.commitments.map(c => ({ ownerName: c.ownerName, description: c.description, status: c.status })),
          }
        );
        report.calls += 1 + (res.checked ? 1 : 0);
        report.tokens += res.tokens.prompt + res.tokens.completion;
        report.paymentsSwept = (report.paymentsSwept ?? 0) + Math.min(SWEEP_BATCH, missed.length - i);
        slice = applyProposals(slice, res.proposals, { conversationId: opts.groupId, messages: transcript, actor: 'model', actorLabel: 'Meta AI', now: opts.now?.() ?? new Date().toLocaleString() }).state;
        state = mergeTopic(state, topic.id, slice);
      }
      // A payment the receiver said they got (in the next few messages, in any topic) is confirmed, in code.
      slice = confirmFromReplies(slice, messages);
      state = mergeTopic(state, topic.id, slice);
      opts.onPartial?.(state);
    } catch (err: any) {
      report.failedTopics.push({ title: topic.title, error: err?.message ?? String(err) });
    }
    done++;
  });

  opts.onProgress?.({ stage: 'done', done: topics.length, total: topics.length });
  report.ms = Date.now() - began;
  return { state, report };
}
