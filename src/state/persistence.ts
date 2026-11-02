import {
  Attachment,
  Commitment,
  Conflict,
  Decision,
  Evidence,
  InAppNotification,
  IntelligenceRun,
  ModelCall,
  Message,
  PersonalTask,
  PrivateAnswerRecord,
  PrivacyScopeSettings,
  Workspace,
} from '../types/groupOs';

/**
 * Session persistence (this browser tab only, gone when it closes) that honours the retention policy chosen in the Privacy tab.
 *  - transient_session: nothing is written (and anything saved earlier is erased)
 *  - decisions_commitments_only: intelligence and its quoted evidence are kept, raw messages are not
 *  - full_intelligence: everything is kept
 * The Meta API key is never part of this snapshot.
 */

export const STORAGE_KEY = 'group_os_state_v1';
const VERSION = 5; // 5: saved-at stamp, model-call log, private Q&A history

export interface PersistedState {
  workspaces: Workspace[];
  messagesByWs: Record<string, Message[]>;
  decisionsByWs: Record<string, Decision[]>;
  commitmentsByWs: Record<string, Commitment[]>;
  conflictsByWs: Record<string, Conflict[]>;
  evidenceByWs: Record<string, Record<string, Evidence>>;
  attachmentsByWs: Record<string, Record<string, Attachment>>;
  personalTasksByUser: Record<string, PersonalTask[]>;
  notificationsByUser: Record<string, InAppNotification[]>;
  /** The latest run card per group, so the "what changed" and "now tracking" summary survives a reload. */
  runsByWs: Record<string, IntelligenceRun>;
  /** Metadata of every request sent to Meta this session, for the "what was sent" list. */
  modelCalls: ModelCall[];
  privateAnswers: PrivateAnswerRecord[];
  privacySettings: PrivacyScopeSettings;
}

/** When the snapshot was written, so a restored session can say how old it is. */
export interface Stamped {
  savedAt?: string;
}

export type SavedState = Partial<Omit<PersistedState, 'messagesByWs'>> & { messagesByWs?: Record<string, Message[]> } & Stamped;

/** Returns the JSON to store, or null when the policy says nothing may be stored. */
export function serializeState(state: PersistedState): string | null {
  const { retentionPolicy, zeroRawStorage } = state.privacySettings;
  if (retentionPolicy === 'transient_session') return null;

  const keepMessages = retentionPolicy === 'full_intelligence' && !zeroRawStorage;

  // Object URLs from recordings die with the page, so they are never stored.
  const attachmentsByWs = Object.fromEntries(
    Object.entries(state.attachmentsByWs).map(([ws, atts]) => [
      ws,
      Object.fromEntries(
        Object.entries(atts).map(([id, a]) => {
          const { audioUrl: _audioUrl, ...metadata } = a.metadata || {};
          return [id, { ...a, metadata }];
        })
      ),
    ])
  );

  const { messagesByWs, ...rest } = state;
  return JSON.stringify({
    version: VERSION,
    savedAt: new Date().toISOString(),
    ...rest,
    attachmentsByWs,
    ...(keepMessages ? { messagesByWs } : {}),
  });
}

export function deserializeState(raw: string | null): SavedState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== VERSION) return null;
    const { version: _version, ...state } = parsed;
    return state as SavedState;
  } catch {
    return null;
  }
}

/* ---- thin storage wrappers: storage can be blocked or full, and the app must still work ---- */

export function readSaved(): SavedState | null {
  // A reload or a new visit always starts empty: analysis lives in memory for as long as the page stays open.
  // Earlier versions kept state in browser storage, so remove whatever they left behind.
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('group_os_state')) localStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    const params = new URLSearchParams(window.location.search);
    if (params.get('reset') === '1') {
      params.delete('reset');
      const query = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''));
    }
  } catch {
    /* storage blocked */
  }
  return null;
}

export function writeSaved(state: PersistedState): void {
  try {
    const json = serializeState(state);
    if (json === null) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, json);
  } catch {
    /* quota or blocked storage: keep running in memory */
  }
}

export function clearSaved(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
