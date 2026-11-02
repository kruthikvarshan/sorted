import {
  Decision,
  Commitment,
  Conflict,
  Evidence,
  Message,
  DecisionHistoryEntry,
  PersonalTask,
  InAppNotification,
  UserPreferences,
} from '../types/groupOs';

export interface ReconciliationResult {
  decisions: Decision[];
  commitments: Commitment[];
  conflicts: Conflict[];
  evidenceMap: Record<string, Evidence>;
  notifications: InAppNotification[];
  personalTasks: PersonalTask[];
  impactedItems: string[];
  explanation: string;
}

export class ReconciliationEngine {
  /**
   * Reconciles new incoming messages against existing state following Section 7 & 9 rules.
   */
  static processNewMessage(
    message: Message,
    currentDecisions: Decision[],
    currentCommitments: Commitment[],
    currentConflicts: Conflict[],
    currentEvidence: Record<string, Evidence>,
    currentTasks: PersonalTask[],
    currentNotifications: InAppNotification[],
    userPrefs: UserPreferences
  ): ReconciliationResult {
    const decisions = JSON.parse(JSON.stringify(currentDecisions)) as Decision[];
    const commitments = JSON.parse(JSON.stringify(currentCommitments)) as Commitment[];
    const conflicts = JSON.parse(JSON.stringify(currentConflicts)) as Conflict[];
    const evidenceMap = { ...currentEvidence };
    const personalTasks = JSON.parse(JSON.stringify(currentTasks)) as PersonalTask[];
    const notifications = [...currentNotifications];
    const impactedItems: string[] = [];
    let explanation = '';

    const contentLower = message.content.toLowerCase();
    const timestampStr = message.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Case 1: Goa Trip - "Friday is impossible for me; Saturday is the earliest I can leave."
    if (
      message.conversationId === 'ws_goa' &&
      (contentLower.includes('earliest i can leave') ||
        (contentLower.includes('friday') && /\b(impossible|can't|cannot|can not|won't be able)\b/.test(contentLower)))
    ) {
      const dateDecision = decisions.find(d => d.topic.includes('Departure Date'));
      const newEvId = `ev_${message.id}`;
      
      evidenceMap[newEvId] = {
        id: newEvId,
        messageId: message.id,
        quote: message.content,
        sourceType: 'message',
        verificationStatus: 'supported',
        explanation: `${message.speakerName} confirmed impossible shift constraint for Friday.`,
      };

      if (dateDecision) {
        dateDecision.contradictingEvidenceIds.push(newEvId);
        dateDecision.status = 'conflicted';
        dateDecision.needsClarification = true;
        dateDecision.clarificationQuestion = `Priya confirmed Friday work makes Friday departure impossible. The group must either reschedule the non-refundable SunBreeze booking or proceed without Priya.`;
        dateDecision.lastUpdatedAt = timestampStr;
        dateDecision.updatedBy = message.speakerName;

        // Record history event explaining why it wasn't silently overwritten
        dateDecision.history.push({
          id: `h_${Date.now()}`,
          decisionId: dateDecision.id,
          previousValue: dateDecision.currentValue,
          newValue: 'Friday vs Saturday (Rigid Work Constraint Confirmed)',
          previousStatus: 'conflicted',
          newStatus: 'conflicted',
          reason: `Priya stated Friday shift is impossible. Silent overwrite prevented: SunBreeze Villa booking ($24,000) remains at risk.`,
          evidenceIds: [newEvId],
          actorType: 'system',
          timestamp: timestampStr,
        });

        impactedItems.push('att_hotel_booking', 'pt_alex_01', 'com_goa_transport');

        // Flag active conflict
        let conflict = conflicts.find(c => c.topic.includes('Departure Date'));
        if (conflict) {
          conflict.description = `Priya confirmed Friday work shift is impossible. Existing Friday booking at SunBreeze Villa (₹24,000) cannot accommodate all 5 members without rescheduling.`;
          conflict.status = 'open';
          if (!conflict.evidenceIds.includes(newEvId)) {
            conflict.evidenceIds.push(newEvId);
          }
          conflict.impactedItemIds = Array.from(new Set([...conflict.impactedItemIds, ...impactedItems]));
        }

        // Generate in-app notification for opted-in user (Alex)
        if (userPrefs.personalNotificationSettings.onConflict) {
          notifications.unshift({
            id: `notif_${Date.now()}`,
            userId: userPrefs.userId,
            conversationId: message.conversationId,
            conversationName: 'Goa Trip 🏖️',
            title: 'Critical Departure Conflict',
            message: `${message.speakerName} stated: "${message.content}". SunBreeze Villa booking and transport need immediate review.`,
            type: 'conflict',
            createdAt: timestampStr,
            isRead: false,
            evidenceMessageId: message.id,
          });
        }

        explanation = `Detected rigid constraint from ${message.speakerName}. Refused to silently overwrite Friday plan; flagged high-severity conflict on SunBreeze booking voucher.`;
      }
    }

    // Case 2: Flatmates - Payment claim without receipt
    else if (
      message.conversationId === 'ws_flat' &&
      (/\b(paid|transferred|settled|gpay|upi)\b/.test(contentLower) ||
        (/\bsent\b/.test(contentLower) && /(₹|\brs\.?\s?\d|\b\d{3,}\b)/.test(contentLower)))
    ) {
      const newEvId = `ev_${message.id}`;
      const hasReceiptAttachment = message.attachmentIds && message.attachmentIds.length > 0;

      evidenceMap[newEvId] = {
        id: newEvId,
        messageId: message.id,
        quote: message.content,
        sourceType: 'message',
        verificationStatus: hasReceiptAttachment ? 'supported' : 'claimed_unverified',
        explanation: hasReceiptAttachment
          ? 'Payment claim supported by receipt.'
          : 'Payment claimed in chat but unverified: no receipt or UTR transaction reference attached.',
      };

      const speakerCommitments = commitments.filter(c => c.conversationId === 'ws_flat' && c.ownerName === message.speakerName);
      const commitment =
        speakerCommitments.find(c => /transfer|pay|upi|split|bill/i.test(c.description)) || speakerCommitments[0];
      if (commitment) {
        commitment.status = hasReceiptAttachment ? 'completed' : 'needs_clarification';
        commitment.lastUpdatedAt = timestampStr;
        commitment.evidenceIds.push(newEvId);
      }

      explanation = hasReceiptAttachment
        ? `Payment verified with attached receipt.`
        : `Registered payment claim as 'claimed_unverified' per Rule 4 ("I paid is a claim, not verified payment without receipt").`;
    }

    // Case 3: Project Team - "Implementation complete is not ready to ship"
    else if (
      message.conversationId === 'ws_project' &&
      (contentLower.includes('pr #42') || contentLower.includes('unmerged') || contentLower.includes('blocked'))
    ) {
      const readyDecision = decisions.find(d => d.topic.includes('Deployment'));
      const newEvId = `ev_${message.id}`;
      evidenceMap[newEvId] = {
        id: newEvId,
        messageId: message.id,
        quote: message.content,
        sourceType: 'message',
        verificationStatus: 'supported',
        explanation: 'Blocked release condition identified due to unmerged backend migration PR.',
      };

      if (readyDecision) {
        readyDecision.status = 'conflicted';
        readyDecision.currentValue = 'Blocked on PR #42 (Failing Migration Checks)';
        readyDecision.supportingEvidenceIds.push(newEvId);
      }
      explanation = `Maintained strict separation between 'implementation complete' and 'ready to ship'.`;
    }

    return {
      decisions,
      commitments,
      conflicts,
      evidenceMap,
      notifications,
      personalTasks,
      impactedItems,
      explanation: explanation || `Message logged and indexed under ID ${message.id}.`,
    };
  }

  /**
   * Explicit user action to confirm Saturday departure (Demonstrating Section 5 & 9).
   */
  static confirmSaturdayDeparture(
    currentDecisions: Decision[],
    currentCommitments: Commitment[],
    currentConflicts: Conflict[],
    currentEvidence: Record<string, Evidence>,
    currentTasks: PersonalTask[],
    currentNotifications: InAppNotification[],
    userPrefs: UserPreferences
  ): ReconciliationResult {
    const decisions = JSON.parse(JSON.stringify(currentDecisions)) as Decision[];
    const commitments = JSON.parse(JSON.stringify(currentCommitments)) as Commitment[];
    const conflicts = JSON.parse(JSON.stringify(currentConflicts)) as Conflict[];
    const evidenceMap = { ...currentEvidence };
    const personalTasks = JSON.parse(JSON.stringify(currentTasks)) as PersonalTask[];
    const notifications = [...currentNotifications];
    const impactedItems = ['att_hotel_booking', 'pt_alex_01', 'com_goa_transport', 'itin_goa_card'];
    const nowTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const confirmationEvId = `ev_user_conf_${Date.now()}`;
    evidenceMap[confirmationEvId] = {
      id: confirmationEvId,
      messageId: 'user_action_confirm_sat',
      quote: 'User explicitly confirmed: Saturday departure approved for Goa trip.',
      sourceType: 'user_confirmation',
      verificationStatus: 'supported',
      explanation: 'Authorized manual resolution overriding previous disputed proposals.',
    };

    const dateDecision = decisions.find(d => d.topic.includes('Departure Date'));
    if (dateDecision) {
      const oldVal = dateDecision.currentValue;
      dateDecision.currentValue = 'Saturday departure (Confirmed by Group Vote)';
      dateDecision.status = 'confirmed';
      dateDecision.needsClarification = false;
      dateDecision.clarificationQuestion = undefined;
      dateDecision.lastUpdatedAt = nowTimestamp;
      dateDecision.updatedBy = 'Alex (Group Coordinator)';
      dateDecision.supportingEvidenceIds.push(confirmationEvId);

      // Append new history entry preserving prior Friday state
      dateDecision.history.unshift({
        id: `h_${Date.now()}`,
        decisionId: dateDecision.id,
        previousValue: oldVal,
        newValue: 'Saturday departure (Confirmed by Group Vote)',
        previousStatus: 'conflicted',
        newStatus: 'confirmed',
        reason: 'Group resolved departure conflict. Prior Friday non-refundable hotel booking flagged for urgent date modification.',
        evidenceIds: [confirmationEvId],
        actorType: 'user',
        timestamp: nowTimestamp,
      });
    }

    // Resolve date conflict
    const dateConflict = conflicts.find(c => c.topic.includes('Departure Date'));
    if (dateConflict) {
      dateConflict.status = 'resolved';
      dateConflict.resolvedAt = nowTimestamp;
    }

    // Add updated personal task for Alex
    personalTasks.unshift({
      id: `pt_reschedule_${Date.now()}`,
      userId: userPrefs.userId,
      sourceConversationId: 'ws_goa',
      title: 'Contact SunBreeze Villa management to reschedule check-in from Friday to Saturday',
      dueAt: 'Today, 6:00 PM',
      status: 'pending',
      visibility: 'private',
      reminderAt: 'Today, 5:30 PM',
      notificationEnabled: true,
      evidenceIds: [confirmationEvId],
    });

    // Notify user
    if (userPrefs.personalNotificationSettings.onDateChange) {
      notifications.unshift({
        id: `notif_${Date.now()}`,
        userId: userPrefs.userId,
        conversationId: 'ws_goa',
        conversationName: 'Goa Trip 🏖️',
        title: 'Decision Resolved: Saturday Departure',
        message: 'Saturday departure is now confirmed. SunBreeze Villa booking has been flagged for date reschedule.',
        type: 'decision_change',
        createdAt: nowTimestamp,
        isRead: false,
      });
    }

    return {
      decisions,
      commitments,
      conflicts,
      evidenceMap,
      notifications,
      personalTasks,
      impactedItems,
      explanation: 'Saturday departure confirmed. Prior Friday history preserved. SunBreeze booking flagged for reschedule.',
    };
  }
}
