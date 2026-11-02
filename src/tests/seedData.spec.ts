import { describe, expect, it } from 'vitest';
import { seedIntelligenceByWorkspace, SEED_MESSAGES_FLAT, SEED_MESSAGES_GOA, SEED_MESSAGES_PROJECT } from '../data/seedData';

describe('seeded workspaces', () => {
  const seed = seedIntelligenceByWorkspace();
  const messages = { ws_goa: SEED_MESSAGES_GOA, ws_flat: SEED_MESSAGES_FLAT, ws_project: SEED_MESSAGES_PROJECT };

  it('puts every item in the workspace it belongs to, and none in the wrong one', () => {
    for (const ws of Object.keys(messages)) {
      [...seed.decisions[ws], ...seed.commitments[ws], ...seed.conflicts[ws]].forEach(i => expect(i.conversationId).toBe(ws));
    }
  });

  it('gives each workspace its own intelligence (flat and project are no longer empty)', () => {
    expect(seed.decisions.ws_goa.length).toBeGreaterThan(0);
    expect(seed.decisions.ws_flat.length).toBeGreaterThan(0);
    expect(seed.decisions.ws_project.length).toBeGreaterThan(0);
    expect(seed.decisions.ws_goa.some(d => /electric|deploy|contract/i.test(d.topic))).toBe(false);
    expect(seed.commitments.ws_goa.some(c => /electric|PR #|client/i.test(c.description))).toBe(false);
  });

  it('every cited evidence id resolves inside its own workspace', () => {
    for (const ws of Object.keys(messages)) {
      const cited = [
        ...seed.decisions[ws].flatMap(d => [...d.supportingEvidenceIds, ...d.contradictingEvidenceIds]),
        ...seed.commitments[ws].flatMap(c => c.evidenceIds),
        ...seed.conflicts[ws].flatMap(c => c.evidenceIds),
      ];
      const missing = cited.filter(id => !seed.evidence[ws][id]);
      expect(missing, `${ws} cites evidence it does not hold`).toEqual([]);
    }
  });

  it('every attachment a message references is available in that workspace only', () => {
    for (const [ws, list] of Object.entries(messages)) {
      const referenced = list.flatMap(m => m.attachmentIds || []);
      referenced.forEach(id => expect(seed.attachments[ws][id], `${ws} is missing attachment ${id}`).toBeDefined());
    }
    expect(seed.attachments.ws_goa.att_electric_bill).toBeUndefined();
  });
});
