import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  ShieldAlert,
  ArrowRight,
  ExternalLink,
  History,
  UserCheck,
  ChevronRight,
  Sparkles,
  Check,
} from 'lucide-react';
import { Decision, Commitment, Conflict, Evidence, Message, Workspace } from '../types/groupOs';
import { evidenceLabel } from '../engine/evidenceLabel';
import { formatMoney } from '../engine/ledger';
import { LedgerPanel } from './LedgerPanel';
import { SharesPanel } from './SharesPanel';
import { PlanPanel } from './PlanPanel';
import { GroupPlan } from '../engine/plan';

interface RightSidebarIntelligenceProps {
  decisions: Decision[];
  commitments: Commitment[];
  conflicts: Conflict[];
  evidenceMap: Record<string, Evidence>;
  onEvidenceClick: (messageId: string) => void;
  onExecuteResolutionAction?: (actionType: string, conflictId: string) => void;
  /** The chat, so evidence can say who said it and when instead of showing ids. */
  messages: Message[];
  onDraftMessage?: (conflictId: string) => void;
  currentUserName?: string;
  receiptBusyId?: string | null;
  onAttachReceipt?: (commitmentId: string, file: File) => void;
  onConfirmPayment?: (commitmentId: string) => void;
  onDisputePayment?: (commitmentId: string) => void;
  onViewFullHistory?: () => void;
  workspace?: Workspace;
  plan?: GroupPlan;
  onMarkSharePaid?: (decisionId: string) => void;
  onSetCollector?: (decisionId: string, who: string) => void;
}

const COMMITMENT_WORDS: Record<string, string> = {
  proposed: 'Maybe',
  accepted: 'Promised',
  in_progress: 'In progress',
  completed: 'Done',
  cancelled: 'Taken back',
  needs_clarification: 'Not confirmed',
  overdue: 'Overdue',
};

export const RightSidebarIntelligence: React.FC<RightSidebarIntelligenceProps> = ({
  decisions,
  commitments,
  conflicts,
  evidenceMap,
  onEvidenceClick,
  onExecuteResolutionAction,
  messages,
  onDraftMessage,
  currentUserName,
  receiptBusyId,
  onAttachReceipt,
  onConfirmPayment,
  onDisputePayment,
  onViewFullHistory,
  workspace,
  plan,
  onMarkSharePaid,
  onSetCollector,
}) => {
  const activeConflicts = conflicts.filter((c) => c.status === 'open');

  const getStatusBadge = (status: Decision['status']) => {
    switch (status) {
      case 'confirmed':
        return (
          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-[#008069]" />
            Confirmed
          </span>
        );
      case 'conflicted':
        return (
          <span className="text-[10px] font-bold text-rose-800 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            Disputed
          </span>
        );
      case 'proposed':
        return (
          <span className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full flex items-center gap-1">
            <Clock className="w-3 h-3 text-amber-600" />
            Suggested
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-bold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full flex items-center gap-1">
            <HelpCircle className="w-3 h-3 text-slate-500" />
            Open question
          </span>
        );
    }
  };

  return (
    <aside className="w-full lg:w-80 xl:w-96 bg-white border-l border-[#e9edef] flex flex-col h-full overflow-y-auto shrink-0 shadow-xs">
      {/* Header */}
      <div className="p-3.5 border-b border-[#e9edef] bg-[#f0f2f5] flex items-center justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#008069]" />
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              What this group has settled
            </h3>
          </div>
          <p className="text-[11px] text-slate-500 mt-0.5">Decisions, promises and money from the chat</p>
        </div>
        {onViewFullHistory && (
          <button
            onClick={onViewFullHistory}
            className="text-[11px] font-semibold text-[#008069] hover:underline flex items-center gap-1"
          >
            <History className="w-3 h-3" />
            <span>History</span>
          </button>
        )}
      </div>

      <div className="p-4 space-y-5">
        {/* Active Conflict Spotlight Banner */}
        {activeConflicts.length > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 space-y-2.5 shadow-2xs">
            <div className="flex items-center gap-2 text-xs font-bold text-rose-800">
              <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Needs your attention</span>
            </div>

            {activeConflicts.map((conf) => (
              <div key={conf.id} className="space-y-2 text-xs">
                <div className="text-slate-900 font-bold">{conf.topic}</div>
                <p className="text-[11px] text-rose-900 leading-relaxed bg-white/80 p-2.5 rounded border border-rose-200">
                  {conf.description}
                </p>

                {onDraftMessage && (
                  <button
                    onClick={() => onDraftMessage(conf.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-purple-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-purple-800 hover:bg-purple-50"
                  >
                    <Sparkles className="w-3 h-3" /> Draft a message to the group
                  </button>
                )}

                {/* Evidence citations */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[10px] text-slate-500 font-semibold">Said by:</span>
                  {conf.evidenceIds.map((evId) => {
                    const ev = evidenceMap[evId];
                    if (!ev) return null;
                    return (
                      <button
                        key={ev.id}
                        onClick={() => onEvidenceClick(ev.messageId)}
                        title={ev.translation ? `"${ev.quote}" (${ev.translation})` : `"${ev.quote}"`}
                        className="text-[10px] px-2 py-0.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded shadow-2xs transition-colors flex items-center gap-1"
                      >
                        <span>{evidenceLabel(ev, messages)}</span>
                        <ExternalLink className="w-2.5 h-2.5 text-slate-400" />
                      </button>
                    );
                  })}
                </div>

                {/* Resolution buttons */}
                {conf.resolutionOptions && conf.resolutionOptions.length > 0 && onExecuteResolutionAction && (
                  <div className="pt-2 space-y-1.5 border-t border-rose-200/80">
                    <div className="text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                      How should this be settled?
                    </div>
                    {[
                      ...conf.resolutionOptions,
                      // Conflicts stored before this option existed still offer it.
                      ...(conf.challengerValue && !conf.resolutionOptions.some(o => o.actionType === 'different_subject')
                        ? [{ label: 'These are different things', actionType: 'different_subject', description: 'Not a contradiction: keep both. The new value becomes its own item.' }]
                        : []),
                    ].map((opt, i) => (
                      <button
                        key={i}
                        onClick={() => onExecuteResolutionAction(opt.actionType, conf.id)}
                        className="w-full text-left p-2 rounded-lg bg-white hover:bg-emerald-50 border border-slate-200 hover:border-emerald-300 transition-colors shadow-2xs"
                      >
                        <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                          <span>{opt.label}</span>
                          <ArrowRight className="w-3 h-3 text-[#008069]" />
                        </div>
                        <p className="text-[10px] text-slate-500 mt-0.5">{opt.description}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Group Decisions Matrix */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Decisions ({decisions.length})
            </h4>
          </div>

          {decisions.length === 0 ? (
            <div className="text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
              Nothing has been settled yet. Press Analyze chat to read this conversation.
            </div>
          ) : (
            decisions.map((dec) => (
              <div
                key={dec.id}
                className={`p-3 rounded-xl border transition-all shadow-2xs ${
                  dec.status === 'conflicted'
                    ? 'border-rose-300 bg-rose-50/40'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <span className="text-xs font-bold text-slate-900">{dec.topic}</span>
                  {getStatusBadge(dec.status)}
                </div>

                <p className="text-xs text-slate-700 leading-snug mt-1 font-medium">
                  {dec.currentValue}
                </p>
                {dec.split && (
                  <p className="mt-1 text-[11px] font-semibold text-[#008069]">
                    {dec.split.perPerson > 0 ? `Each person pays ${formatMoney(dec.split.perPerson, dec.split.currency ?? '')}` : `Total ${formatMoney(dec.split.total ?? 0, dec.split.currency ?? '')}, shared`}
                    {dec.split.collector ? `, to ${dec.split.collector}` : ''}
                    {dec.split.among === 'everyone' ? '' : ` (${dec.split.among.join(', ')})`}
                  </p>
                )}

                {/* Who said it, and a jump to the message */}
                {dec.supportingEvidenceIds.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1 text-[10px]">
                    <span className="text-slate-400">Said by:</span>
                    {dec.supportingEvidenceIds.map(evId => evidenceMap[evId]).filter(Boolean).map(ev => (
                      <button
                        key={ev.id}
                        onClick={() => onEvidenceClick(ev.messageId)}
                        title={ev.translation ? `"${ev.quote}" (${ev.translation})` : `"${ev.quote}"`}
                        className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] transition-colors"
                      >
                        {evidenceLabel(ev, messages)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {plan && <PlanPanel plan={plan} currentUserName={currentUserName} onSeeMessage={onEvidenceClick} />}

        {workspace && (
          <SharesPanel
            workspace={workspace}
            decisions={decisions}
            commitments={commitments}
            currentUserName={currentUserName}
            conflicts={conflicts}
            evidenceMap={evidenceMap}
            messages={messages}
            onMarkPaid={onMarkSharePaid}
            onSetCollector={onSetCollector}
            onSeeMessage={onEvidenceClick}
          />
        )}

        <LedgerPanel
          commitments={commitments}
          currentUserName={currentUserName}
          busyId={receiptBusyId}
          onAttachReceipt={onAttachReceipt}
          onConfirmPayment={onConfirmPayment}
          onDisputePayment={onDisputePayment}
        />

        {/* Commitments & Responsibilities */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Promises ({commitments.length})
            </h4>
          </div>

          {commitments.length === 0 ? (
            <div className="text-center py-6 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
              No promises found yet.
            </div>
          ) : (
            commitments.map((comm) => (
              <div
                key={comm.id}
                className="p-3 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-[#008069]" />
                    {comm.ownerName}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      comm.status === 'completed'
                        ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {COMMITMENT_WORDS[comm.status] ?? comm.status}
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-snug">{comm.description}</p>
                {(comm.payee || comm.amount || comm.dueAt) && (
                  <p className="text-[11px] text-slate-500">
                    {comm.amount ? `${formatMoney(comm.amount, comm.currency ?? '')}${comm.payee ? ` to ${comm.payee}` : ''}` : comm.payee ? `To ${comm.payee}` : ''}
                    {comm.dueAt ? `${comm.amount || comm.payee ? ' · ' : ''}due ${comm.dueAt}` : ''}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
};
