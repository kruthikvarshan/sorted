import React from 'react';
import { CalendarClock, Wallet } from 'lucide-react';
import { GroupPlan, totalsText } from '../engine/plan';
import { sameName } from '../engine/receiptVerifier';

interface PlanPanelProps {
  plan: GroupPlan;
  currentUserName?: string;
  onSeeMessage?: (messageId: string) => void;
}

/** What the group has fixed on the schedule, what is not fixed yet, and what it is spending. */
export const PlanPanel: React.FC<PlanPanelProps> = ({ plan, currentUserName, onSeeMessage }) => {
  const { fixed, tentative, due, spend } = plan;
  if (!fixed.length && !tentative.length && !due.length && !spend.groupTotals.length) return null;
  const me = spend.byPerson.find(p => sameName(currentUserName ?? '', p.name) === true);

  const see = (id?: string) =>
    id && onSeeMessage ? (
      <button onClick={() => onSeeMessage(id)} className="ml-1 text-[10px] underline text-slate-500">
        See the message
      </button>
    ) : null;

  return (
    <div className="space-y-2" data-testid="group-plan">
      <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
        <CalendarClock className="w-3.5 h-3.5 text-[#008069]" /> Plan and spend
      </h4>

      {fixed.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1 shadow-xs">
          <div className="text-[11px] font-bold text-slate-900">Fixed</div>
          {fixed.map(i => (
            <div key={i.id} className="text-[11px] text-slate-700">
              <span className="font-semibold">{i.title}</span>: {i.when}
              {see(i.messageId)}
            </div>
          ))}
        </div>
      )}

      {tentative.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
          <div className="text-[11px] font-bold text-amber-900">Not fixed yet</div>
          {tentative.map(i => (
            <div key={i.id} className="text-[11px] text-amber-900">
              <span className="font-semibold">{i.title}</span>: {i.when} <span className="text-amber-700">({i.note})</span>
              {see(i.messageId)}
            </div>
          ))}
        </div>
      )}

      {due.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1 shadow-xs">
          <div className="text-[11px] font-bold text-slate-900">Due</div>
          {due.map(i => (
            <div key={i.id} className="text-[11px] text-slate-700">
              <span className="font-semibold">{i.owner}</span>: {i.title} · {i.when}
            </div>
          ))}
        </div>
      )}

      {spend.groupTotals.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1 shadow-xs" data-testid="group-spend">
          <div className="text-[11px] font-bold text-slate-900 flex items-center gap-1">
            <Wallet className="w-3 h-3 text-[#008069]" /> Spend
          </div>
          <div className="text-[11px] text-slate-700">The group's shared costs add up to <span className="font-bold font-mono">{totalsText(spend.groupTotals)}</span>.</div>
          {me && (
            <div className="text-[11px] text-slate-700">
              Your share: <span className="font-bold font-mono">{totalsText(me.totals)}</span>
              {me.ifApproved.length > 0 && <span className="text-amber-800"> (plus {totalsText(me.ifApproved)} if the costs still being discussed go ahead)</span>}
            </div>
          )}
          <ul className="text-[11px] text-slate-600 space-y-0.5">
            {spend.byPerson.map(p => (
              <li key={p.name}>
                {p.name}: {totalsText(p.totals)}
              </li>
            ))}
          </ul>
          <div className="text-[10px] text-slate-400">An estimate from what the chat decided. It is not checked against receipts.</div>
        </div>
      )}
    </div>
  );
};
