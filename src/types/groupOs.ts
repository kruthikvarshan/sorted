export type MessageType = 'text' | 'image' | 'voice_transcript' | 'system';

export type DecisionStatus = 'proposed' | 'confirmed' | 'rejected' | 'conflicted' | 'unresolved';

export type CommitmentStatus =
  | 'proposed'
  | 'accepted'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'overdue'
  | 'needs_clarification';

export type VerificationStatus = 'supported' | 'claimed_unverified' | 'contradicted';

export interface User {
  id: string;
  name: string;
  avatarColor: string;
  role?: string;
  isCurrentUser?: boolean;
}

export interface Attachment {
  id: string;
  type: 'booking' | 'itinerary' | 'voice_note' | 'receipt' | 'spec' | 'image';
  displayName: string;
  sourceMessageId: string;
  metadata: Record<string, any>;
  previewData?: any;
}

export interface Message {
  id: string;
  conversationId: string;
  speakerId: string;
  speakerName: string;
  timestamp: string;
  content: string;
  type: MessageType;
  attachmentIds?: string[];
  createdAt: number;
  /** Set on assistant-authored messages so the UI can show where the text really came from. */
  provenance?: MessageProvenance;
}

export interface MessageProvenance {
  source: 'meta' | 'local-fallback' | 'local-heuristic';
  model?: string;
  /** Why a fallback was used (e.g. API error, demo mode, workspace out of scope). */
  note?: string;
  visibility?: 'group' | 'private';
}

export interface Evidence {
  id: string;
  messageId: string;
  quote: string;
  sourceType: 'message' | 'attachment' | 'user_confirmation';
  verificationStatus: VerificationStatus;
  explanation: string;
  /** English meaning when the quote is in another language (model-written, not verified). */
  translation?: string;
}

export interface DecisionHistoryEntry {
  id: string;
  decisionId: string;
  previousValue?: string;
  newValue: string;
  previousStatus?: DecisionStatus;
  newStatus: DecisionStatus;
  reason: string;
  evidenceIds: string[];
  actorType: 'user' | 'system' | 'model';
  timestamp: string;
}

/** What each person pays, when a decision is a cost split ("9000 each", "per head"). */
export interface SplitTerms {
  /** What each person pays. 0 when only the total was stated and the head count is not known yet. */
  perPerson: number;
  /** The whole bill, when the chat states a total to be shared. */
  total?: number;
  currency?: string;
  /** "everyone" = every member of the group, otherwise the named people. */
  among: 'everyone' | string[];
  /** Who collects the money, when the chat says. */
  collector?: string;
  /** The money goes to someone outside the group (a landlord, a shop), so nobody in the group collects it. */
  outside?: boolean;
}

export interface Decision {
  id: string;
  conversationId: string;
  topic: string;
  currentValue: string;
  status: DecisionStatus;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  confidence: number;
  lastUpdatedAt: string;
  updatedBy: string;
  history: DecisionHistoryEntry[];
  split?: SplitTerms;
  /** The topic this belongs to, when the chat was read with topics. */
  topicId?: string;
  needsClarification?: boolean;
  clarificationQuestion?: string;
}

export interface Commitment {
  id: string;
  conversationId: string;
  ownerId: string;
  ownerName: string;
  description: string;
  dueAt?: string;
  status: CommitmentStatus;
  evidenceIds: string[];
  lastUpdatedAt: string;
  /** For money commitments: who receives it and how much. Owner is the person who pays. */
  payee?: string;
  amount?: number;
  currency?: string;
  /** Where a payment claim stands. Only a person can move it to "confirmed"; a receipt is evidence, not the verdict. */
  verification?: PaymentVerification;
  /** Set when this is someone paying their share of a split decision. */
  shareOfDecisionId?: string;
  topicId?: string;
}

export interface ReceiptFacts {
  amount: number | null;
  currency: string | null;
  payer: string | null;
  payee: string | null;
  reference: string | null;
  date: string | null;
  status: string | null;
  summary: string;
}

export interface PaymentVerification {
  state: 'receipt_consistent' | 'receipt_mismatch' | 'receipt_unreadable' | 'receipt_duplicate' | 'confirmed' | 'disputed';
  /** Why the receipt does or does not agree with the claim. */
  reasons: string[];
  /** What the model read from the image. The image itself is never stored. */
  receipt?: ReceiptFacts;
  readBy?: string;
  /** Who concluded, and on what basis. */
  decidedBy?: string;
  decidedAt?: string;
  basis?: 'receipt' | 'recipient_only';
}

export interface Conflict {
  id: string;
  topicId?: string;
  conversationId: string;
  topic: string;
  description: string;
  relatedDecisionIds: string[];
  evidenceIds: string[];
  impactedItemIds: string[];
  status: 'open' | 'resolved' | 'dismissed';
  createdAt: string;
  resolvedAt?: string;
  /** For decision conflicts: the confirmed value and the value that challenged it. */
  incumbentValue?: string;
  challengerValue?: string;
  resolutionOptions?: {
    label: string;
    actionType: string;
    description: string;
  }[];
}

export interface PersonalTask {
  id: string;
  userId: string;
  sourceConversationId?: string;
  sourceCommitmentId?: string;
  title: string;
  dueAt?: string;
  status: 'pending' | 'completed';
  visibility: 'private';
  reminderAt?: string;
  notificationEnabled: boolean;
  evidenceIds: string[];
}

export interface UserPreferences {
  userId: string;
  privatePreferences: string[];
  personalNotificationSettings: {
    onConflict: boolean;
    onCommitmentAssigned: boolean;
    onDateChange: boolean;
    onReminderDue: boolean;
  };
}

export interface InAppNotification {
  id: string;
  userId: string;
  conversationId: string;
  conversationName: string;
  title: string;
  message: string;
  type: 'conflict' | 'task' | 'reminder' | 'decision_change';
  createdAt: string;
  isRead: boolean;
  evidenceMessageId?: string;
}

export interface PrivacyScopeSettings {
  scopedWorkspaceIds: string[];
  participationByWorkspace: Record<
    string,
    {
      invitedToParticipate: boolean;
      privateOnly: boolean;
      allowProactiveAlerts: boolean;
    }
  >;
  retentionPolicy: 'transient_session' | 'decisions_commitments_only' | 'full_intelligence';
  webhookEndpoint: string;
  webhookStatus: 'active' | 'simulated';
  zeroRawStorage: boolean;
}

export interface Workspace {
  id: string;
  title: string;
  category: string;
  description: string;
  participants: User[];
  unreadCount: number;
  lastActivity: string;
  iconName: string;
  isCustomImported?: boolean;
}

export interface GroupIntelligenceState {
  decisions: Decision[];
  commitments: Commitment[];
  conflicts: Conflict[];
  evidenceMap: Record<string, Evidence>;
  history: DecisionHistoryEntry[];
  /** What the chat is about, thread by thread. Present once a chat has been read with topics. */
  topics?: Topic[];
  /** How many messages (from the start of the chat) have been read, so the next run reads only new ones. */
  readThrough?: number;
  /** How the results were made when a chat was read in advance: the real numbers from that read. */
  readBy?: { model: string; at: number; messages: number; calls: number; tokens: number; ms: number };
}

export type TopicKind = 'trip' | 'bills' | 'event' | 'purchase' | 'plan' | 'other';

/** One thread of a group chat ("Goa trip, Nov 2026", "October rent"). Messages are tagged to topics one by one. */
export interface Topic {
  id: string;
  title: string;
  kind: TopicKind;
  status: 'open' | 'closed';
  messageIds: string[];
  people: string[];
  /** Epoch ms of the first and latest message. */
  firstAt: number;
  lastAt: number;
  summary?: string;
}

export interface RejectedProposal {
  summary: string;
  reason: string;
}

/** Outcome of one extraction pass, shown to the user so nothing about the model's work is hidden. */
export interface IntelligenceRun {
  id: string;
  source: 'meta' | 'local-heuristic';
  model?: string;
  at: string;
  workspaceId: string;
  rounds?: number;
  tokens?: { prompt: number; completion: number };
  created: number;
  updated: number;
  /** Seen again with new supporting evidence. */
  reinforced: number;
  /** Already known, nothing new. */
  unchanged: number;
  conflictsRaised: number;
  changes: { label: string; outcome: 'created' | 'updated' | 'reinforced' | 'conflict_raised' }[];
  rejected: RejectedProposal[];
  note?: string;
  /** How many messages the chat had when this was analyzed, so later messages can be flagged as not yet analyzed. */
  messageCount?: number;
  /** Where the group stands after this run, so a re-run that changes nothing still shows the current picture. */
  snapshot?: {
    decisions: number;
    commitments: number;
    openCommitments: number;
    openConflicts: number;
    unverifiedClaims: number;
  };
}

/** One request sent to a Meta model. Only metadata is kept: never the chat text or the answer. */
export interface ModelCall {
  id: string;
  at: string;
  purpose: string;
  workspaceId?: string;
  workspaceTitle?: string;
  model: string;
  /** What left the browser, in plain words, e.g. "24 messages" or "1 image (not stored)". */
  detail: string;
  tokens?: number;
  ok: boolean;
}

export interface PrivateAnswerRecord {
  query: string;
  timestamp: string;
  answer: string;
  source: 'meta' | 'local';
  model?: string;
  note?: string;
}
