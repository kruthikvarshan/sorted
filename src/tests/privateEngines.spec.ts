import { describe, expect, it } from 'vitest';
import { groupFreshness, needsRefresh } from '../engine/freshness';
import { computeMyMoney } from '../engine/myMoney';
import { Commitment, IntelligenceRun, Message, User, Workspace } from '../types/groupOs';

const ws = (id: string, title: string): Workspace => ({ id, title, category: '', description: '', participants: [], unreadCount: 0, lastActivity: '', iconName: '' });
const msgs = (n: number): Message[] => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, conversationId: 'x', speakerId: 'u', speakerName: 'A', timestamp: '', content: 'hi', type: 'text', createdAt: i }));
const run = (messageCount?: number): IntelligenceRun => ({ id: 'r', source: 'meta', at: '10:00', workspaceId: 'x', created: 0, updated: 0, reinforced: 0, unchanged: 0, conflictsRaised: 0, changes: [], rejected: [], messageCount });

describe('how fresh each group is', () => {
  const groups = [ws('a', 'A'), ws('b', 'B'), ws('c', 'C'), ws('d', 'D'), ws('e', 'E')];
  const f = groupFreshness(groups, ['a', 'b', 'c', 'd'], { a: run(10), b: run(10), c: run(undefined) }, { a: msgs(10), b: msgs(13), c: msgs(5), d: msgs(4), e: msgs(9) });
  const by = (id: string) => f.find(x => x.workspaceId === id)!;

  it('flags never-analyzed, current, stale and unknown groups', () => {
    expect(by('a')).toMatchObject({ state: 'current', newMessages: 0 });
    expect(by('b')).toMatchObject({ state: 'stale', newMessages: 3, analyzedAt: '10:00' });
    expect(by('c').state).toBe('unknown'); // analyzed, but no message count was recorded
    expect(by('d').state).toBe('never');
  });

  it('only covers groups in scope', () => {
    expect(f.map(x => x.workspaceId)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('cannot judge staleness when the chat text is not kept, and does not pretend to', () => {
    expect(groupFreshness([ws('a', 'A')], ['a'], { a: run(10) }, { a: [] })[0].state).toBe('unknown');
  });

  it('suggests refreshing only never-analyzed and stale groups that have messages', () => {
    expect(f.filter(needsRefresh).map(x => x.workspaceId)).toEqual(['b', 'd']);
    expect(needsRefresh({ workspaceId: 'z', title: 'Z', state: 'never', messagesNow: 0, newMessages: 0 })).toBe(false);
  });
});

describe('my money across groups', () => {
  const me: User = { id: 'u_sita', name: 'Sita', avatarColor: '#000' };
  let n = 0;
  const c = (over: Partial<Commitment>): Commitment => ({
    id: `c${n++}`, conversationId: 'a', ownerId: 'u_x', ownerName: 'Kiran', description: 'd', status: 'accepted', evidenceIds: [], lastUpdatedAt: '', currency: '₹', ...over,
  });
  const groups = [ws('a', 'Araku'), ws('b', 'Flat')];
  const money = (list: Commitment[], scoped = ['a', 'b']) => computeMyMoney(groups, scoped, { a: list, b: [] }, me);

  it('separates what I owe from what I am owed, netted', () => {
    const m = money([
      c({ ownerName: 'Sita', ownerId: 'u_sita', payee: 'Anji', amount: 500 }),
      c({ ownerName: 'Anji', payee: 'Sita', amount: 200 }),
      c({ ownerName: 'Madhu', payee: 'Sita', amount: 1000 }),
    ]);
    expect(m.iOwe).toEqual([expect.objectContaining({ counterparty: 'Anji', amount: 300 })]);
    expect(m.owedToMe).toEqual([expect.objectContaining({ counterparty: 'Madhu', amount: 1000 })]);
  });

  it('lists payments waiting for me to confirm, and my own unconfirmed claims', () => {
    const m = money([
      c({ ownerName: 'Kiran', status: 'needs_clarification', payee: 'Sita', amount: 1500, verification: { state: 'receipt_consistent', reasons: [] } }),
      c({ ownerName: 'Sita', ownerId: 'u_sita', status: 'needs_clarification', payee: 'Anji', amount: 90 }),
    ]);
    expect(m.waitingOnMe).toEqual([expect.objectContaining({ counterparty: 'Kiran', amount: 1500, note: 'A receipt agrees with it' })]);
    expect(m.myClaims).toEqual([expect.objectContaining({ counterparty: 'Anji', amount: 90, note: 'No receipt, not yet confirmed' })]);
  });

  it('drops confirmed payments and payments I disputed from "waiting on me"', () => {
    expect(money([c({ status: 'needs_clarification', payee: 'Sita', verification: { state: 'confirmed', reasons: [] } })]).waitingOnMe).toEqual([]);
    expect(money([c({ status: 'needs_clarification', payee: 'Sita', verification: { state: 'disputed', reasons: [] } })]).waitingOnMe).toEqual([]);
  });

  it('ignores groups that are out of scope and other people\'s money', () => {
    expect(money([c({ payee: 'Sita', amount: 10 })], [])).toEqual({ iOwe: [], owedToMe: [], waitingOnMe: [], myClaims: [] });
    expect(money([c({ ownerName: 'Kiran', payee: 'Anji', amount: 10 })]).iOwe).toEqual([]);
  });
});
