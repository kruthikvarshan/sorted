import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../types/groupOs';

// Every message goes to one topic; extraction records nothing. The test checks WHICH messages get read.
vi.mock('../services/topicTagger', () => ({
  tagBatch: vi.fn(async (_k: string, topics: { id: string }[], _b: unknown, batch: { id: string }[]) => ({
    newTopics: topics.length ? [] : [{ key: 'n1', title: 'Goa trip', kind: 'trip' }],
    assign: Object.fromEntries(batch.map(m => [m.id, topics[0]?.id ?? 'n1'])),
  })),
}));
const seen: string[][] = [];
let sweepReply: ((transcript: Message[]) => any[]) | undefined;
vi.mock('../services/metaToolPipeline', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/metaToolPipeline')>()),
  extractWithMeta: vi.fn(async (_k: string, transcript: Message[]) => {
    seen.push(transcript.map(m => m.id));
    return { proposals: sweepReply?.(transcript) ?? [], rejected: [], rounds: 1, mode: 'tools', model: 'm', tokens: { prompt: 1, completion: 1 } };
  }),
}));

const { analyzeGroup } = await import('../services/groupAnalyzer');
const msg = (i: number): Message => ({ id: `m${i}`, conversationId: 'g', speakerId: 'a', speakerName: 'A', timestamp: '', content: `message ${i}`, type: 'text', createdAt: i * 60_000 });

describe('reading a big topic', () => {
  it('reads every message of a 300-message topic, in order, a window at a time (not just the last 250)', async () => {
    seen.length = 0;
    const messages = Array.from({ length: 300 }, (_, i) => msg(i + 1));
    const { state } = await analyzeGroup(messages, undefined, { apiKey: 'k', groupId: 'g', verifyClaims: false });
    const read = new Set(seen.flat());
    expect(messages.every(m => read.has(m.id))).toBe(true);
    expect(seen).toHaveLength(3);
    expect(seen[1][0]).toBe('m106'); // each window starts with 15 messages of context
    expect(state.readThrough).toBe(300);
  });

  it('later, reads only the new messages (plus a little context), not the whole topic again', async () => {
    const messages = Array.from({ length: 300 }, (_, i) => msg(i + 1));
    const first = await analyzeGroup(messages, undefined, { apiKey: 'k', groupId: 'g', verifyClaims: false });
    seen.length = 0;
    const more = [...messages, ...Array.from({ length: 10 }, (_, i) => msg(301 + i))];
    await analyzeGroup(more, first.state, { apiKey: 'k', groupId: 'g', verifyClaims: false });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(25);
    expect(seen[0][0]).toBe('m286');
    expect(seen[0].at(-1)).toBe('m310');
  });
});

describe('payment sweep', () => {
  it('gives a payment message nothing was recorded from a second, focused look, and records what it finds', async () => {
    seen.length = 0;
    const chat = Array.from({ length: 40 }, (_, i) => msg(i + 1));
    chat[19] = { ...chat[19], speakerName: 'Swapnil', content: '10,000 bheja Aniket ko' };
    chat[20] = { ...chat[20], speakerName: 'Aniket', content: 'haan aagaya 10000 mila' };
    let calls = 0;
    sweepReply = transcript => {
      calls++;
      // The first, full reading misses it; the sweep finds it.
      if (calls === 1) return [];
      expect(transcript.map(m => m.id)).toContain('m20');
      expect(transcript.length).toBeLessThan(15);
      return [{ kind: 'commitment', ownerName: 'Swapnil', payee: 'Aniket', amount: 10000, description: 'Repay 10000 to Aniket', status: 'completed', receivedConfirmed: true, evidence: [{ messageId: 'm21', quote: 'haan aagaya 10000 mila' }] }];
    };
    const { state, report } = await analyzeGroup(chat, undefined, { apiKey: 'k', groupId: 'g', verifyClaims: false });
    sweepReply = undefined;
    expect(report.failedTopics).toEqual([]);
    expect(report.paymentsSwept).toBe(2);
    expect(state.commitments.find(c => c.payee === 'Aniket')?.amount).toBe(10000);
  });
});
