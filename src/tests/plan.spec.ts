import { describe, expect, it } from 'vitest';
import { computeGroupPlan, computeMyPlan, isScheduleDecision, whenKey } from '../engine/plan';
import { computeGroupLedger } from '../engine/settle';
import { parseObjections, suggestedCosts } from '../services/objectionChecker';
import { Commitment, Decision, Message, User, Workspace } from '../types/groupOs';
import { Proposal } from '../engine/eventReducer';

const person = (name: string): User => ({ id: `u_${name.toLowerCase()}`, name, avatarColor: '#000' });
const ws = (id: string, title: string, names: string[]): Workspace => ({ id, title, category: '', description: '', participants: names.map(person), unreadCount: 0, lastActivity: '', iconName: '' });
const trip = ws('trip', 'Goa Trip', ['Alex', 'Priya', 'Rohan']);
const other = ws('flat', 'Flat', ['Priya', 'Zed']);

let n = 0;
const decision = (topic: string, value: string, over: Partial<Decision> = {}): Decision => ({
  id: `d${n++}`, conversationId: 'trip', topic, currentValue: value, status: 'confirmed', supportingEvidenceIds: [], contradictingEvidenceIds: [],
  confidence: 0.9, lastUpdatedAt: '', updatedBy: 'Alex', history: [], ...over,
});
const planOf = (w: Workspace, decisions: Decision[], commitments: Commitment[] = []) => computeGroupPlan(w, decisions, commitments, {}, computeGroupLedger(w, decisions, commitments));

describe('schedule', () => {
  it('recognises schedule decisions and puts them in time order', () => {
    expect(isScheduleDecision(decision('Departure', 'Friday 8 PM'))).toBe(true);
    expect(isScheduleDecision(decision('Trip budget', 'enough'))).toBe(false);
    expect(isScheduleDecision(decision('Scooty rental cost', '₹400/day'))).toBe(false);
    expect(isScheduleDecision(decision('Villa cost', 'Nov 7, 2 PM check-in'))).toBe(true);
    const plan = planOf(trip, [decision('Check-out', 'Nov 10, 11 AM'), decision('Departure', 'Friday 8 PM'), decision('Check-in', 'Nov 7, 2 PM')]);
    expect(plan.fixed.map(i => i.title)).toEqual(['Departure', 'Check-in', 'Check-out']);
  });

  it('keeps suggested, disputed and put-off items out of the fixed list, with the reason', () => {
    const plan = planOf(trip, [
      decision('Departure', 'Friday', { status: 'proposed' }),
      decision('Return train', 'Sunday', { status: 'conflicted' }),
      decision('Dinner time', '9 PM', { status: 'unresolved' }),
      decision('Check-in', 'Nov 7', { status: 'rejected' }),
    ]);
    expect(plan.fixed).toEqual([]);
    expect(plan.tentative.map(i => i.note)).toEqual(['suggested, not agreed yet', 'the group disagrees about it', 'put off for later']);
  });

  it('lists commitments that have a due time and are not finished', () => {
    const c = (over: Partial<Commitment>): Commitment => ({ id: `c${n++}`, conversationId: 'trip', ownerId: '', ownerName: 'Priya', description: 'Book the cab', status: 'accepted', evidenceIds: [], lastUpdatedAt: '', dueAt: 'Thursday', ...over });
    const plan = planOf(trip, [], [c({}), c({ status: 'completed' }), c({ dueAt: undefined })]);
    expect(plan.due).toHaveLength(1);
  });

  it('orders by date, then weekday, then time of day', () => {
    expect(whenKey('Nov 7 2 PM', 0)).toBeLessThan(whenKey('Nov 10', 0));
    expect(whenKey('Saturday', 0)).toBeLessThan(whenKey('Nov 7', 0));
    expect(whenKey('something', 1)).toBeGreaterThan(whenKey('Nov 7', 0));
  });
});

describe('spend', () => {
  const bill = (topic: string, each: number, collector: string, over: Partial<Decision> = {}) =>
    decision(topic, `${each} each`, { split: { perPerson: each, currency: '₹', among: 'everyone', collector }, ...over });

  it('adds up the group total and each person share, counting only costs that are not in dispute', () => {
    const plan = planOf(trip, [bill('Hotel', 4800, 'Alex'), bill('Scuba', 6500, 'Alex', { status: 'conflicted' })]);
    expect(plan.spend.groupTotals).toEqual([{ currency: 'INR', amount: 14400 }]);
    const rohan = plan.spend.byPerson.find(p => p.name === 'Rohan')!;
    expect(rohan.totals).toEqual([{ currency: 'INR', amount: 4800 }]);
    expect(rohan.ifApproved).toEqual([{ currency: 'INR', amount: 6500 }]);
  });

  it('a person who paid the bill still has their own share as spend', () => {
    const plan = planOf(trip, [bill('Hotel', 4800, 'Alex')]);
    expect(plan.spend.byPerson.find(p => p.name === 'Alex')!.totals[0].amount).toBe(4800);
  });

  it('personal view: only groups you are in, spend summed across them, schedule in time order, groups kept separate', () => {
    const a = planOf(trip, [bill('Hotel', 4800, 'Alex'), decision('Departure', 'Friday 8 PM')]);
    const b = planOf(other, [bill('Rent', 9000, 'Zed', { conversationId: 'flat' }), decision('Move-in', 'Nov 1', { conversationId: 'flat' })]);
    const mine = computeMyPlan([a, b], [trip, other], 'Priya');
    expect(mine.spendText).toBe('₹13,800');
    expect(mine.groups.map(g => g.title)).toEqual(['Goa Trip', 'Flat']);
    expect(mine.timeline.map(i => i.title)).toEqual(['Departure', 'Move-in']);
    expect(computeMyPlan([a, b], [trip, other], 'Zed').groups.map(g => g.title)).toEqual(['Flat']);
  });
});

describe('objections found by the model', () => {
  const msg = (id: string, speakerName: string, content: string): Message => ({ id, conversationId: 'trip', speakerId: speakerName, speakerName, timestamp: '', content, type: 'text', createdAt: 0 });
  const chat = [msg('m1', 'Sam', 'Scuba charter for 6500 each?'), msg('m2', 'Rohan', 'scuba vaddu bro, budget ledu')];
  const scuba: Proposal = { kind: 'decision', topic: 'Scuba charter', value: '6500 each', status: 'proposed', split: { perPerson: 6500, among: 'everyone' }, evidence: [{ messageId: 'm1', quote: 'Scuba charter for 6500 each' }] };
  const costs = suggestedCosts([scuba, { ...scuba, status: 'confirmed' }]);

  it('only suggested costs are checked', () => {
    expect(costs).toHaveLength(1);
  });

  it('turns an objection in any language into a conflict, when the quote is real', () => {
    const out = parseObjections('{"results":[{"id":0,"objected":true,"messageId":"m2","quote":"scuba vaddu bro"}]}', costs, chat);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'conflict', topic: 'Scuba charter' });
  });

  it('drops an objection whose quote is not in the message, or that is not an objection', () => {
    expect(parseObjections('{"results":[{"id":0,"objected":true,"messageId":"m2","quote":"this is far too pricey"}]}', costs, chat)).toEqual([]);
    expect(parseObjections('{"results":[{"id":0,"objected":false,"messageId":"m2","quote":"scuba vaddu bro"}]}', costs, chat)).toEqual([]);
    expect(parseObjections('not json', costs, chat)).toEqual([]);
  });
});
