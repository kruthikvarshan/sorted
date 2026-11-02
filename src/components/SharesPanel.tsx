import React from 'react';
import { Receipt, Check } from 'lucide-react';
import { Commitment, Conflict, Decision, Evidence, Message, Workspace } from '../types/groupOs';
import { formatMoney } from '../engine/ledger';
import { computeGroupLedger } from '../engine/settle';
import { sameName } from '../engine/receiptVerifier';

interface SharesPanelProps {
  workspace: Workspace;
  decisions: Decision[];
  commitments: Commitment[];
  currentUserName?: string;
  conflicts?: Conflict[];
  evidenceMap?: Record<string, Evidence>;
  messages?: Message[];
  onMarkPaid?: (decisionId: string) => void;
  onSetCollector?: (decisionId: string, who: string) => void;
  onSeeMessage?: (messageId: string) => void;
}

/** Splitwise-style view for one group: who owes whom after netting, with the bills behind each amount. */
export const SharesPanel: React.FC<SharesPanelProps> = ({ workspace, decisions, commitments, currentUserName, conflicts, evidenceMap, messages, onMarkPaid, onSetCollector, onSeeMessage }) => {
  const ledger = computeGroupLedger(workspace, decisions, commitments, { conflicts, evidenceMap, messages });
  if (ledger.pairs.length === 0 && ledger.unassigned.length === 0 && ledger.waiting.length === 0) return null;
  const me = currentUserName ?? '';

  return (
    <div className="space-y-2" data-testid="group-shares">
      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
        <Receipt className="w-3.5 h-3.5 text-[#008069]" /> Who owes what
      </h4>
      <p className="text-[11px] text-slate-500">
        What people owe each other in this group, with what they owe back already deducted. A payment only counts once a person confirms it.
      </p>

      {ledger.pairs.map(pair => {
        const mine = sameName(me, pair.from) === true;
        return (
          <div key={`${pair.from}-${pair.to}-${pair.currency}`} className="rounded-lg border border-slate-200 bg-white p-3 shadow-xs" data-testid={`owes-${pair.from}-${pair.to}`}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-bold text-slate-900">
                {mine ? 'You' : pair.from} {mine ? 'owe' : 'owes'} {sameName(me, pair.to) === true ? 'you' : pair.to}
              </span>
              <span className="text-xs font-bold font-mono text-rose-700">{formatMoney(pair.amount, pair.currency)}</span>
            </div>
            <ul className="mt-1.5 space-y-1">
              {pair.items.map((it, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-[11px] text-slate-700">
                  <span className="min-w-0">
                    {it.direction === 'owes' ? '+' : '−'} <span className="font-semibold">{it.reason}</span> {formatMoney(it.amount, pair.currency)}
                    {it.direction === 'offsets' ? ` (${pair.to} owes ${pair.from} this)` : ''}
                    {it.state === 'claimed' && <span className="ml-1 text-amber-700">· says paid, waiting to be confirmed</span>}
                    {!it.agreed && <span className="ml-1 text-slate-500">· not fully agreed yet</span>}
                  </span>
                  {mine && it.direction === 'owes' && it.state === 'unpaid' && it.decisionId && onMarkPaid && (
                    <button
                      onClick={() => onMarkPaid(it.decisionId!)}
                      className="shrink-0 inline-flex items-center gap-1 rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Check className="w-3 h-3" /> I paid this
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}

      {ledger.unassigned.map((d, i) =>
        d.outside ? (
          <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 text-[11px] text-slate-700">
            {d.from}'s share of <span className="font-semibold">{d.reason}</span> is {formatMoney(d.amount, d.currency)}, paid outside the group.
          </div>
        ) : null
      )}

      {Array.from(new Map(ledger.unassigned.filter(d => d.needsRecipient && d.decisionId).map(d => [d.decisionId!, d])).values()).map(d => (
        <div key={d.decisionId} className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-[11px] text-sky-950 space-y-1.5" data-testid="needs-recipient">
          <div className="font-bold">Who should be paid for {d.reason}?</div>
          <div>Everyone's share is {formatMoney(d.amount, d.currency)}, but nobody said who collects it. Pick the person, or say it goes outside the group.</div>
          {onSetCollector && (
            <select
              defaultValue=""
              aria-label={`Who should be paid for ${d.reason}`}
              onChange={e => e.target.value && onSetCollector(d.decisionId!, e.target.value)}
              className="rounded border border-sky-300 bg-white px-2 py-1 text-[11px]"
            >
              <option value="" disabled>
                Choose who gets paid…
              </option>
              {workspace.participants.map(p => (
                <option key={p.id} value={p.name}>
                  {p.name}
                </option>
              ))}
              <option value="outside">Someone outside the group (landlord, shop…)</option>
            </select>
          )}
        </div>
      ))}

      {ledger.waiting.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-900 space-y-1.5" data-testid="waiting-money">
          <div className="font-bold">Not counted yet: waiting on the group</div>
          {ledger.waiting.map((w, i) => (
            <div key={i}>
              <span className="font-semibold">{w.topic}</span>: {w.why}.{w.detail ? ` ${w.detail}.` : ''}
              {w.eachAmount ? ` If it goes ahead, each person pays ${formatMoney(w.eachAmount, w.currency ?? '')}.` : ''}
              {w.messageId && onSeeMessage && (
                <button onClick={() => onSeeMessage(w.messageId!)} className="ml-1 underline">
                  See the message
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
