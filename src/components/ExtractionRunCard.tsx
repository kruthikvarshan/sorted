import React, { useState } from 'react';
import { Sparkles, Cpu, ShieldAlert, Loader2, X, Lock } from 'lucide-react';
import { IntelligenceRun } from '../types/groupOs';

interface ExtractionRunCardProps {
  run: IntelligenceRun | null;
  isAnalyzing: boolean;
  privateReply: { text: string; note?: string } | null;
  onDismissPrivateReply: () => void;
}

/** Shows exactly what the last analysis did: which engine ran, what was kept, what was rejected and why. */
export const ExtractionRunCard: React.FC<ExtractionRunCardProps> = ({
  run,
  isAnalyzing,
  privateReply,
  onDismissPrivateReply,
}) => {
  const [showRejected, setShowRejected] = useState(false);

  if (!run && !isAnalyzing && !privateReply) return null;

  return (
    <div className="border-b border-[#e9edef] bg-white px-3 py-2.5 text-[11px] space-y-2">
      {privateReply && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 p-2.5">
          <div className="flex items-center justify-between gap-2 font-bold text-violet-800">
            <span className="flex items-center gap-1">
              <Lock className="w-3 h-3" /> Private reply (not posted to the group)
            </span>
            <button onClick={onDismissPrivateReply} aria-label="Dismiss private reply">
              <X className="w-3 h-3" />
            </button>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-slate-800">{privateReply.text}</p>
          {privateReply.note && <p className="mt-1 text-[10px] text-slate-500">{privateReply.note}</p>}
        </div>
      )}

      {isAnalyzing && (
        <div className="flex items-center gap-1.5 text-slate-600">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the conversation…
        </div>
      )}

      {run && (
        <div>
          <div className="flex items-center gap-1.5 font-bold text-slate-800">
            {run.source === 'meta' ? (
              <Sparkles className="w-3.5 h-3.5 text-purple-600" />
            ) : (
              <Cpu className="w-3.5 h-3.5 text-amber-600" />
            )}
            <span title={run.model ? `Model: ${run.model}` : undefined}>
              {run.source === 'meta' ? 'Read by Meta AI' : 'Read offline (Meta AI was not used)'}
            </span>
            <span className="font-normal text-slate-400">{run.at}</span>
          </div>
          <p
            className="mt-0.5 text-slate-600"
            title={[run.rounds ? `${run.rounds} round${run.rounds === 1 ? '' : 's'}` : '', run.tokens ? `${run.tokens.prompt + run.tokens.completion} tokens` : ''].filter(Boolean).join(' · ') || undefined}
          >
            {run.created} new · {run.updated} changed · {run.reinforced} confirmed again · {run.unchanged} no change ·{' '}
            {run.conflictsRaised} disagreement{run.conflictsRaised === 1 ? '' : 's'} found
          </p>
          {run.note && <p className="mt-0.5 text-amber-700">{run.note}</p>}
          {run.created + run.updated + run.reinforced + run.conflictsRaised === 0 && (
            <p className="mt-0.5 font-medium text-emerald-700">Nothing new: everything in this reading was already known.</p>
          )}
          {run.snapshot && (
            <p className="mt-1 rounded bg-slate-50 px-2 py-1 text-slate-700">
              <span className="font-semibold">Right now:</span> {run.snapshot.decisions} decision{run.snapshot.decisions === 1 ? '' : 's'} ·{' '}
              {run.snapshot.commitments} promise{run.snapshot.commitments === 1 ? '' : 's'} ({run.snapshot.openCommitments} still open) ·{' '}
              {run.snapshot.openConflicts} open disagreement{run.snapshot.openConflicts === 1 ? '' : 's'} ·{' '}
              {run.snapshot.unverifiedClaims} payment{run.snapshot.unverifiedClaims === 1 ? '' : 's'} waiting to be confirmed
            </p>
          )}
          {run.changes.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-slate-700">
              {run.changes.map((c, i) => (
                <li key={i} className="truncate" title={c.label}>
                  <span className="mr-1 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-500">
                    {{ created: 'New', updated: 'Changed', reinforced: 'Seen again', conflict_raised: 'Disagreement' }[c.outcome]}
                  </span>
                  {c.label.replace(/^Commitment by /, 'Promise by ')}
                </li>
              ))}
            </ul>
          )}
          {run.rejected.length > 0 && (
            <div className="mt-1">
              <button
                onClick={() => setShowRejected(v => !v)}
                className="flex items-center gap-1 font-semibold text-rose-700"
              >
                <ShieldAlert className="w-3 h-3" />
                {run.rejected.length} suggestion{run.rejected.length === 1 ? '' : 's'} from Meta AI {run.rejected.length === 1 ? 'was' : 'were'} ignored because {run.rejected.length === 1 ? 'it' : 'they'} did not match the chat
              </button>
              {showRejected && (
                <ul className="mt-1 space-y-1">
                  {run.rejected.map((r, i) => (
                    <li key={i} className="rounded border border-rose-100 bg-rose-50 p-1.5 text-slate-700">
                      <span className="font-medium">{r.summary}</span>
                      <br />
                      <span className="text-rose-700">{r.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
