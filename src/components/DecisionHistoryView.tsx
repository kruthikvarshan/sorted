import React from 'react';
import { History, ArrowRight, Clock } from 'lucide-react';
import { Decision, Evidence, Message } from '../types/groupOs';
import { evidenceLabel } from '../engine/evidenceLabel';

interface DecisionHistoryViewProps {
  decisions: Decision[];
  evidenceMap: Record<string, Evidence>;
  /** The chat, so evidence can say who said it and when. */
  messages: Message[];
  /** Jump to the message behind a piece of evidence. */
  onInspectEvidence?: (messageId: string) => void;
}

const STATUS_WORDS: Record<string, string> = {
  confirmed: 'Confirmed',
  conflicted: 'Disputed',
  proposed: 'Suggested',
  rejected: 'Turned down',
  unresolved: 'Open question',
};

const WHO_WORDS: Record<string, string> = { model: 'Meta AI', user: 'A person', system: 'Group OS' };

const statusTone = (status: string) =>
  status === 'confirmed'
    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
    : status === 'conflicted'
    ? 'bg-rose-50 text-rose-800 border-rose-200'
    : status === 'proposed'
    ? 'bg-amber-50 text-amber-800 border-amber-200'
    : 'bg-slate-100 text-slate-700 border-slate-200';

export const DecisionHistoryView: React.FC<DecisionHistoryViewProps> = ({ decisions, evidenceMap, messages, onInspectEvidence }) => {
  // Newest first. Entries keep the order they were recorded in.
  const entries = decisions
    .flatMap(d => d.history.map((h, i) => ({ ...h, decisionTopic: d.topic, order: i })))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.order - a.order);

  return (
    <div className="flex-1 bg-[#efeae2] text-slate-900 overflow-y-auto p-4 md:p-8 space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
        <div className="flex items-center gap-2 text-[#008069]">
          <History className="w-4 h-4" />
          <span className="text-xs font-bold uppercase tracking-wider">History</span>
        </div>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 mt-1.5">How decisions changed</h1>
        <p className="text-xs text-slate-600 mt-0.5">
          Every suggestion, disagreement and change in this group, newest first, with who said it and what was decided.
        </p>
      </div>

      <div className="relative pl-6 border-l-2 border-[#008069]/40 space-y-5">
        {entries.map(entry => {
          const evidence = entry.evidenceIds.map(id => evidenceMap[id]).filter(Boolean);
          return (
            <div key={entry.id} className="relative">
              <div className="absolute -left-[31px] top-2 w-3.5 h-3.5 rounded-full bg-white border-2 border-[#008069]" />
              <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-2.5 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{entry.decisionTopic}</span>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusTone(entry.newStatus)}`}>
                      {STATUS_WORDS[entry.newStatus] ?? entry.newStatus}
                    </span>
                    <span className="text-[11px] text-slate-500">{WHO_WORDS[entry.actorType] ?? entry.actorType}</span>
                  </div>
                  <span className="text-[11px] text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-400" />
                    {entry.timestamp}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                  {entry.previousValue && entry.previousValue !== entry.newValue && (
                    <>
                      <span className="line-through text-slate-400 truncate max-w-xs">{entry.previousValue}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-[#008069] shrink-0" />
                    </>
                  )}
                  <span className="text-emerald-800 font-bold truncate max-w-md">{entry.newValue}</span>
                </div>

                <div className="text-xs text-slate-600 flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 border-t border-slate-100">
                  <span className="italic">{entry.reason}</span>
                  {evidence.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <span className="text-[10px] text-slate-400 font-semibold">Said by:</span>
                      {evidence.map(ev => (
                        <button
                          key={ev.id}
                          onClick={() => onInspectEvidence?.(ev.messageId)}
                          disabled={ev.sourceType === 'user_confirmation'}
                          title={ev.translation ? `"${ev.quote}" (${ev.translation})` : `"${ev.quote}"`}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 disabled:hover:bg-slate-100 disabled:cursor-default"
                        >
                          {evidenceLabel(ev, messages)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {entries.length === 0 && (
          <div className="py-8 text-center text-xs text-slate-500 bg-white rounded-xl border border-dashed border-slate-200">
            Nothing has changed yet. Press Analyze chat in this group to start.
          </div>
        )}
      </div>
    </div>
  );
};
