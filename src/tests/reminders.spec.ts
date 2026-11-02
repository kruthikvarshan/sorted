import { describe, expect, it } from 'vitest';
import { computeReminders, reconcileReminderNotifications } from '../engine/reminders';
import { Commitment, InAppNotification, User, Workspace } from '../types/groupOs';

const ws = (id: string, title: string): Workspace => ({ id, title, category: '', description: '', participants: [], unreadCount: 0, lastActivity: '', iconName: '' });
const sita: User = { id: 'u_sita', name: 'Sita', avatarColor: '#000' };
const kiran: User = { id: 'u_kiran', name: 'Kiran', avatarColor: '#000' };
let n = 0;
const c = (over: Partial<Commitment>): Commitment => ({
  id: `c${n++}`, conversationId: 'a', ownerId: 'u_kiran', ownerName: 'Kiran', description: 'Book the tickets', status: 'accepted',
  evidenceIds: ['e1'], lastUpdatedAt: '', ...over,
});
const base = (commitments: Commitment[], user: User, scopedIds = ['a']) => ({
  workspaces: [ws('a', 'Araku'), ws('b', 'Flat')],
  scopedIds,
  commitmentsByWs: { a: commitments, b: [] },
  evidenceByWs: { a: { e1: { id: 'e1', messageId: 'm_1', quote: 'q', sourceType: 'message' as const, verificationStatus: 'supported' as const, explanation: '' } }, b: {} },
  user,
});

describe('computing reminders from real state', () => {
  it('reminds a person of their own open commitments, with the due text and a link to the message', () => {
    const r = computeReminders(base([c({ dueAt: 'Friday' })], kiran));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: 'You committed to this', message: 'Book the tickets (due Friday)', evidenceMessageId: 'm_1', workspaceTitle: 'Araku' });
  });

  it('labels a tentative promise as tentative', () => {
    expect(computeReminders(base([c({ status: 'proposed' })], kiran))[0].title).toBe('A tentative promise of yours');
  });

  it('ignores finished, cancelled, other people\'s and out-of-scope commitments', () => {
    const list = [c({ status: 'completed' }), c({ status: 'cancelled' }), c({ ownerName: 'Anji', ownerId: 'u_anji' })];
    expect(computeReminders(base(list, kiran))).toEqual([]);
    expect(computeReminders(base([c({})], kiran, []))).toEqual([]);
  });

  it('tells a recipient someone says they paid them, until they confirm or dispute', () => {
    const claim = c({ status: 'needs_clarification', payee: 'Sita', amount: 1500, currency: '₹', description: 'Paid Sita 1500' });
    const r = computeReminders(base([claim], sita));
    expect(r).toHaveLength(1);
    expect(r[0].title).toBe('Someone says they paid you');
    expect(r[0].message).toMatch(/Kiran says they paid you ₹1,500/);
    expect(computeReminders(base([claim], kiran))).toEqual([]); // the payer is not asked to confirm their own payment
    expect(computeReminders(base([{ ...claim, verification: { state: 'confirmed', reasons: [] } }], sita))).toEqual([]);
    expect(computeReminders(base([{ ...claim, verification: { state: 'disputed', reasons: [] } }], sita))).toEqual([]);
  });

  it('mentions a matching receipt when there is one', () => {
    const claim = c({ status: 'needs_clarification', payee: 'Sita', verification: { state: 'receipt_consistent', reasons: [] } });
    expect(computeReminders(base([claim], sita))[0].message).toMatch(/A receipt agrees with it/);
  });
});

describe('reconciling reminder notifications', () => {
  const nowLabel = '10:00';
  const wanted = computeReminders(base([c({ id: 'x1', dueAt: 'Friday' } as Partial<Commitment>), c({ id: 'x2', description: 'Pay Sita' })], kiran));

  it('adds each reminder once: a second check with nothing new adds nothing', () => {
    const first = reconcileReminderNotifications([], wanted, 'u_kiran', nowLabel);
    expect(first.added).toBe(2);
    const second = reconcileReminderNotifications(first.notifications, wanted, 'u_kiran', '10:05');
    expect(second).toMatchObject({ added: 0, removed: 0 });
    expect(second.notifications).toHaveLength(2);
  });

  it('keeps a reminder\'s read state and original time when checked again', () => {
    const first = reconcileReminderNotifications([], wanted, 'u_kiran', nowLabel).notifications;
    first[0].isRead = true;
    const again = reconcileReminderNotifications(first, wanted, 'u_kiran', '11:00');
    expect(again.notifications.find(x => x.id === first[0].id)).toMatchObject({ isRead: true, createdAt: nowLabel });
  });

  it('clears a reminder when its item is resolved, and adds one when something new appears', () => {
    const first = reconcileReminderNotifications([], wanted, 'u_kiran', nowLabel).notifications;
    const done = computeReminders(base([c({ id: 'x1', status: 'completed' } as Partial<Commitment>), c({ id: 'x2', description: 'Pay Sita' }), c({ id: 'x3', description: 'New promise' })], kiran));
    const next = reconcileReminderNotifications(first, done, 'u_kiran', '12:00');
    expect(next.removed).toBe(1);
    expect(next.added).toBe(1);
  });

  it('never touches notifications that are not reminders', () => {
    const other: InAppNotification = { id: 'notif_run_1', userId: 'u_kiran', conversationId: 'a', conversationName: 'Araku', title: 'Run finished', message: 'm', type: 'decision_change', createdAt: '9:00', isRead: false };
    const out = reconcileReminderNotifications([other], [], 'u_kiran', nowLabel);
    expect(out.notifications).toEqual([other]);
  });

  it('adds nothing and removes nothing when nothing is open', () => {
    expect(reconcileReminderNotifications([], [], 'u_kiran', nowLabel)).toMatchObject({ notifications: [], added: 0, removed: 0 });
  });
});

describe('reminders about shares', () => {
  const split = { perPerson: 9000, currency: '₹', among: 'everyone' as const, collector: 'Aman' };
  const rent = (over: object = {}) => ({
    id: 'd1', conversationId: 'a', topic: 'Rent share per person', currentValue: '9000 each', status: 'confirmed' as const,
    supportingEvidenceIds: [], contradictingEvidenceIds: [], confidence: 0.9, lastUpdatedAt: '', updatedBy: '', history: [], split, ...over,
  });
  const flatWs = { ...ws('a', 'Flat 7B'), participants: [kiran, sita, { id: 'u_aman', name: 'Aman', avatarColor: '#000' }] };
  const input = (user: User, decisions = [rent()], commitments: Commitment[] = []) => ({
    workspaces: [flatWs], scopedIds: ['a'], commitmentsByWs: { a: commitments }, decisionsByWs: { a: decisions }, evidenceByWs: { a: {} }, user,
  });

  it('reminds a member of the share they have not paid, naming who to pay', () => {
    const r = computeReminders(input(sita));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ title: 'You owe your share' });
    expect(r[0].message).toBe('Rent share per person: ₹9,000 in Flat 7B, to Aman. Not paid yet.');
  });

  it('stops reminding once they say they paid (it then waits on the collector)', () => {
    const claim = c({ ownerName: 'Sita', ownerId: 'u_sita', status: 'needs_clarification', shareOfDecisionId: 'd1', conversationId: 'a' });
    expect(computeReminders(input(sita, [rent()], [claim]))).toEqual([]);
  });

  it('also reminds about a split that is only suggested, and not one the group rejected', () => {
    expect(computeReminders(input(sita, [rent({ status: 'proposed' })]))).toHaveLength(1);
    expect(computeReminders(input(sita, [rent({ status: 'rejected' })]))).toEqual([]);
  });

  it('tells the person collecting who has not paid yet, and the reminder changes as people pay', () => {
    const aman: User = { id: 'u_aman', name: 'Aman', avatarColor: '#000' };
    const first = computeReminders(input(aman));
    expect(first[0]).toMatchObject({ title: 'Money you are collecting' });
    expect(first[0].message).toMatch(/Kiran, Sita have not paid ₹9,000 yet/);
    const paid = c({ ownerName: 'Kiran', status: 'completed', shareOfDecisionId: 'd1', conversationId: 'a' });
    const second = computeReminders(input(aman, [rent()], [paid]));
    expect(second[0].message).toMatch(/Sita has not paid ₹9,000 yet/);
    expect(second[0].id).not.toBe(first[0].id); // a new reminder, so it is not hidden by a ticked old one
  });

  it('says nothing to a collector when everyone has paid', () => {
    const aman: User = { id: 'u_aman', name: 'Aman', avatarColor: '#000' };
    const all = [c({ ownerName: 'Kiran', status: 'completed', shareOfDecisionId: 'd1', conversationId: 'a' }), c({ ownerName: 'Sita', status: 'completed', shareOfDecisionId: 'd1', conversationId: 'a' })];
    expect(computeReminders(input(aman, [rent()], all))).toEqual([]);
  });
});
