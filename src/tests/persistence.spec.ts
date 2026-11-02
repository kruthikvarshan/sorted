import { describe, expect, it } from 'vitest';
import { deserializeState, PersistedState, serializeState } from '../state/persistence';
import { PrivacyScopeSettings } from '../types/groupOs';

const privacy = (retentionPolicy: PrivacyScopeSettings['retentionPolicy'], zeroRawStorage = false): PrivacyScopeSettings => ({
  scopedWorkspaceIds: ['w'],
  participationByWorkspace: {},
  retentionPolicy,
  webhookEndpoint: '',
  webhookStatus: 'simulated',
  zeroRawStorage,
});

const state = (p: PrivacyScopeSettings): PersistedState => ({
  workspaces: [],
  messagesByWs: { w: [{ id: 'm1', conversationId: 'w', speakerId: 'u', speakerName: 'Alex', timestamp: '', content: 'secret raw words', type: 'text', createdAt: 0 }] },
  decisionsByWs: { w: [] },
  commitmentsByWs: { w: [] },
  conflictsByWs: { w: [] },
  evidenceByWs: { w: { e1: { id: 'e1', messageId: 'm1', quote: 'kept quote', sourceType: 'message', verificationStatus: 'supported', explanation: '' } } },
  attachmentsByWs: { w: { a1: { id: 'a1', type: 'voice_note', displayName: 'v', sourceMessageId: 'm1', metadata: { transcript: 't', audioUrl: 'blob:http://x/abc' } } } },
  personalTasksByUser: {},
  notificationsByUser: {},
  runsByWs: {},
  modelCalls: [],
  privateAnswers: [],
  privacySettings: p,
});

describe('retention policy decides what is stored', () => {
  it('session-only stores nothing at all', () => {
    expect(serializeState(state(privacy('transient_session')))).toBeNull();
  });

  it('decisions-only keeps evidence quotes but drops raw messages', () => {
    const json = serializeState(state(privacy('decisions_commitments_only')))!;
    expect(json).toContain('kept quote');
    expect(json).not.toContain('secret raw words');
    expect(deserializeState(json)?.messagesByWs).toBeUndefined();
  });

  it('full keeps raw messages, unless zero raw storage is switched on', () => {
    expect(serializeState(state(privacy('full_intelligence')))).toContain('secret raw words');
    expect(serializeState(state(privacy('full_intelligence', true)))).not.toContain('secret raw words');
  });

  it('never stores recording object URLs or anything resembling a key', () => {
    const json = serializeState(state(privacy('full_intelligence')))!;
    expect(json).not.toContain('blob:');
    expect(json).not.toMatch(/api[_-]?key|bearer/i);
    expect(json).toContain('"transcript":"t"');
  });
});

describe('loading saved state', () => {
  it('round-trips a saved snapshot', () => {
    const restored = deserializeState(serializeState(state(privacy('full_intelligence'))));
    expect(restored?.evidenceByWs?.w.e1.quote).toBe('kept quote');
    expect(restored?.privacySettings?.retentionPolicy).toBe('full_intelligence');
  });

  it('ignores garbage, other versions and empty storage instead of crashing', () => {
    expect(deserializeState(null)).toBeNull();
    expect(deserializeState('not json')).toBeNull();
    expect(deserializeState(JSON.stringify({ version: 99, workspaces: [] }))).toBeNull();
  });
});

describe('run cards survive the session', () => {
  const withRun = (p: PrivacyScopeSettings): PersistedState => ({
    ...state(p),
    runsByWs: { w: { id: 'r1', source: 'meta', model: 'muse-spark-1.3', at: '9:00', workspaceId: 'w', created: 2, updated: 1, reinforced: 0, unchanged: 3, conflictsRaised: 0, changes: [], rejected: [], snapshot: { decisions: 3, commitments: 4, openCommitments: 2, openConflicts: 1, unverifiedClaims: 1 } } },
  });

  it('round-trips the latest run card with its current-status snapshot', () => {
    const restored = deserializeState(serializeState(withRun(privacy('decisions_commitments_only'))));
    expect(restored?.runsByWs?.w.snapshot).toEqual({ decisions: 3, commitments: 4, openCommitments: 2, openConflicts: 1, unverifiedClaims: 1 });
  });

  it('stores nothing under session-only retention', () => {
    expect(serializeState(withRun(privacy('transient_session')))).toBeNull();
  });
});

describe('what a restored session can say about itself', () => {
  it('stamps when it was saved, so the app can show how old restored data is', () => {
    const restored = deserializeState(serializeState(state(privacy('decisions_commitments_only'))));
    expect(restored?.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Math.abs(Date.now() - new Date(restored!.savedAt!).getTime())).toBeLessThan(5000);
  });

  it('keeps the model-call log and private answers, and the log holds no chat text', () => {
    const s = state(privacy('full_intelligence'));
    s.modelCalls = [{ id: 'k1', at: '10:00', purpose: 'Extract decisions and commitments', workspaceId: 'w', workspaceTitle: 'Araku', model: 'muse-spark-1.3', detail: '24 messages', tokens: 8000, ok: true }];
    s.privateAnswers = [{ query: 'What do I owe?', timestamp: '10:01', answer: 'You owe nothing.', source: 'meta', model: 'muse-spark-1.3' }];
    const json = serializeState(s)!;
    const restored = deserializeState(json);
    expect(restored?.modelCalls?.[0]).toMatchObject({ purpose: 'Extract decisions and commitments', detail: '24 messages' });
    expect(restored?.privateAnswers?.[0].answer).toBe('You owe nothing.');
    expect(JSON.stringify(restored?.modelCalls)).not.toContain('secret raw words');
  });
});
