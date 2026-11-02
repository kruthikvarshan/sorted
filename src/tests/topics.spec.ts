import { describe, expect, it } from 'vitest';
import { applyTagging, parseTaggingReply, sessionStarts, unreadBatches, topicMessages } from '../engine/topics';
import { mergeTopic, topicSlice } from '../services/groupAnalyzer';
import { Decision, GroupIntelligenceState, Message } from '../types/groupOs';

const HOUR = 3600_000;
const msg = (i: number, at: number, speakerName = 'Ravi', content = `m${i}`): Message => ({
  id: `m${i}`, conversationId: 'g', speakerId: speakerName, speakerName, timestamp: '', content, type: 'text', createdAt: at,
});

describe('sessions and batches', () => {
  it('starts a new session after a long quiet gap', () => {
    const ms = [msg(1, 0), msg(2, HOUR), msg(3, 10 * HOUR), msg(4, 11 * HOUR)];
    expect(sessionStarts(ms)).toEqual([0, 2]);
  });

  it('reads only unread messages, in batches no larger than the limit, cutting at sessions when it can', () => {
    const ms = Array.from({ length: 400 }, (_, i) => msg(i, i * 60_000 + (i >= 120 ? 10 * HOUR : 0)));
    const fromStart = unreadBatches(ms, 0, 150);
    expect(fromStart[0].at(-1)!.id).toBe('m119'); // cut at the session that starts at m120
    const later = unreadBatches(ms, 50, 150);
    expect(later.flat().length).toBe(350);
    expect(later.flat()[0].id).toBe('m50');
    expect(later.every(b => b.length <= 150)).toBe(true);
  });

  it('nothing to read when everything was read', () => {
    expect(unreadBatches([msg(1, 0)], 1)).toEqual([]);
  });
});

describe('checking the model\'s topic tags in code', () => {
  const batch = [msg(1, 1000, 'Ravi', 'Goa in Nov?'), msg(2, 2000, 'Sita', 'rent is 9000 each'), msg(3, 3000, 'Ravi', 'lol'), msg(4, 4000, 'Sita', 'ok')];

  it('creates new topics, assigns every message, and keeps chit-chat out of topics', () => {
    const r = applyTagging([], batch, {
      newTopics: [{ key: 'new1', title: 'Goa trip, Nov', kind: 'trip' }, { key: 'new2', title: 'Rent, November', kind: 'bills' }],
      assign: { m1: 'new1', m2: 'new2', m3: 'chat', m4: 'new2' },
    });
    expect(r.topics.map(t => [t.title, t.messageIds])).toEqual([['Goa trip, Nov', ['m1']], ['Rent, November', ['m2', 'm4']]]);
    expect(r.topics[1].people).toEqual(['Sita']);
    expect(r.corrections).toEqual([]);
  });

  it('sends untagged messages and tags to unknown topics to general chat, and says so', () => {
    const r = applyTagging([], batch, { newTopics: [], assign: { m1: 't_nope', m9: 'chat' } });
    expect(r.topics).toEqual([]);
    expect(r.corrections.join(' ')).toMatch(/unknown topic "t_nope"/);
    expect(r.corrections.join(' ')).toMatch(/m2 had no tag/);
    expect(r.corrections.join(' ')).toMatch(/unknown message m9/);
  });

  it('does not create a second topic with the same title; a new message reopens a closed topic', () => {
    const first = applyTagging([], batch, { newTopics: [{ key: 'new1', title: 'Goa trip, Nov', kind: 'trip' }], assign: { m1: 'new1' } });
    const closed = first.topics.map(t => ({ ...t, status: 'closed' as const }));
    const again = applyTagging(closed, [msg(5, 9000, 'Arjun', 'goa photos')], { newTopics: [{ key: 'new1', title: 'goa trip, nov' }], assign: { m5: 'new1' } });
    expect(again.topics).toHaveLength(1);
    expect(again.topics[0].status).toBe('open');
    expect(again.topics[0].messageIds).toEqual(['m1', 'm5']);
  });

  it('never closes a topic that just had a message, and drops a topic that got no messages', () => {
    const r = applyTagging([], batch, {
      newTopics: [{ key: 'new1', title: 'Rent' }, { key: 'new2', title: 'Empty one' }],
      assign: { m2: 'new1' },
      closed: ['new1'],
    });
    expect(r.topics.map(t => [t.title, t.status])).toEqual([['Rent', 'open']]);
  });

  it('parses both reply shapes, and refuses garbage', () => {
    expect(parseTaggingReply('{"assign":[["m1","t1"]]}')?.assign).toEqual({ m1: 't1' });
    expect(parseTaggingReply('```json\n{"assign":{"m1":"chat"}}\n```')?.assign).toEqual({ m1: 'chat' });
    expect(parseTaggingReply('sorry')).toBeNull();
  });

  it('lists a topic\'s messages in chat order', () => {
    const r = applyTagging([], batch, { newTopics: [{ key: 'n', title: 'Rent' }], assign: { m4: 'n', m2: 'n' } });
    expect(topicMessages(r.topics[0], batch).map(m => m.id)).toEqual(['m2', 'm4']);
  });
});

describe('each topic keeps its own results', () => {
  const d = (id: string, topicId: string): Decision => ({ id, conversationId: 'g', topic: id, currentValue: 'x', status: 'confirmed', supportingEvidenceIds: [], contradictingEvidenceIds: [], confidence: 1, lastUpdatedAt: '', updatedBy: '', history: [], topicId });
  const state: GroupIntelligenceState = { decisions: [d('a', 't1'), d('b', 't2')], commitments: [], conflicts: [], evidenceMap: {}, history: [] };

  it('a topic only sees its own decisions', () => {
    expect(topicSlice(state, 't1').decisions.map(x => x.id)).toEqual(['a']);
  });

  it('updating one topic leaves the others alone, and tags new items with the topic', () => {
    const next = mergeTopic(state, 't1', { ...topicSlice(state, 't1'), decisions: [d('a', 't1'), { ...d('c', 't1'), topicId: undefined }] });
    expect(next.decisions.map(x => `${x.id}:${x.topicId}`).sort()).toEqual(['a:t1', 'b:t2', 'c:t1']);
  });
});
