import { describe, expect, it } from 'vitest';
import { buildPrivateView, localPrivateAnswer, summarizeGroupsForModel } from '../engine/privateView';
import { Commitment, Conflict, Decision, Evidence, User, Workspace } from '../types/groupOs';

const alex: User = { id: 'u_alex', name: 'Alex', avatarColor: '#000' };
const ws = (id: string, title: string): Workspace => ({
  id,
  title,
  category: '',
  description: '',
  participants: [alex],
  unreadCount: 0,
  lastActivity: '',
  iconName: '',
});
const commitment = (id: string, wsId: string, ownerName: string, description: string, status: Commitment['status'] = 'accepted'): Commitment => ({
  id,
  conversationId: wsId,
  ownerId: `u_${ownerName.toLowerCase()}`,
  ownerName,
  description,
  status,
  evidenceIds: [`ev_${id}`],
  lastUpdatedAt: '',
});
const conflict = (id: string, wsId: string, status: Conflict['status'] = 'open'): Conflict => ({
  id,
  conversationId: wsId,
  topic: `Topic ${id}`,
  description: `Description ${id}`,
  relatedDecisionIds: [],
  evidenceIds: [`ev_${id}`],
  impactedItemIds: [],
  status,
  createdAt: '',
});
const decision = (id: string, wsId: string): Decision => ({
  id,
  conversationId: wsId,
  topic: `Decision ${id}`,
  currentValue: 'Value',
  status: 'confirmed',
  supportingEvidenceIds: [],
  contradictingEvidenceIds: [],
  confidence: 0.9,
  lastUpdatedAt: '',
  updatedBy: '',
  history: [],
});
const ev = (id: string, messageId: string): Evidence => ({
  id,
  messageId,
  quote: 'q',
  sourceType: 'message',
  verificationStatus: 'supported',
  explanation: '',
});

const base = () => ({
  workspaces: [ws('a', 'Goa'), ws('b', 'Flat')],
  decisionsByWs: { a: [decision('d1', 'a')], b: [decision('d2', 'b')] },
  commitmentsByWs: {
    a: [commitment('c1', 'a', 'Alex', 'Book the villa'), commitment('c2', 'a', 'Sam', "Sam's job"), commitment('c3', 'a', 'Alex', 'Pay deposit', 'completed')],
    b: [commitment('c4', 'b', 'Alex', 'Fix the AC')],
  },
  conflictsByWs: { a: [conflict('x1', 'a')], b: [conflict('x2', 'b'), conflict('x3', 'b', 'resolved')] },
  evidenceByWs: { a: { ev_c1: ev('ev_c1', 'm_a1') }, b: {} },
  user: alex,
});

describe('private view respects scope', () => {
  it('contains only my commitments and only open conflicts from groups in scope', () => {
    const view = buildPrivateView({ ...base(), scopedIds: ['a', 'b'] });
    expect(view.commitments.map(i => i.commitment.id)).toEqual(['c1', 'c4', 'c3']); // open first, Sam's excluded
    expect(view.conflicts.map(i => i.conflict.id)).toEqual(['x1', 'x2']); // resolved excluded
    expect(view.commitments[0].messageId).toBe('m_a1'); // citation resolves to a real message
  });

  it('removes a group completely when it is taken out of scope', () => {
    const view = buildPrivateView({ ...base(), scopedIds: ['a'] });
    expect(view.groupCount).toBe(1);
    expect(view.commitments.every(i => i.workspaceId === 'a')).toBe(true);
    expect(view.conflicts.every(i => i.workspaceId === 'a')).toBe(true);
  });

  it('never gives the model text from an out-of-scope group', () => {
    const summaries = summarizeGroupsForModel({ ...base(), scopedIds: ['a'] });
    const text = JSON.stringify(summaries);
    expect(summaries.map(s => s.title)).toEqual(['Goa']);
    expect(text).toContain('Book the villa');
    expect(text).not.toContain('Fix the AC');
    expect(text).not.toContain('Flat');
    expect(text).not.toContain("Sam's job"); // other people's private tasks are not mine
  });

  it('with nothing in scope the view is empty and the answer says so', () => {
    const view = buildPrivateView({ ...base(), scopedIds: [] });
    expect(view).toMatchObject({ groupCount: 0, commitments: [], conflicts: [] });
    expect(localPrivateAnswer(view)).toMatch(/No groups are in your scope/);
    expect(summarizeGroupsForModel({ ...base(), scopedIds: [] })).toEqual([]);
  });

  it('the local answer is composed from real items, not canned text', () => {
    const answer = localPrivateAnswer(buildPrivateView({ ...base(), scopedIds: ['a', 'b'] }));
    expect(answer).toContain('2 open commitments');
    expect(answer).toContain('[Goa] Book the villa');
    expect(answer).toContain('[Flat] Fix the AC');
    expect(answer).not.toContain('Pay deposit'); // completed items are not "open"
  });
});
