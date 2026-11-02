/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { SidebarLeft } from './components/SidebarLeft';
import { ConversationCenter, VoiceDraft } from './components/ConversationCenter';
import { RightSidebarIntelligence } from './components/RightSidebarIntelligence';
import { PrivatePersonalAssistant } from './components/PrivatePersonalAssistant';
import { DecisionHistoryView } from './components/DecisionHistoryView';
import { SettingsAndApiView } from './components/SettingsAndApiView';
import { WhatsAppChatImporter } from './components/WhatsAppChatImporter';
import { PrivacyAndIntegrationsView } from './components/PrivacyAndIntegrationsView';
import { ExtractionRunCard } from './components/ExtractionRunCard';

import {
  WORKSPACES,
  DEMO_USERS,
  SEED_MESSAGES_GOA,
  SEED_MESSAGES_FLAT,
  SEED_MESSAGES_PROJECT,
  INITIAL_DECISIONS,
  INITIAL_COMMITMENTS,
  INITIAL_CONFLICTS,
  INITIAL_EVIDENCE,
  ATTACHMENTS,
  INITIAL_PERSONAL_TASKS,
  INITIAL_NOTIFICATIONS,
  INITIAL_USER_PREFERENCES,
  seedIntelligenceByWorkspace,
} from './data/seedData';
import { ReconciliationEngine } from './engine/reconciliationEngine';
import { applyProposals, resolveConflict, summarizeProposal, ConflictChoice, Proposal } from './engine/eventReducer';
import { heuristicProposals } from './engine/localHeuristics';
import { extractWithMeta } from './services/metaToolPipeline';
import { toAsrWav } from './services/audioUtils';
import { readSaved, clearSaved } from './state/persistence';
import { getSpokenLanguages } from './state/preferences';
import { buildPrivateView, localPrivateAnswer, summarizeGroupsForModel } from './engine/privateView';
import { localGroupAnswer } from './engine/localAnswer';
import { summarizeResults } from './engine/runSummary';
import { seedTestGroups } from './data/scenarios/seedTestGroups';
import { draftConflictMessage } from './services/conflictDrafter';
import { fileToReceiptDataUrl, readReceipt } from './services/receiptReader';
import { computeReminders, reconcileReminderNotifications } from './engine/reminders';
import { groupFreshness, needsRefresh } from './engine/freshness';
import { computeMyMoney } from './engine/myMoney';
import { markSharePaid, setCollector } from './engine/shares';
import { computeGroupLedger, computeMySettlement } from './engine/settle';
import { computeGroupPlan, computeMyPlan } from './engine/plan';
import { assessReceipt, attachReceipt, canConfirm, confirmPayment, disputePayment, usedReferences } from './engine/receiptVerifier';
import { DraftMessageModal, DraftState } from './components/DraftMessageModal';
import type { PrivateAnswer } from './components/PrivatePersonalAssistant';
import {
  Workspace,
  User,
  Message,
  Decision,
  Commitment,
  Conflict,
  Evidence,
  Attachment,
  PersonalTask,
  InAppNotification,
  UserPreferences,
  PrivacyScopeSettings,
  IntelligenceRun,
  ModelCall,
  PrivateAnswerRecord,
  RejectedProposal,
  GroupIntelligenceState,
} from './types/groupOs';
import { MetaModelService } from './services/metaModelService';

// Restored once at load; the retention policy decided what (if anything) was written last time.
const saved = readSaved();
const SEED = seedIntelligenceByWorkspace();
const TEST = seedTestGroups();

export default function App() {
  // Navigation & Workspace State
  const [workspaces, setWorkspaces] = useState<Workspace[]>(
    saved?.workspaces ?? [...WORKSPACES.map(w => ({ ...w, unreadCount: 0 })), ...TEST.workspaces]
  );
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>('ws_goa');
  const [currentNav, setCurrentNav] = useState<
    'conversations' | 'my-tasks' | 'decision-history' | 'importer' | 'privacy' | 'settings'
  >('conversations');
  const [mobileTab, setMobileTab] = useState<'chat' | 'intelligence'>('chat');

  // Privacy & Scope Configuration
  const [privacySettings, setPrivacySettings] = useState<PrivacyScopeSettings>(saved?.privacySettings ?? {
    scopedWorkspaceIds: ['ws_goa', 'ws_flat', 'ws_project', ...TEST.workspaces.map(w => w.id)],
    participationByWorkspace: {
      ws_goa: { invitedToParticipate: true, privateOnly: false, allowProactiveAlerts: true },
      ws_flat: { invitedToParticipate: true, privateOnly: false, allowProactiveAlerts: true },
      ws_project: { invitedToParticipate: true, privateOnly: false, allowProactiveAlerts: true },
      ...Object.fromEntries(
        TEST.workspaces.map(w => [w.id, { invitedToParticipate: true, privateOnly: false, allowProactiveAlerts: true }])
      ),
    },
    retentionPolicy: 'decisions_commitments_only',
    webhookEndpoint: 'https://api.groupos.internal/v1/webhook/whatsapp',
    webhookStatus: 'simulated',
    zeroRawStorage: false,
  });

  // Active User / Persona (Alex by default)
  const [currentUser, setCurrentUser] = useState<User>(DEMO_USERS[0]);

  // Messages per workspace
  const [messagesByWs, setMessagesByWs] = useState<Record<string, Message[]>>({
    ws_goa: [...SEED_MESSAGES_GOA],
    ws_flat: [...SEED_MESSAGES_FLAT],
    ws_project: [...SEED_MESSAGES_PROJECT],
    ...TEST.messagesByWs,
    ...saved?.messagesByWs,
  });

  // Decisions, Commitments, Conflicts, Evidence per workspace
  const [decisionsByWs, setDecisionsByWs] = useState<Record<string, Decision[]>>({
    ...saved?.decisionsByWs,
  });

  const [commitmentsByWs, setCommitmentsByWs] = useState<Record<string, Commitment[]>>({
    ...saved?.commitmentsByWs,
  });

  const [conflictsByWs, setConflictsByWs] = useState<Record<string, Conflict[]>>({
    ...saved?.conflictsByWs,
  });

  const [evidenceByWs, setEvidenceByWs] = useState<Record<string, Record<string, Evidence>>>({
    ...saved?.evidenceByWs,
  });

  const [attachmentsByWs, setAttachmentsByWs] = useState<Record<string, Record<string, Attachment>>>({
    ...SEED.attachments,
    ...saved?.attachmentsByWs,
  });

  // Private Personal Intelligence State (per user)
  const [personalTasksByUser, setPersonalTasksByUser] = useState<Record<string, PersonalTask[]>>({
    ...saved?.personalTasksByUser,
  });

  const [notificationsByUser, setNotificationsByUser] = useState<Record<string, InAppNotification[]>>({
    ...saved?.notificationsByUser,
  });

  const [userPreferencesByUser, setUserPreferencesByUser] = useState<Record<string, UserPreferences>>({
    ...Object.fromEntries(Object.entries(INITIAL_USER_PREFERENCES).map(([id, prefs]) => [id, { ...prefs, privatePreferences: [] }])),
  });

  // Highlight message tracking for evidence scrolling
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [isAnalyzingWithMeta, setIsAnalyzingWithMeta] = useState<boolean>(false);
  const [isGeneratingVisual, setIsGeneratingVisual] = useState<boolean>(false);

  // Meta API Key & Demo Mode (sessionStorage backed)
  const [isDemoMode, setIsDemoMode] = useState<boolean>(() => {
    const stored = sessionStorage.getItem('group_os_demo_mode');
    if (stored !== null) return stored !== 'false';
    return !sessionStorage.getItem('meta_model_api_key');
  });
  const [apiKey, setApiKey] = useState<string>(() => {
    return sessionStorage.getItem('meta_model_api_key') || '';
  });

  // When the server holds MODEL_API_KEY the browser never sees it; 'server-managed' is a placeholder, not a secret.
  const [serverKeyActive, setServerKeyActive] = useState(false);
  useEffect(() => {
    fetch('/api/config')
      .then(r => (r.ok ? r.json() : null))
      .then(cfg => {
        if (cfg?.serverKey) {
          setServerKeyActive(true);
          setApiKey('server-managed');
          setIsDemoMode(false);
        }
      })
      .catch(() => {
        /* static hosting or offline: the user pastes a key in Settings instead */
      });
  }, []);

  const [receiptBusyId, setReceiptBusyId] = useState<string | null>(null);
  const [modelCalls, setModelCalls] = useState<ModelCall[]>(saved?.modelCalls ?? []);
  const [privateAnswers, setPrivateAnswers] = useState<PrivateAnswerRecord[]>(saved?.privateAnswers ?? []);
  const [refreshProgress, setRefreshProgress] = useState<{ done: number; total: number; current?: string } | null>(null);
  const [draftState, setDraftState] = useState<DraftState | null>(null);
  const [runsByWs, setRunsByWs] = useState<Record<string, IntelligenceRun>>(saved?.runsByWs ?? {});
  const setLastRun = (run: IntelligenceRun | null) => {
    if (run) setRunsByWs(prev => ({ ...prev, [run.workspaceId]: run }));
  };
  const [privateReply, setPrivateReply] = useState<{ text: string; note?: string } | null>(null);

  // Async analysis finishes after renders, so it reads the freshest state through a ref.
  const intelRef = useRef({ decisionsByWs, commitmentsByWs, conflictsByWs, evidenceByWs });
  intelRef.current = { decisionsByWs, commitmentsByWs, conflictsByWs, evidenceByWs };

  // Opening a chat marks it read. (The count was seed data that nothing ever reset.)
  useEffect(() => {
    if (currentNav !== 'conversations') return;
    setWorkspaces(prev =>
      prev.some(w => w.id === activeWorkspaceId && w.unreadCount > 0)
        ? prev.map(w => (w.id === activeWorkspaceId ? { ...w, unreadCount: 0 } : w))
        : prev
    );
  }, [activeWorkspaceId, currentNav]);

  const activeWorkspace = useMemo(() => {
    return workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0];
  }, [activeWorkspaceId, workspaces]);

  const currentMessages = messagesByWs[activeWorkspaceId] || [];
  const currentDecisions = decisionsByWs[activeWorkspaceId] || [];
  const currentCommitments = commitmentsByWs[activeWorkspaceId] || [];
  const currentConflicts = conflictsByWs[activeWorkspaceId] || [];
  const currentEvidence = evidenceByWs[activeWorkspaceId] || {};
  const currentAttachments = attachmentsByWs[activeWorkspaceId] || {};

  const currentPersonalTasks = personalTasksByUser[currentUser.id] || [];
  const currentNotifications = notificationsByUser[currentUser.id] || [];

  // The private layer only shows what comes from groups in scope.
  const scopedPersonalTasks = currentPersonalTasks.filter(
    t => !t.sourceConversationId || privacySettings.scopedWorkspaceIds.includes(t.sourceConversationId)
  );
  const scopedNotifications = currentNotifications.filter(n =>
    privacySettings.scopedWorkspaceIds.includes(n.conversationId)
  );
  const privateViewInputs = {
    workspaces,
    scopedIds: privacySettings.scopedWorkspaceIds,
    decisionsByWs,
    commitmentsByWs,
    conflictsByWs,
    evidenceByWs,
    user: currentUser,
  };
  const privateView = buildPrivateView(privateViewInputs);
  const myMoney = computeMyMoney(workspaces, privacySettings.scopedWorkspaceIds, commitmentsByWs, currentUser);
  const groupViews = workspaces.map(w => {
    const ledger = computeGroupLedger(w, decisionsByWs[w.id] || [], commitmentsByWs[w.id] || [], {
      conflicts: conflictsByWs[w.id] || [],
      evidenceMap: evidenceByWs[w.id] || {},
      messages: messagesByWs[w.id] || [],
    });
    return { ws: w, ledger, plan: computeGroupPlan(w, decisionsByWs[w.id] || [], commitmentsByWs[w.id] || [], evidenceByWs[w.id] || {}, ledger) };
  });
  const inScopeViews = groupViews.filter(v => privacySettings.scopedWorkspaceIds.includes(v.ws.id));
  const settlement = computeMySettlement(inScopeViews.map(v => v.ledger), currentUser.name);
  const myPlan = computeMyPlan(inScopeViews.map(v => v.plan), workspaces, currentUser.name);
  const owe = { totalsText: settlement.oweText, owedText: settlement.owedText, lines: settlement.lines };

  // Everyone who appears in any group can be viewed as, including the members of chats you import.
  const personaList = useMemo(() => {
    const seen = new Set(DEMO_USERS.map(u => u.name.toLowerCase()));
    const extra: User[] = [];
    for (const w of workspaces) {
      for (const p of w.participants) {
        if (!seen.has(p.name.toLowerCase())) {
          seen.add(p.name.toLowerCase());
          extra.push(p);
        }
      }
    }
    return [...DEMO_USERS, ...extra];
  }, [workspaces]);
  const currentUserPrefs: UserPreferences = userPreferencesByUser[currentUser.id] || {
    userId: currentUser.id,
    privatePreferences: [],
    personalNotificationSettings: {
      onConflict: true,
      onCommitmentAssigned: true,
      onDateChange: true,
      onReminderDue: true,
    },
  };

  const unresolvedCount = useMemo(() => {
    const conflictedDecisions = currentDecisions.filter(d => d.status === 'conflicted').length;
    const openConflicts = currentConflicts.filter(c => c.status === 'open').length;
    return Math.max(conflictedDecisions, openConflicts);
  }, [currentDecisions, currentConflicts]);


  const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const isScoped = (wsId: string) => privacySettings.scopedWorkspaceIds.includes(wsId);

  /** Record that a request went to a Meta model. Metadata only: never the chat text or the reply. */
  const logCall = (call: Omit<ModelCall, 'id' | 'at'>) =>
    setModelCalls(prev => [...prev, { ...call, id: `call_${Date.now()}_${prev.length}`, at: nowLabel() }].slice(-200));
  const titleOf = (wsId?: string) => (wsId ? workspaces.find(w => w.id === wsId)?.title : undefined);

  const applyToWorkspace = (
    wsId: string,
    proposals: Proposal[],
    transcript: Message[],
    actor: 'model' | 'system',
    actorLabel: string
  ) => {
    const cur = intelRef.current;
    const base: GroupIntelligenceState = {
      decisions: cur.decisionsByWs[wsId] || [],
      commitments: cur.commitmentsByWs[wsId] || [],
      conflicts: cur.conflictsByWs[wsId] || [],
      evidenceMap: cur.evidenceByWs[wsId] || {},
      history: [],
    };
    const { state, results } = applyProposals(base, proposals, {
      conversationId: wsId,
      messages: transcript,
      actor,
      actorLabel,
      now: nowLabel(),
    });
    intelRef.current = {
      decisionsByWs: { ...cur.decisionsByWs, [wsId]: state.decisions },
      commitmentsByWs: { ...cur.commitmentsByWs, [wsId]: state.commitments },
      conflictsByWs: { ...cur.conflictsByWs, [wsId]: state.conflicts },
      evidenceByWs: { ...cur.evidenceByWs, [wsId]: state.evidenceMap },
    };
    setDecisionsByWs(prev => ({ ...prev, [wsId]: state.decisions }));
    setCommitmentsByWs(prev => ({ ...prev, [wsId]: state.commitments }));
    setConflictsByWs(prev => ({ ...prev, [wsId]: state.conflicts }));
    setEvidenceByWs(prev => ({ ...prev, [wsId]: state.evidenceMap }));
    return results;
  };

  /**
   * One analysis pass. `live` uses Meta tool calling; otherwise (or if Meta fails) the
   * labelled local heuristic runs. Both go through the same validating reducer.
   */
  const runIntelligence = async (opts: {
    wsId: string;
    transcript: Message[];
    existing: Decision[];
    live: boolean;
    focusMessageId?: string;
    assumeScoped?: boolean;
    /** Total messages in the chat now, so later messages can be flagged as not yet analyzed. */
    messageCount?: number;
    workspaceTitle?: string;
  }): Promise<IntelligenceRun | null> => {
    const { wsId, transcript, existing, live, focusMessageId } = opts;

    if (!opts.assumeScoped && !isScoped(wsId)) {
      setLastRun({
        id: `run_${Date.now()}`,
        source: 'local-heuristic',
        at: nowLabel(),
        workspaceId: wsId,
        created: 0,
        updated: 0,
        reinforced: 0,
        unchanged: 0,
        conflictsRaised: 0,
        changes: [],
        rejected: [],
        note: 'This workspace is outside your assistant scope (Privacy tab), so nothing was analyzed.',
      });
      return null;
    }

    let source: IntelligenceRun['source'] = 'local-heuristic';
    let note: string | undefined;
    let model: string | undefined;
    let rounds: number | undefined;
    let tokens: IntelligenceRun['tokens'];
    let proposals: Proposal[] = [];
    let rejected: RejectedProposal[] = [];

    const heuristicInput = focusMessageId ? transcript.filter(m => m.id === focusMessageId) : transcript;

    if (live) {
      try {
        const res = await extractWithMeta(
          apiKey,
          transcript,
          existing.map(d => ({ topic: d.topic, currentValue: d.currentValue, status: d.status })),
          {
            focusMessageId,
            verifyClaims: true,
            state: {
              decisions: intelRef.current.decisionsByWs[wsId] || [],
              commitments: intelRef.current.commitmentsByWs[wsId] || [],
              conflicts: intelRef.current.conflictsByWs[wsId] || [],
              evidenceMap: intelRef.current.evidenceByWs[wsId] || {},
              history: [],
            },
            existingCommitments: (intelRef.current.commitmentsByWs[wsId] || []).map(c => ({
              ownerName: c.ownerName,
              description: c.description,
              status: c.status,
            })),
          }
        );
        source = 'meta';
        model = res.model;
        rounds = res.rounds;
        tokens = res.tokens;
        proposals = res.proposals;
        rejected = res.rejected;
        logCall({
          purpose: 'Extract decisions and commitments',
          workspaceId: wsId,
          workspaceTitle: opts.workspaceTitle ?? titleOf(wsId),
          model: res.model,
          detail: `${transcript.length} message${transcript.length === 1 ? '' : 's'}${res.checked && !res.checked.failed ? ', then a second check of the results against their quotes' : ''}`,
          tokens: res.tokens.prompt + res.tokens.completion,
          ok: true,
        });
        note = res.note;
      } catch (err: any) {
        note = `Meta call failed (${err.message}). Used the local heuristic instead.`;
        logCall({
          purpose: 'Extract decisions and commitments',
          workspaceId: wsId,
          workspaceTitle: opts.workspaceTitle ?? titleOf(wsId),
          model: 'muse-spark-1.3',
          detail: `${transcript.length} message${transcript.length === 1 ? '' : 's'} (the request failed)`,
          ok: false,
        });
        proposals = heuristicProposals(heuristicInput);
      }
    } else {
      note = !apiKey.trim()
        ? 'No Meta API key set: used the local heuristic.'
        : 'Meta AI is turned off, so a simple offline reading was used. Turn it on in Settings.';
      proposals = heuristicProposals(heuristicInput);
    }

    const results = applyToWorkspace(
      wsId,
      proposals,
      transcript,
      source === 'meta' ? 'model' : 'system',
      source === 'meta' ? 'Meta AI' : 'an offline reading'
    );

    const after = intelRef.current;
    const nowCommitments = after.commitmentsByWs[wsId] || [];
    const run: IntelligenceRun = {
      id: `run_${Date.now()}`,
      source,
      model,
      at: nowLabel(),
      workspaceId: wsId,
      messageCount: opts.messageCount ?? transcript.length,
      rounds,
      tokens,
      ...summarizeResults(results),
      rejected: [
        ...rejected,
        ...results
          .filter(r => !r.accepted)
          .map(r => ({ summary: r.proposal.kind, reason: r.reason || 'rejected' })),
      ],
      note,
      snapshot: {
        decisions: (after.decisionsByWs[wsId] || []).length,
        commitments: nowCommitments.length,
        openCommitments: nowCommitments.filter(c => c.status !== 'completed' && c.status !== 'cancelled').length,
        openConflicts: (after.conflictsByWs[wsId] || []).filter(c => c.status === 'open').length,
        unverifiedClaims: nowCommitments.filter(c => c.status === 'needs_clarification').length,
      },
    };
    setLastRun(run);
    return run;
  };

  // Handler for custom imported chat (.txt or pasted): the real pipeline analyzes it
  const handleChatImported = async (newWs: Workspace, newMsgs: Message[]) => {
    setWorkspaces(prev => [newWs, ...prev.filter(w => w.id !== newWs.id)]);
    setMessagesByWs(prev => ({ ...prev, [newWs.id]: newMsgs }));
    setDecisionsByWs(prev => ({ ...prev, [newWs.id]: [] }));
    setCommitmentsByWs(prev => ({ ...prev, [newWs.id]: [] }));
    setConflictsByWs(prev => ({ ...prev, [newWs.id]: [] }));
    setEvidenceByWs(prev => ({ ...prev, [newWs.id]: {} }));
    setPrivacySettings(prev => ({
      ...prev,
      scopedWorkspaceIds: Array.from(new Set([...prev.scopedWorkspaceIds, newWs.id])),
      participationByWorkspace: {
        ...prev.participationByWorkspace,
        [newWs.id]: { invitedToParticipate: true, privateOnly: false, allowProactiveAlerts: true },
      },
    }));
    setActiveWorkspaceId(newWs.id);
    setCurrentNav('conversations');

    setIsAnalyzingWithMeta(true);
    try {
      await runIntelligence({
        wsId: newWs.id,
        transcript: newMsgs,
        existing: [],
        live: !!apiKey.trim() && !isDemoMode,
        assumeScoped: true, // importing is the user's explicit consent for this chat
        messageCount: newMsgs.length,
        workspaceTitle: newWs.title,
      });
    } finally {
      setIsAnalyzingWithMeta(false);
    }
  };

  // Handler for permanent data purge: every workspace, including imported ones
  const handlePurgeAllIntelligence = () => {
    const empty = <T,>(value: T) =>
      Object.fromEntries(workspaces.map(w => [w.id, structuredClone(value)])) as Record<string, T>;
    setDecisionsByWs(empty<Decision[]>([]));
    setCommitmentsByWs(empty<Commitment[]>([]));
    setConflictsByWs(empty<Conflict[]>([]));
    setEvidenceByWs(empty<Record<string, Evidence>>({}));
    setPersonalTasksByUser({ [currentUser.id]: [] });
    setNotificationsByUser({ [currentUser.id]: [] });
    setRunsByWs({});
    setPrivateReply(null);
    setModelCalls([]);
    setPrivateAnswers([]);
    clearSaved();
  };

  // Evidence click handler with smooth auto-scroll & highlight
  const handleEvidenceClick = (messageId: string) => {
    if (currentNav !== 'conversations') {
      setCurrentNav('conversations');
    }
    setMobileTab('chat');
    setHighlightedMessageId(messageId);

    setTimeout(() => {
      const element = document.getElementById(`msg-${messageId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);

    setTimeout(() => {
      setHighlightedMessageId(null);
    }, 3500);
  };

  // "Run Meta extraction": Meta tool calling over the whole transcript
  const handleRunMetaExtraction = async () => {
    if (!apiKey.trim()) {
      alert('Add your Meta API key in Settings to run extraction with Meta models.');
      setCurrentNav('settings');
      return;
    }

    setIsAnalyzingWithMeta(true);
    try {
      const run = await runIntelligence({
        wsId: activeWorkspaceId,
        transcript: currentMessages,
        existing: intelRef.current.decisionsByWs[activeWorkspaceId] || [],
        live: true,
        messageCount: currentMessages.length,
      });
      if (run && run.created + run.updated + run.conflictsRaised > 0) {
        const notif: InAppNotification = {
          id: `notif_run_${Date.now()}`,
          userId: currentUser.id,
          conversationId: activeWorkspaceId,
          conversationName: activeWorkspace.title,
          title: `${activeWorkspace.title} was read`,
          message: `${run.created} new, ${run.updated} changed${run.conflictsRaised ? `, ${run.conflictsRaised} disagreement${run.conflictsRaised === 1 ? '' : 's'} found` : ''}${run.rejected.length ? `. ${run.rejected.length} suggestion${run.rejected.length === 1 ? ' was' : 's were'} ignored because ${run.rejected.length === 1 ? 'it' : 'they'} did not match the chat` : ''}.`,
          type: 'decision_change',
          createdAt: run.at,
          isRead: false,
        };
        setNotificationsByUser(prev => ({ ...prev, [currentUser.id]: [notif, ...(prev[currentUser.id] || [])] }));
      }
    } finally {
      setIsAnalyzingWithMeta(false);
    }
  };

  // Process a new message through deterministic engine or Meta Model API
  const handleSendMessage = async (
    content: string,
    type: Message['type'] = 'text',
    attachment?: Attachment,
    provenance?: Message['provenance']
  ) => {
    const newMsgId = `m_${activeWorkspaceId}_${Date.now()}`;
    const newMsg: Message = {
      id: newMsgId,
      conversationId: activeWorkspaceId,
      speakerId: currentUser.id,
      speakerName: currentUser.name,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content,
      type,
      attachmentIds: attachment ? [attachment.id] : undefined,
      createdAt: Date.now(),
      ...(provenance ? { provenance } : {}),
    };

    if (attachment) {
      setAttachmentsByWs(prev => ({
        ...prev,
        [activeWorkspaceId]: {
          ...(prev[activeWorkspaceId] || {}),
          [attachment.id]: { ...attachment, sourceMessageId: newMsgId },
        },
      }));
    }

    setWorkspaces(prev => prev.map(w => (w.id === activeWorkspaceId ? { ...w, lastActivity: newMsg.timestamp } : w)));

    // Update message state
    setMessagesByWs(prev => ({
      ...prev,
      [activeWorkspaceId]: [...(prev[activeWorkspaceId] || []), newMsg],
    }));

    // Reconcile shared decisions, commitments, conflicts, and personal tasks
    const reconciled = ReconciliationEngine.processNewMessage(
      newMsg,
      currentDecisions,
      currentCommitments,
      currentConflicts,
      currentEvidence,
      currentPersonalTasks,
      currentNotifications,
      currentUserPrefs
    );

    setDecisionsByWs(prev => ({ ...prev, [activeWorkspaceId]: reconciled.decisions }));
    setCommitmentsByWs(prev => ({ ...prev, [activeWorkspaceId]: reconciled.commitments }));
    setConflictsByWs(prev => ({ ...prev, [activeWorkspaceId]: reconciled.conflicts }));
    setEvidenceByWs(prev => ({ ...prev, [activeWorkspaceId]: reconciled.evidenceMap }));
    setPersonalTasksByUser(prev => ({ ...prev, [currentUser.id]: reconciled.personalTasks }));
    setNotificationsByUser(prev => ({ ...prev, [currentUser.id]: reconciled.notifications }));
    intelRef.current = {
      decisionsByWs: { ...intelRef.current.decisionsByWs, [activeWorkspaceId]: reconciled.decisions },
      commitmentsByWs: { ...intelRef.current.commitmentsByWs, [activeWorkspaceId]: reconciled.commitments },
      conflictsByWs: { ...intelRef.current.conflictsByWs, [activeWorkspaceId]: reconciled.conflicts },
      evidenceByWs: { ...intelRef.current.evidenceByWs, [activeWorkspaceId]: reconciled.evidenceMap },
    };

    // Scroll to new message
    handleEvidenceClick(newMsgId);

    // Live mode: Meta also reads the new message in context (validated like everything else).
    if ((type === 'text' || type === 'voice_transcript') && apiKey.trim() && !isDemoMode && isScoped(activeWorkspaceId)) {
      const wsId = activeWorkspaceId;
      const transcript = [...currentMessages, newMsg].slice(-12);
      setIsAnalyzingWithMeta(true);
      runIntelligence({
        wsId,
        transcript,
        existing: reconciled.decisions,
        live: true,
        focusMessageId: newMsgId,
        messageCount: currentMessages.length + 1,
      }).finally(() => setIsAnalyzingWithMeta(false));
    }
  };

  // In-chat @Sorted assistant query handler
  const handleAskGroupOs = async (query: string) => {
    const userMsgId = `m_user_q_${Date.now()}`;
    const userMsg: Message = {
      id: userMsgId,
      conversationId: activeWorkspaceId,
      speakerId: currentUser.id,
      speakerName: currentUser.name,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: `@Sorted ${query}`,
      type: 'text',
      createdAt: Date.now(),
    };

    let botReply = '';
    let provenance: Message['provenance'];

    const participation = privacySettings.participationByWorkspace[activeWorkspaceId];
    const isPrivate = !!participation && (participation.privateOnly || !participation.invitedToParticipate);
    const scoped = isScoped(activeWorkspaceId);

    let fallbackNote: string | undefined;
    if (!apiKey.trim()) fallbackNote = 'no Meta key set';
    else if (isDemoMode) fallbackNote = 'Meta AI is off';
    else if (!scoped) fallbackNote = 'workspace out of scope';

    if (!fallbackNote) {
      try {
        // Only workspaces the user put in scope may inform the answer.
        const otherWorkspacesSummary = workspaces
          .filter((w: Workspace) => w.id !== activeWorkspaceId && isScoped(w.id))
          .map((w: Workspace) => {
            const decs = decisionsByWs[w.id] || [];
            const confs = conflictsByWs[w.id] || [];
            return {
              title: w.title,
              keyDecisions: decs.map(d => `${d.topic}: ${d.currentValue} (${d.status})`).join('; ') || 'None',
              activeConflicts: confs.filter(c => c.status === 'open').map(c => `${c.topic}: ${c.description}`).join('; ') || 'None',
            };
          });

        const metaRes = await MetaModelService.askGroupOsWithMeta(apiKey, query, {
          workspaceTitle: activeWorkspace.title,
          messages: [...currentMessages, userMsg],
          decisions: currentDecisions,
          commitments: currentCommitments,
          conflicts: currentConflicts,
          otherWorkspacesSummary,
        });

        if (metaRes.success && metaRes.data) {
          botReply = metaRes.data;
          provenance = { source: 'meta', model: metaRes.modelUsed };
          logCall({
            purpose: 'Answer a question in the group',
            workspaceId: activeWorkspaceId,
            workspaceTitle: activeWorkspace.title,
            model: metaRes.modelUsed,
            detail: `your question, the last ${Math.min(15, currentMessages.length + 1)} messages, and the tracked decisions, commitments and conflicts`,
            ok: true,
          });
        } else {
          fallbackNote = `Meta error: ${metaRes.error || 'empty reply'}`;
        }
      } catch (apiErr: any) {
        fallbackNote = `Meta error: ${apiErr?.message || 'request failed'}`;
      }
    }

    // No model reply: answer from tracked state only (labelled as a local fallback below)
    if (!botReply) {
      botReply = localGroupAnswer({
        workspaceTitle: activeWorkspace.title,
        query,
        decisions: currentDecisions,
        commitments: currentCommitments,
        conflicts: currentConflicts,
        evidenceMap: currentEvidence,
      });
    }

    if (!provenance) provenance = { source: 'local-fallback', note: fallbackNote };
    provenance = { ...provenance, visibility: isPrivate ? 'private' : 'group' };

    // Private-only mode: nothing, not even the question, is posted into the group.
    if (isPrivate) {
      setPrivateReply({
        text: botReply,
        note:
          provenance.source === 'meta'
            ? `Answered by ${provenance.model}. Visible only to you.`
            : `Local fallback (${provenance.note}). Visible only to you.`,
      });
      return;
    }

    const botMsgId = `m_os_bot_${Date.now() + 1}`;
    const botMsg: Message = {
      id: botMsgId,
      conversationId: activeWorkspaceId,
      speakerId: 'u_groupos',
      speakerName: 'Sorted',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      content: botReply,
      type: 'text',
      createdAt: Date.now() + 1,
      provenance,
    };

    setMessagesByWs(prev => ({
      ...prev,
      [activeWorkspaceId]: [...(prev[activeWorkspaceId] || []), userMsg, botMsg],
    }));

    handleEvidenceClick(botMsgId);
  };

  // Generate trip visual using Meta muse-image-1.0
  const handleGenerateVisual = async () => {
    if (!apiKey.trim()) {
      alert('Please enter your Meta API key in Settings to call muse-image-1.0 for live image generation.');
      setCurrentNav('settings');
      return;
    }

    setIsGeneratingVisual(true);
    try {
      const res = await MetaModelService.generateImageWithMeta(
        apiKey,
        'Scenic luxury SunBreeze beachfront villa in Goa with swimming pool, ocean view, and palm trees at golden hour, high-end photography'
      );

      logCall({ purpose: 'Generate an image', workspaceId: activeWorkspaceId, workspaceTitle: activeWorkspace.title, model: res.modelUsed, detail: 'a text prompt only', ok: res.success });
      if (!res.success || !res.data) {
        throw new Error(res.error || 'Failed to generate visual');
      }

      const attId = `att_img_${Date.now()}`;
      const newAtt: Attachment = {
        id: attId,
        type: 'image',
        displayName: 'SunBreeze Villa Visual Render (muse-image-1.0)',
        sourceMessageId: '',
        metadata: {
          imageUrl: res.data,
          model: 'muse-image-1.0',
        },
      };

      handleSendMessage(
        'Here is the visual rendering of SunBreeze Villa generated with Meta muse-image-1.0!',
        'image',
        newAtt
      );
    } catch (err: any) {
      alert(`Meta muse-image-1.0 error: ${err.message}\nEnsure your Meta key has access to muse-image-1.0 image generation.`);
    } finally {
      setIsGeneratingVisual(false);
    }
  };

  // Voice note: record, convert to WAV, transcribe with Meta Muse Voice. The speaker reviews the text in the app
  // before it is posted. Failures come back as plain messages for the chat screen to show (no browser pop-ups,
  // which some browsers block).
  const handleTranscribeVoiceNote = async (audio: Blob): Promise<VoiceDraft> => {
    if (!apiKey.trim()) throw new Error('Meta AI is not connected. Add your key in Settings to use voice notes.');
    if (!isScoped(activeWorkspaceId)) throw new Error('This group is not shared with Meta AI (see Privacy), so the recording was not sent.');

    const { wav, durationSec, sampleRate, levels } = await toAsrWav(audio).catch(() => {
      throw new Error('That recording could not be read. Try again, or try a different browser.');
    });
    if (durationSec < 0.4) throw new Error('That was too short. Hold the recording a little longer.');
    if (levels.peakDb < -50) throw new Error('The recording is almost silent, so the microphone is probably not picking you up. Check the input device and try again.');

    // Names and topic words help the recognizer with proper nouns it would otherwise guess at.
    const keywords = Array.from(
      new Set([
        ...activeWorkspace.participants.map(p => p.name),
        ...currentDecisions.flatMap(d => d.topic.split(/\s+/)).filter(w => w.length > 3),
        activeWorkspace.title.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim(),
      ])
    )
      .filter(Boolean)
      .slice(0, 30);

    const res = await MetaModelService.transcribeAudioWithMeta(apiKey, wav, { languageBias: getSpokenLanguages(), keywords });
    logCall({
      purpose: 'Transcribe a voice note',
      workspaceId: activeWorkspaceId,
      workspaceTitle: activeWorkspace.title,
      model: res.modelUsed,
      detail: `${durationSec.toFixed(0)}s of audio (not stored)`,
      ok: res.success,
    });
    if (!res.success || !res.data) throw new Error('Meta could not transcribe that recording right now. Please try again.');
    if (!res.data.transcript) throw new Error('No speech was heard in that recording. Try again a little closer to the microphone.');

    return {
      transcript: res.data.transcript,
      durationSec,
      model: res.modelUsed,
      detail: `${durationSec.toFixed(1)}s · ${sampleRate / 1000} kHz · peak ${levels.peakDb.toFixed(0)} dBFS${levels.gainDb > 0.5 ? ` (boosted +${levels.gainDb.toFixed(0)} dB)` : ''}`,
      audioUrl: URL.createObjectURL(audio),
    };
  };

  const handlePostVoiceNote = (draft: VoiceDraft, text: string) => {
    const transcript = text.trim();
    if (!transcript) return;
    const newAtt: Attachment = {
      id: `att_voice_${Date.now()}`,
      type: 'voice_note',
      displayName: `${currentUser.name} voice note`,
      sourceMessageId: '',
      metadata: {
        durationSec: Math.round(draft.durationSec),
        transcript,
        transcribedBy: `Transcribed by Meta AI${transcript !== draft.transcript ? ' (edited by the speaker)' : ''} · ${draft.detail}`,
        audioUrl: draft.audioUrl,
      },
    };
    handleSendMessage(transcript, 'voice_transcript', newAtt);
  };

  // Explicit human resolution of a conflict raised by the reducer
  const handleResolveConflict = (conflictId: string, choice: ConflictChoice) => {
    const wsId = activeWorkspaceId;
    const cur = intelRef.current;
    const next = resolveConflict(
      {
        decisions: cur.decisionsByWs[wsId] || [],
        commitments: cur.commitmentsByWs[wsId] || [],
        conflicts: cur.conflictsByWs[wsId] || [],
        evidenceMap: cur.evidenceByWs[wsId] || {},
        history: [],
      },
      conflictId,
      choice,
      { now: nowLabel(), actorLabel: currentUser.name }
    );
    setDecisionsByWs(prev => ({ ...prev, [wsId]: next.decisions }));
    setConflictsByWs(prev => ({ ...prev, [wsId]: next.conflicts }));
    setEvidenceByWs(prev => ({ ...prev, [wsId]: next.evidenceMap }));
  };

  const handleToggleScope = (workspaceId: string) => {
    setPrivacySettings(prev => ({
      ...prev,
      scopedWorkspaceIds: prev.scopedWorkspaceIds.includes(workspaceId)
        ? prev.scopedWorkspaceIds.filter(id => id !== workspaceId)
        : [...prev.scopedWorkspaceIds, workspaceId],
    }));
  };

  // Jump from the private screen to a quote inside its group
  const handleOpenEvidence = (workspaceId: string, messageId: string) => {
    setActiveWorkspaceId(workspaceId);
    setCurrentNav('conversations');
    setMobileTab('chat');
    setTimeout(() => handleEvidenceClick(messageId), 250);
  };

  // Private assistant: Meta over in-scope groups only; otherwise a labelled summary from real state
  const handleAskPrivateAssistant = async (query: string): Promise<void> => {
    const local = localPrivateAnswer(privateView, owe);
    const remember = (r: PrivateAnswer) =>
      setPrivateAnswers(prev => [...prev, { query, timestamp: nowLabel(), answer: r.answer, source: r.source, model: r.model, note: r.note }]);

    if (privacySettings.scopedWorkspaceIds.length === 0) return remember({ answer: local, source: 'local', note: 'no groups in scope' });
    if (!apiKey.trim()) return remember({ answer: local, source: 'local', note: 'no Meta key set' });
    if (isDemoMode) return remember({ answer: local, source: 'local', note: 'Meta AI is off' });

    const inScope = workspaces.filter(w => privacySettings.scopedWorkspaceIds.includes(w.id) && runsByWs[w.id]);
    const mine = inScope.filter(w => w.participants.some(p => p.name === currentUser.name)).map(w => w.title);
    const others = inScope.filter(w => !w.participants.some(p => p.name === currentUser.name)).map(w => w.title);
    const membershipNote = mine.length
      ? `${currentUser.name} is a member of these analyzed groups: ${mine.join(', ')}.${others.length ? ` ${currentUser.name} is not a member of: ${others.join(', ')}.` : ''}`
      : `${currentUser.name} is not a member of any analyzed group${others.length ? ` (${others.join(', ')})` : ''}, so nothing is owed because ${currentUser.name} is not part of them. Say this, and suggest changing "Viewing as".`;
    const groups = summarizeGroupsForModel(privateViewInputs);
    const res = await MetaModelService.askPrivateAssistantWithMeta(apiKey, query, {
      userName: currentUser.name,
      groups,
      money: { totalsText: owe.totalsText, owedText: owe.owedText, lines: [...owe.lines, membershipNote] },
    });
    logCall({
      purpose: 'Private assistant answer',
      model: res.modelUsed,
      detail: `your question, plus decisions, your commitments and open conflicts from ${groups.length} group${groups.length === 1 ? '' : 's'} (no chat text)`,
      ok: res.success,
    });
    if (res.success && res.data) return remember({ answer: res.data, source: 'meta', model: res.modelUsed });
    return remember({ answer: local, source: 'local', note: `Meta error: ${res.error || 'empty reply'}` });
  };

  // Re-analyze the groups whose chat changed (or was never analyzed), one after another, so the private view is live.
  const handleRefreshGroups = async (onlyIds?: string[]) => {
    if (!apiKey.trim()) {
      alert('Add your Meta API key in Settings to analyze groups live.');
      setCurrentNav('settings');
      return;
    }
    const fresh = groupFreshness(workspaces, privacySettings.scopedWorkspaceIds, runsByWs, messagesByWs);
    const targets = (onlyIds ? fresh.filter(f => onlyIds.includes(f.workspaceId) && f.messagesNow > 0) : fresh.filter(needsRefresh));
    if (targets.length === 0) return;

    setRefreshProgress({ done: 0, total: targets.length });
    try {
      for (const [i, target] of targets.entries()) {
        setRefreshProgress({ done: i, total: targets.length, current: target.title });
        const messages = messagesByWs[target.workspaceId] || [];
        await runIntelligence({
          wsId: target.workspaceId,
          transcript: messages,
          existing: intelRef.current.decisionsByWs[target.workspaceId] || [],
          live: true,
          messageCount: messages.length,
          workspaceTitle: target.title,
        });
      }
    } finally {
      setRefreshProgress(null);
    }
  };

  const handleMarkSharePaid = (decisionId: string, workspaceId: string) =>
    writeGroupState(workspaceId, markSharePaid(groupState(workspaceId), decisionId, currentUser.name, { now: nowLabel(), groupSize: workspaces.find(w => w.id === workspaceId)?.participants.length }));

  const handleSetCollector = (workspaceId: string, decisionId: string, who: string) =>
    writeGroupState(workspaceId, setCollector(groupState(workspaceId), decisionId, who));

  // Tick a reminder or notification as done. Reminders keep their id, so a done one is not added back.
  const handleToggleNotification = (id: string) =>
    setNotificationsByUser(prev => ({
      ...prev,
      [currentUser.id]: (prev[currentUser.id] || []).map(n => (n.id === id ? { ...n, isRead: !n.isRead } : n)),
    }));

  const handleClearSession = () => {
    if (window.confirm("Clear this session's analysis? The chats stay; decisions, commitments, conflicts, tasks, reminders and the request log are removed.")) {
      handlePurgeAllIntelligence();
    }
  };

  const groupState = (wsId: string): GroupIntelligenceState => ({
    decisions: intelRef.current.decisionsByWs[wsId] || [],
    commitments: intelRef.current.commitmentsByWs[wsId] || [],
    conflicts: intelRef.current.conflictsByWs[wsId] || [],
    evidenceMap: intelRef.current.evidenceByWs[wsId] || {},
    history: [],
  });

  const writeGroupState = (wsId: string, state: GroupIntelligenceState) => {
    const cur = intelRef.current;
    intelRef.current = {
      decisionsByWs: { ...cur.decisionsByWs, [wsId]: state.decisions },
      commitmentsByWs: { ...cur.commitmentsByWs, [wsId]: state.commitments },
      conflictsByWs: { ...cur.conflictsByWs, [wsId]: state.conflicts },
      evidenceByWs: { ...cur.evidenceByWs, [wsId]: state.evidenceMap },
    };
    setDecisionsByWs(prev => ({ ...prev, [wsId]: state.decisions }));
    setCommitmentsByWs(prev => ({ ...prev, [wsId]: state.commitments }));
    setConflictsByWs(prev => ({ ...prev, [wsId]: state.conflicts }));
    setEvidenceByWs(prev => ({ ...prev, [wsId]: state.evidenceMap }));
  };

  // Receipts: Spark reads the image and reports whether it agrees with the claim. It never settles the claim: a person does.
  const handleAttachReceipt = async (commitmentId: string, file: File) => {
    const wsId = activeWorkspaceId;
    const claim = groupState(wsId).commitments.find(c => c.id === commitmentId);
    if (!claim) return;
    if (!apiKey.trim()) {
      alert('Add your Meta API key in Settings to read receipts with Muse.');
      setCurrentNav('settings');
      return;
    }
    if (!isScoped(wsId)) {
      alert('This workspace is outside your assistant scope (Privacy tab), so the image was not sent to Meta.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      alert('Please attach an image (a screenshot or a photo). PDFs are not supported yet.');
      return;
    }

    setReceiptBusyId(commitmentId);
    try {
      const dataUrl = await fileToReceiptDataUrl(file);
      const read = await readReceipt(apiKey, dataUrl);
      logCall({
        purpose: 'Read a receipt image',
        workspaceId: wsId,
        workspaceTitle: activeWorkspace.title,
        model: read.modelUsed,
        detail: '1 image, shrunk first (the image is not stored)',
        ok: read.success,
      });
      const facts = read.success ? read.data ?? null : null;
      const all = Object.values(intelRef.current.commitmentsByWs).flat();
      const assessment = read.success
        ? assessReceipt(claim, facts, usedReferences(all, commitmentId))
        : { kind: 'unreadable' as const, reasons: [`Could not read the receipt: ${read.error}`] };
      writeGroupState(
        wsId,
        attachReceipt(groupState(wsId), commitmentId, facts, assessment, { now: nowLabel(), actorLabel: currentUser.name, model: read.modelUsed })
      );
    } catch (err: any) {
      alert(`Could not prepare that image: ${err.message}`);
    } finally {
      setReceiptBusyId(null);
    }
  };

  const handleConfirmPayment = (commitmentId: string) => {
    const wsId = activeWorkspaceId;
    const state = groupState(wsId);
    const claim = state.commitments.find(c => c.id === commitmentId);
    if (!claim || !canConfirm(claim, currentUser.name)) {
      alert(`Only ${claim?.payee ?? 'the recipient'} can confirm this payment.`);
      return;
    }
    writeGroupState(wsId, confirmPayment(state, commitmentId, currentUser.name, { now: nowLabel(), actorLabel: currentUser.name }));
  };

  const handleDisputePayment = (commitmentId: string) => {
    const wsId = activeWorkspaceId;
    writeGroupState(wsId, disputePayment(groupState(wsId), commitmentId, currentUser.name, { now: nowLabel(), actorLabel: currentUser.name }));
  };

  // Draft-and-approve: Muse drafts a message about one conflict; nothing is posted until the person approves it.
  const handleDraftForConflict = async (conflictId: string) => {
    const conflict = currentConflicts.find(c => c.id === conflictId);
    if (!conflict) return;
    if (!apiKey.trim()) {
      alert('Add your Meta API key in Settings to draft messages with Muse.');
      setCurrentNav('settings');
      return;
    }
    if (!isScoped(activeWorkspaceId)) {
      alert('This workspace is outside your assistant scope (Privacy tab), so nothing was sent to Meta.');
      return;
    }

    setDraftState({ conflictId, topic: conflict.topic, status: 'drafting', text: '', ungroundedFigures: [] });
    const result = await draftConflictMessage(apiKey, {
      groupTitle: activeWorkspace.title,
      senderName: currentUser.name,
      conflict: {
        topic: conflict.topic,
        description: conflict.description,
        incumbentValue: conflict.incumbentValue,
        challengerValue: conflict.challengerValue,
      },
      evidence: conflict.evidenceIds
        .map(id => currentEvidence[id])
        .filter(Boolean)
        .map(ev => ({
          speaker: currentMessages.find(m => m.id === ev.messageId)?.speakerName ?? 'Someone',
          quote: ev.quote,
          translation: ev.translation,
        })),
      relatedDecisions: currentDecisions
        .filter(d => conflict.relatedDecisionIds.includes(d.id))
        .map(d => ({ topic: d.topic, currentValue: d.currentValue, status: d.status })),
    });

    logCall({
      purpose: 'Draft a message',
      workspaceId: activeWorkspaceId,
      workspaceTitle: activeWorkspace.title,
      model: result.modelUsed,
      detail: `the conflict, ${conflict.evidenceIds.length} cited quote${conflict.evidenceIds.length === 1 ? '' : 's'} and related decisions`,
      ok: result.success,
    });
    setDraftState(prev => {
      if (!prev || prev.conflictId !== conflictId) return prev;
      return result.success && result.data
        ? { ...prev, status: 'ready', text: result.data.text, ungroundedFigures: result.data.ungroundedFigures, model: result.modelUsed }
        : { ...prev, status: 'error', error: result.error || 'The model returned nothing' };
    });
  };

  const handlePostDraft = () => {
    if (!draftState || draftState.status !== 'ready' || !draftState.text.trim()) return;
    handleSendMessage(draftState.text.trim(), 'text', undefined, {
      source: 'meta',
      model: draftState.model,
      note: `Drafted by Meta ${draftState.model}, approved by ${currentUser.name}`,
    });
    setDraftState(null);
    setCurrentNav('conversations');
    setMobileTab('chat');
  };

  // Task & Private assistant actions
  const handleToggleTask = (taskId: string) => {
    setPersonalTasksByUser(prev => {
      const userTasks = prev[currentUser.id] || [];
      return {
        ...prev,
        [currentUser.id]: userTasks.map(t =>
          t.id === taskId
            ? { ...t, status: t.status === 'completed' ? 'pending' : 'completed' }
            : t
        ),
      };
    });
  };

  const handleAddTask = (title: string, dueAt?: string) => {
    const newTask: PersonalTask = {
      id: `task_custom_${Date.now()}`,
      userId: currentUser.id,
      title,
      dueAt,
      status: 'pending',
      visibility: 'private',
      notificationEnabled: true,
      evidenceIds: [],
    };

    setPersonalTasksByUser(prev => ({
      ...prev,
      [currentUser.id]: [newTask, ...(prev[currentUser.id] || [])],
    }));
  };

  // Reminders come from what is open right now. Checking again with nothing new adds nothing.
  const handleRunDueReminders = (): string => {
    const wanted = computeReminders({
      workspaces,
      scopedIds: privacySettings.scopedWorkspaceIds,
      commitmentsByWs,
      decisionsByWs,
      evidenceByWs,
      user: currentUser,
    });
    const { notifications, added, removed } = reconcileReminderNotifications(currentNotifications, wanted, currentUser.id, nowLabel());
    if (added > 0 || removed > 0) setNotificationsByUser(prev => ({ ...prev, [currentUser.id]: notifications }));
    if (added === 0 && removed === 0) {
      return wanted.length
        ? `No new reminders. ${wanted.length} already listed.`
        : 'Nothing is due: you have no open commitments and nobody is waiting on you.';
    }
    return `${added} new reminder${added === 1 ? '' : 's'}${removed ? `, ${removed} cleared because it was resolved` : ''}.`;
  };

  const handleToggleNotificationSetting = (key: keyof UserPreferences['personalNotificationSettings']) => {
    setUserPreferencesByUser(prev => {
      const current = prev[currentUser.id] || currentUserPrefs;
      return {
        ...prev,
        [currentUser.id]: {
          ...current,
          personalNotificationSettings: {
            ...current.personalNotificationSettings,
            [key]: !current.personalNotificationSettings[key],
          },
        },
      };
    });
  };

  const handleSaveApiKey = (key: string) => {
    setApiKey(key);
    sessionStorage.setItem('meta_model_api_key', key);
    if (key.trim()) {
      setIsDemoMode(false);
      sessionStorage.setItem('group_os_demo_mode', 'false');
    }
  };

  const handleToggleDemoMode = (val: boolean) => {
    setIsDemoMode(val);
    sessionStorage.setItem('group_os_demo_mode', String(val));
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#efeae2] text-[#111b21] font-sans antialiased">
      {/* 1. Left Sidebar: Navigation, Workspaces, Mode */}
      <SidebarLeft
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        onSelectWorkspace={id => {
          setActiveWorkspaceId(id);
          setCurrentNav('conversations');
        }}
        currentNav={currentNav}
        onSelectNav={nav => setCurrentNav(nav)}
        currentUser={currentUser}
        allUsers={personaList}
        onSelectUser={u => setCurrentUser(u)}
        isDemoMode={isDemoMode}
        analysisByWorkspace={Object.fromEntries(workspaces.map(w => [w.id, runsByWs[w.id] ? `Analyzed ${runsByWs[w.id].at}` : 'Not analyzed yet']))}
        unresolvedCount={unresolvedCount}
      />

      {/* 2. Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden min-w-0">
        {/* Mobile View Toggle Bar (Only visible on mobile) */}
        {currentNav === 'conversations' && (
          <div className="md:hidden flex border-b border-[#e9edef] bg-[#f0f2f5] text-xs">
            <button
              onClick={() => setMobileTab('chat')}
              className={`flex-1 py-2.5 font-bold text-center border-b-2 transition-colors ${
                mobileTab === 'chat'
                  ? 'border-[#008069] text-[#008069] bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              💬 WhatsApp Chat
            </button>
            <button
              onClick={() => setMobileTab('intelligence')}
              className={`flex-1 py-2.5 font-bold text-center border-b-2 transition-colors flex items-center justify-center gap-1.5 ${
                mobileTab === 'intelligence'
                  ? 'border-[#008069] text-[#008069] bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              ⚡ Group Intelligence
              {unresolvedCount > 0 && (
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
              )}
            </button>
          </div>
        )}

        {/* View Switcher */}
        {currentNav === 'conversations' && (
          <div className="flex-1 flex overflow-hidden">
            {/* Center Conversation */}
            <div
              className={`flex-1 flex flex-col h-full overflow-hidden ${
                mobileTab === 'chat' ? 'block' : 'hidden md:flex'
              }`}
            >
              <ConversationCenter
                workspace={activeWorkspace}
                messages={currentMessages}
                attachments={currentAttachments}
                highlightedMessageId={highlightedMessageId}
                onSendMessage={handleSendMessage}
                onInspectEvidence={handleEvidenceClick}
                onAskGroupOs={handleAskGroupOs}
                onRunMetaExtraction={handleRunMetaExtraction}
                isAnalyzingWithMeta={isAnalyzingWithMeta}
                onGenerateVisual={handleGenerateVisual}
                isGeneratingVisual={isGeneratingVisual}
                onTranscribeVoiceNote={handleTranscribeVoiceNote}
                onPostVoiceNote={handlePostVoiceNote}
              />
            </div>

            {/* Right Sidebar Intelligence */}
            <div
              className={`w-full md:w-80 lg:w-96 h-full flex flex-col overflow-hidden border-l border-[#e9edef] ${
                mobileTab === 'intelligence' ? 'block' : 'hidden md:flex'
              }`}
            >
              <ExtractionRunCard
                run={runsByWs[activeWorkspaceId] ?? null}
                isAnalyzing={isAnalyzingWithMeta}
                privateReply={privateReply}
                onDismissPrivateReply={() => setPrivateReply(null)}
              />
              <RightSidebarIntelligence
                decisions={currentDecisions}
                commitments={currentCommitments}
                conflicts={currentConflicts}
                evidenceMap={currentEvidence}
                messages={currentMessages}
                onEvidenceClick={handleEvidenceClick}
                onExecuteResolutionAction={(actionType, conflictId) => {
                  if (['keep_current', 'adopt_proposal', 'dismiss', 'different_subject'].includes(actionType)) {
                    handleResolveConflict(conflictId, actionType as ConflictChoice);
                  }
                }}
                onDraftMessage={handleDraftForConflict}
                currentUserName={currentUser.name}
                receiptBusyId={receiptBusyId}
                onAttachReceipt={handleAttachReceipt}
                onConfirmPayment={handleConfirmPayment}
                onDisputePayment={handleDisputePayment}
                onViewFullHistory={() => setCurrentNav('decision-history')}
                workspace={workspaces.find(w => w.id === activeWorkspaceId)}
                plan={groupViews.find(v => v.ws.id === activeWorkspaceId)?.plan}
                onMarkSharePaid={decisionId => handleMarkSharePaid(decisionId, activeWorkspaceId)}
                onSetCollector={(decisionId, who) => handleSetCollector(activeWorkspaceId, decisionId, who)}
              />
            </div>
          </div>
        )}

        {currentNav === 'my-tasks' && (
          <PrivatePersonalAssistant
            currentUser={currentUser}
            workspaces={workspaces}
            scopedWorkspaceIds={privacySettings.scopedWorkspaceIds}
            onToggleScope={handleToggleScope}
            myCommitments={privateView.commitments}
            openConflicts={privateView.conflicts}
            onAsk={handleAskPrivateAssistant}
            answers={privateAnswers}
            freshness={groupFreshness(workspaces, privacySettings.scopedWorkspaceIds, runsByWs, messagesByWs)}
            refreshProgress={refreshProgress}
            onRefreshGroups={handleRefreshGroups}
            onClearSession={handleClearSession}
            restoredAt={saved?.savedAt ?? null}
            money={myMoney}
            settlement={settlement}
            plan={myPlan}
            onMarkSharePaid={handleMarkSharePaid}
            onSetCollector={handleSetCollector}
            onToggleNotification={handleToggleNotification}
            modelCalls={modelCalls}
            onOpenEvidence={handleOpenEvidence}
            personalTasks={scopedPersonalTasks}
            notifications={scopedNotifications}
            userPreferences={currentUserPrefs}
            onToggleTask={handleToggleTask}
            onAddTask={handleAddTask}
            onRunDueReminders={handleRunDueReminders}
            onToggleNotificationSetting={handleToggleNotificationSetting}
            onEvidenceClick={handleEvidenceClick}
          />
        )}

        {currentNav === 'decision-history' && (
          <DecisionHistoryView
            decisions={currentDecisions}
            evidenceMap={currentEvidence}
            messages={currentMessages}
            onInspectEvidence={handleEvidenceClick}
          />
        )}


        {currentNav === 'importer' && (
          <WhatsAppChatImporter
            onChatImported={handleChatImported}
            apiKey={apiKey}
          />
        )}

        {currentNav === 'privacy' && (
          <PrivacyAndIntegrationsView
            workspaces={workspaces}
            privacySettings={privacySettings}
            onUpdatePrivacySettings={setPrivacySettings}
            onPurgeAllIntelligence={handlePurgeAllIntelligence}
            apiKey={apiKey}
          />
        )}


        {currentNav === 'settings' && (
          <SettingsAndApiView
            isDemoMode={isDemoMode}
            onToggleDemoMode={handleToggleDemoMode}
            apiKey={apiKey}
            onSaveApiKey={handleSaveApiKey}
            serverManagedKey={serverKeyActive}
          />
        )}
      </div>
      {draftState && (
        <DraftMessageModal
          draft={draftState}
          senderName={currentUser.name}
          onTextChange={text => setDraftState(prev => (prev ? { ...prev, text } : prev))}
          onPost={handlePostDraft}
          onRedraft={() => handleDraftForConflict(draftState.conflictId)}
          onCancel={() => setDraftState(null)}
        />
      )}
    </div>
  );
}
