import { describe, expect, it } from 'vitest';
import { localGroupAnswer } from '../engine/localAnswer';
import { Commitment, Conflict, Decision, Evidence } from '../types/groupOs';

const dec = (id: string, topic: string, value: string, ev: string[]): Decision => ({
  id, conversationId: 'w', topic, currentValue: value, status: 'confirmed',
  supportingEvidenceIds: ev, contradictingEvidenceIds: [], confidence: 0.9, lastUpdatedAt: '', updatedBy: '', history: [],
});
const com: Commitment = {
  id: 'c1', conversationId: 'w', ownerId: 'u_sam', ownerName: 'Sam', description: 'Book the villa tonight',
  status: 'accepted', evidenceIds: ['e2'], lastUpdatedAt: '',
};
const conflict: Conflict = {
  id: 'x', conversationId: 'w', topic: 'Departure Date', description: "Priya can't leave Friday",
  relatedDecisionIds: [], evidenceIds: ['e3'], impactedItemIds: [], status: 'open', createdAt: '',
};
const evidenceMap: Record<string, Evidence> = {
  e1: { id: 'e1', messageId: 'm_budget', quote: 'q', sourceType: 'message', verificationStatus: 'supported', explanation: '' },
  e2: { id: 'e2', messageId: 'm_villa', quote: 'q', sourceType: 'message', verificationStatus: 'supported', explanation: '' },
  e3: { id: 'e3', messageId: 'm_priya', quote: 'q', sourceType: 'message', verificationStatus: 'supported', explanation: '' },
};
const base = { workspaceTitle: 'Goa', decisions: [dec('d1', 'Budget cap', '₹15,000 per person', ['e1'])], commitments: [com], conflicts: [conflict], evidenceMap };

describe('local group answer', () => {
  it('ranks matching items first and cites the real message ids', () => {
    const answer = localGroupAnswer({ ...base, query: 'What is our budget?' });
    expect(answer).toContain('Budget cap: ₹15,000 per person (confirmed) [m_budget]');
    expect(answer.indexOf('Budget cap')).toBeLessThan(answer.indexOf('Villa') === -1 ? Infinity : answer.indexOf('Villa'));
  });

  it('answers a who-question from commitments', () => {
    expect(localGroupAnswer({ ...base, query: 'who is booking the villa' })).toContain('Sam: Book the villa tonight (accepted) [m_villa]');
  });

  it('surfaces open conflicts and never invents facts that are not tracked', () => {
    const answer = localGroupAnswer({ ...base, query: 'anything about visas?' });
    expect(answer).toContain('Open conflict on Departure Date');
    expect(answer).toContain('[m_priya]');
    expect(answer).not.toMatch(/SunBreeze|Saturday|Nov/);
  });

  it('says plainly when nothing is tracked', () => {
    const answer = localGroupAnswer({ workspaceTitle: 'Empty', query: 'budget?', decisions: [], commitments: [], conflicts: [], evidenceMap: {} });
    expect(answer).toMatch(/Nothing is tracked yet in "Empty"/);
  });
});
