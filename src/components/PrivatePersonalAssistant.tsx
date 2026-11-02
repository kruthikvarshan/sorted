import React, { useState } from 'react';
import {
  Lock,
  CheckCircle,
  Bell,
  Clock,
  Sparkles,
  Send,
  Calendar,
  AlertTriangle,
  Play,
  Sliders,
  RefreshCw,
  Trash2,
  Database,
  CheckSquare,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react';
import { PersonalTask, UserPreferences, InAppNotification, User, Workspace, ModelCall, PrivateAnswerRecord } from '../types/groupOs';
import { GroupFreshness, needsRefresh } from '../engine/freshness';
import { MyMoney, MoneyLine } from '../engine/myMoney';
import { MySettlement } from '../engine/settle';
import { MyPlan, totalsText } from '../engine/plan';
import { formatMoney } from '../engine/ledger';
import { PrivateCommitmentItem, PrivateConflictItem } from '../engine/privateView';

export interface PrivateAnswer {
  answer: string;
  source: 'meta' | 'local';
  model?: string;
  note?: string;
}

interface PrivatePersonalAssistantProps {
  currentUser: User;
  personalTasks: PersonalTask[];
  notifications: InAppNotification[];
  userPreferences: UserPreferences;
  onToggleTask: (taskId: string) => void;
  onAddTask: (title: string, dueAt?: string) => void;
  /** Returns a one-line result such as "2 new reminders" or "No new reminders". */
  onRunDueReminders: () => string;
  onToggleNotificationSetting: (key: keyof UserPreferences['personalNotificationSettings']) => void;
  onEvidenceClick: (messageId: string) => void;
  workspaces: Workspace[];
  scopedWorkspaceIds: string[];
  onToggleScope: (workspaceId: string) => void;
  myCommitments: PrivateCommitmentItem[];
  openConflicts: PrivateConflictItem[];
  onAsk: (query: string) => Promise<void>;
  answers: PrivateAnswerRecord[];
  freshness: GroupFreshness[];
  refreshProgress: { done: number; total: number; current?: string } | null;
  onRefreshGroups: (ids?: string[]) => void;
  onClearSession: () => void;
  /** ISO time the restored session was saved, when this page load began from a saved session. */
  restoredAt?: string | null;
  money: MyMoney;
  /** What you owe and are owed, group by group, netted inside each group and never between groups (computed in code). */
  settlement: MySettlement;
  /** What is scheduled for you and what you are spending, from the groups in scope. */
  plan: MyPlan;
  onMarkSharePaid: (decisionId: string, workspaceId: string) => void;
  onToggleNotification: (id: string) => void;
  modelCalls: ModelCall[];
  onOpenEvidence: (workspaceId: string, messageId: string) => void;
  onSetCollector: (workspaceId: string, decisionId: string, who: string) => void;
}

export const PrivatePersonalAssistant: React.FC<PrivatePersonalAssistantProps> = ({
  currentUser,
  personalTasks,
  notifications,
  userPreferences,
  onToggleTask,
  onAddTask,
  onRunDueReminders,
  onToggleNotificationSetting,
  onEvidenceClick,
  workspaces,
  scopedWorkspaceIds,
  onToggleScope,
  myCommitments,
  openConflicts,
  onAsk,
  answers,
  freshness,
  refreshProgress,
  onRefreshGroups,
  onClearSession,
  restoredAt,
  money,
  settlement,
  plan,
  onMarkSharePaid,
  onToggleNotification,
  modelCalls,
  onOpenEvidence,
  onSetCollector,
}) => {
  const [newTitle, setNewTitle] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [assistantQuery, setAssistantQuery] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [reminderResult, setReminderResult] = useState<string | null>(null);

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onAddTask(newTitle.trim(), newDueDate.trim() || undefined);
    setNewTitle('');
    setNewDueDate('');
  };

  const handleAskAssistant = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = assistantQuery.trim();
    if (!query || isAsking) return;
    setIsAsking(true);
    setAssistantQuery('');
    try {
      await onAsk(query);
    } finally {
      setIsAsking(false);
    }
  };

  const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  const staleOrNever = freshness.filter(needsRefresh);
  const analyzedTitles = freshness.filter(f => f.analyzedAt).map(f => f.workspaceId);
  const memberOf = (id: string) => workspaces.find(w => w.id === id)?.participants.some(p => p.name === currentUser.name) ?? false;
  const titleOf = (id: string) => workspaces.find(w => w.id === id)?.title ?? '';
  const analyzedWithMe = analyzedTitles.filter(memberOf).map(titleOf);
  const analyzedWithoutMe = analyzedTitles.filter(id => !memberOf(id)).map(titleOf);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const busy = !!refreshProgress;
  const previousBusy = React.useRef(false);
  React.useEffect(() => {
    if (previousBusy.current && !busy) setSelectedGroups([]);
    previousBusy.current = busy;
  }, [busy]);
  const chosen = selectedGroups.filter(id => freshness.some(f => f.workspaceId === id && f.messagesNow > 0));
  const toggleGroup = (id: string) => setSelectedGroups(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));

  return (
    <div className="flex-1 bg-[#efeae2] p-4 sm:p-6 space-y-6 overflow-y-auto">
      {/* Privacy Guarantee Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 shrink-0">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 tracking-tight">
                My Sorted
              </h2>
              <span className="text-[10px] font-mono bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200 font-bold">
                Viewing as {currentUser.name}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5">
              Only you can see this page: what you owe, what you promised and what needs you. Nothing here is posted to a group.
            </p>
          </div>
        </div>

        <button
          onClick={() => setReminderResult(onRunDueReminders())}
          className="px-3.5 py-2 text-xs font-bold bg-[#008069] hover:bg-[#00705c] text-white rounded-lg transition-colors flex items-center gap-1.5 self-start sm:self-center shadow-xs"
        >
          <Play className="w-3.5 h-3.5" />
          <span>Check reminders</span>
        </button>
      </div>

      {reminderResult && (
        <p role="status" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-xs">
          {reminderResult}
        </p>
      )}

      {/* Where this data comes from: nothing here is silently old */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-slate-500" /> Where this data comes from
            </h3>
            <p className="text-[11px] text-slate-600 mt-0.5" data-testid="session-origin">
              {restoredAt
                ? `Restored from this browser tab's session, saved at ${clock(restoredAt)}. Nothing was re-analyzed when the page loaded.`
                : 'A fresh session: everything below comes from analyses you ran since opening the app.'}{' '}
              Reloading or closing the tab clears it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onRefreshGroups(chosen)}
              disabled={busy || chosen.length === 0}
              className="flex items-center gap-1.5 rounded-lg border border-[#008069] bg-white px-3 py-1.5 text-xs font-bold text-[#008069] hover:bg-emerald-50 disabled:opacity-40"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Analyze selected ({chosen.length})
            </button>
            <button
              onClick={() => onRefreshGroups()}
              disabled={busy || staleOrNever.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-[#008069] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#00705c] disabled:opacity-40"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              {busy ? `Analyzing ${refreshProgress!.done + 1} of ${refreshProgress!.total}…` : `Analyze groups that changed (${staleOrNever.length})`}
            </button>
            <button
              onClick={onClearSession}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" /> Clear this session
            </button>
          </div>
        </div>

        {freshness.length === 0 ? (
          <p className="text-[11px] text-slate-500">No groups are in scope, so there is nothing to analyze.</p>
        ) : (
          <>
          <div className="flex items-center gap-3 text-[11px] text-slate-600">
            <button onClick={() => setSelectedGroups(freshness.filter(f => f.messagesNow > 0).map(f => f.workspaceId))} className="font-semibold text-[#008069] hover:underline">Select all</button>
            <button onClick={() => setSelectedGroups([])} className="font-semibold text-[#008069] hover:underline">Select none</button>
            <span>Pick groups to analyze again, even if they are up to date.</span>
          </div>
          <ul className="divide-y divide-slate-100 text-xs">
            {freshness.map(f => (
              <li key={f.workspaceId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <label className="flex items-center gap-2 min-w-0 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedGroups.includes(f.workspaceId)}
                    disabled={f.messagesNow === 0}
                    onChange={() => toggleGroup(f.workspaceId)}
                    className="rounded text-[#008069] focus:ring-[#008069] h-4 w-4"
                    aria-label={`Select ${f.title}`}
                  />
                  <span className="font-semibold text-slate-800 truncate max-w-[16rem]">{f.title}</span>
                </label>
                <span className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      f.state === 'current'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : f.state === 'unknown'
                        ? 'border-slate-200 bg-slate-50 text-slate-600'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    {f.state === 'never' && 'Not analyzed yet'}
                    {f.state === 'current' && `Up to date as of ${f.analyzedAt}`}
                    {f.state === 'stale' && `${f.newMessages} new message${f.newMessages === 1 ? '' : 's'} since ${f.analyzedAt}`}
                    {f.state === 'unknown' && `Analyzed ${f.analyzedAt}; chat text not kept, so changes can't be told`}
                  </span>
                  <button
                    onClick={() => onRefreshGroups([f.workspaceId])}
                    disabled={busy || f.messagesNow === 0}
                    className="rounded-md border border-slate-300 px-2 py-0.5 text-[10px] font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                  >
                    {f.state === 'never' ? 'Analyze' : 'Re-analyze'}
                  </button>
                </span>
              </li>
            ))}
          </ul>
          </>
        )}
      </div>

      {/* Scope: which groups this private layer may read */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3 shadow-xs">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Groups I let the assistant read</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Everything on this screen is built only from the groups ticked here. Unticking a group removes its items
              straight away and keeps it out of every model call.
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200 shrink-0">
            {scopedWorkspaceIds.length} of {workspaces.length} in scope
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {workspaces.map(w => {
            const on = scopedWorkspaceIds.includes(w.id);
            return (
              <label
                key={w.id}
                className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer text-xs transition-colors ${
                  on ? 'bg-emerald-50/50 border-emerald-200' : 'bg-slate-50 border-slate-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => onToggleScope(w.id)}
                  className="rounded text-[#008069] focus:ring-[#008069] h-4 w-4"
                />
                <span className="flex-1 min-w-0">
                  <span className="block font-bold text-slate-900 truncate">{w.title}</span>
                  <span className="block text-[11px] text-slate-500">{w.participants.length} members</span>
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Money, from my point of view */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">My money across these groups</h3>
          <div className="flex gap-6 text-right">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">You still owe</div>
              <div className="text-lg font-bold font-mono text-slate-900" data-testid="owe-total">{settlement.oweText === 'nothing' ? 'Nothing' : settlement.oweText}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">You are owed</div>
              <div className="text-lg font-bold font-mono text-emerald-700" data-testid="owed-total">{settlement.owedText === 'nothing' ? 'Nothing' : settlement.owedText}</div>
            </div>
          </div>
        </div>

        {settlement.groups.map(g => (
          <div key={g.workspaceId} className="rounded-lg border border-slate-200 p-3 space-y-2 text-xs" data-testid="group-money">
            <div className="font-bold text-slate-900">{g.title}</div>
            {g.iOwe.map(pr => (
              <div key={`o-${pr.to}-${pr.currency}`} className="space-y-1">
                <div className="text-slate-800">
                  You owe {pr.to} <span className="font-mono font-bold">{formatMoney(pr.amount, pr.currency)}</span>
                  {pr.pending && <span className="ml-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">part of it says paid, waiting for confirmation</span>}
                </div>
                <ul className="pl-3 space-y-0.5 text-[11px] text-slate-600">
                  {pr.items.map((it, k) => (
                    <li key={k} className="flex flex-wrap items-center gap-2">
                      <span>
                        {it.direction === 'owes' ? '+' : '−'} {it.reason} {formatMoney(it.amount, pr.currency)}
                        {it.direction === 'offsets' ? ` (${pr.to} owes you this)` : ''}
                        {it.state === 'claimed' ? ' · you say you paid' : ''}
                        {!it.agreed ? ' · not fully agreed yet' : ''}
                      </span>
                      {it.direction === 'owes' && it.state === 'unpaid' && it.decisionId && (
                        <button
                          onClick={() => onMarkSharePaid(it.decisionId!, g.workspaceId)}
                          className="rounded-md border border-[#008069] px-2 py-0.5 text-[10px] font-bold text-[#008069] hover:bg-emerald-50"
                        >
                          I paid this
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {g.owedToMe.map(pr => (
              <div key={`e-${pr.from}-${pr.currency}`} className="space-y-1 rounded-md bg-emerald-50 p-2">
                <div className="text-slate-800">
                  {pr.from} owes you <span className="font-mono font-bold">{formatMoney(pr.amount, pr.currency)}</span>
                </div>
                <ul className="pl-3 space-y-0.5 text-[11px] text-slate-600">
                  {pr.items.map((it, k) => (
                    <li key={k}>
                      {it.direction === 'owes' ? '+' : '−'} {it.reason} {formatMoney(it.amount, pr.currency)}
                      {it.direction === 'offsets' ? ` (you owe ${pr.from} this)` : ''}
                      {it.state === 'claimed' ? ` · ${pr.from} says paid, waiting for you to confirm` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {g.unassigned.map((d, k) =>
              d.outside ? (
                <div key={`u-${k}`} className="text-slate-700">
                  Your share of {d.reason} · <span className="font-mono font-bold">{formatMoney(d.amount, d.currency)}</span> · paid outside the group
                </div>
              ) : (
                <div key={`u-${k}`} className="rounded-md border border-sky-200 bg-sky-50 p-2 space-y-1.5" data-testid="needs-recipient">
                  <div className="text-slate-800">
                    Your share of {d.reason} is <span className="font-mono font-bold">{formatMoney(d.amount, d.currency)}</span>. Who should you pay?
                  </div>
                  <select
                    defaultValue=""
                    aria-label={`Who should be paid for ${d.reason}`}
                    onChange={e => e.target.value && d.decisionId && onSetCollector(g.workspaceId, d.decisionId, e.target.value)}
                    className="rounded border border-sky-300 bg-white px-2 py-1 text-[11px]"
                  >
                    <option value="" disabled>
                      Choose who gets paid…
                    </option>
                    {(workspaces.find(w => w.id === g.workspaceId)?.participants ?? []).filter(p => p.name !== currentUser.name).map(p => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                    <option value="outside">Someone outside the group (landlord, shop…)</option>
                  </select>
                </div>
              )
            )}
            {g.waiting.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 space-y-1 text-[11px] text-amber-900" data-testid="waiting-money">
                <div className="font-bold">Not counted yet: waiting on the group</div>
                {g.waiting.map((w, k) => (
                  <div key={`w-${k}`}>
                    <span className="font-semibold">{w.topic}</span>: {w.why}.{w.detail ? ` ${w.detail}.` : ''}
                    {w.eachAmount && w.appliesTo?.includes(currentUser.name) ? ` If it goes ahead you would owe ${formatMoney(w.eachAmount, w.currency ?? '')}.` : ''}
                    {w.messageId && (
                      <button onClick={() => onOpenEvidence(g.workspaceId, w.messageId!)} className="ml-1 underline">
                        See the message
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {!settlement.groups.length && !money.waitingOnMe.length && !money.myClaims.length ? (
          <p className="text-[11px] text-slate-500">
            {analyzedWithoutMe.length > 0 && analyzedWithMe.length === 0
              ? `${currentUser.name} is not a member of ${analyzedWithoutMe.join(', ')}, so nothing here involves ${currentUser.name}. Change "Viewing as" to someone in that group to see their money.`
              : analyzedWithMe.length === 0
              ? `No group has been analyzed yet. Analyze a group that ${currentUser.name} is in to see what ${currentUser.name} owes.`
              : `Nothing for ${currentUser.name} yet: no cost splits, money promises or payment claims involve ${currentUser.name} in ${analyzedWithMe.join(', ')}.`}
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            {([
              ['Waiting for you to confirm', money.waitingOnMe, 'border-amber-200 bg-amber-50'],
              ['Your payments waiting on the recipient', money.myClaims, 'border-slate-200 bg-slate-50'],
            ] as [string, MoneyLine[], string][]).map(([label, lines, tone]) =>
              lines.length === 0 ? null : (
                <div key={label} className={`rounded-lg border p-3 space-y-1.5 ${tone}`}>
                  <div className="font-bold text-slate-900">{label}</div>
                  {lines.map((l, i) => (
                    <div key={i} className="text-slate-700">
                      {l.counterparty ?? 'Someone'}
                      {l.amount ? <> · <span className="font-mono font-bold">{formatMoney(l.amount, l.currency)}</span></> : ''}
                      <span className="text-[10px] text-slate-500"> · {l.workspaceTitle}{l.note ? ` · ${l.note}` : ''}</span>
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* My schedule and spend, across the groups in scope */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3 shadow-xs" data-testid="my-plan">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">My schedule and spend</h3>
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">My share of group spending</div>
            <div className="text-lg font-bold font-mono text-slate-900" data-testid="spend-total">{plan.spendText === 'nothing' ? 'Nothing yet' : plan.spendText}</div>
            {plan.ifApprovedText !== 'nothing' && <div className="text-[10px] text-amber-800">plus {plan.ifApprovedText} if costs still being discussed go ahead</div>}
          </div>
        </div>

        {plan.groups.length === 0 ? (
          <p className="text-[11px] text-slate-500">
            Nothing is scheduled yet. Analyze a group you are in and its fixed dates, bookings, deadlines and costs show up here.
          </p>
        ) : (
          <>
            {plan.timeline.length > 0 && (
              <div className="rounded-lg border border-slate-200 p-3 space-y-1 text-xs">
                <div className="font-bold text-slate-900">Fixed, in order</div>
                {plan.timeline.map(i => (
                  <div key={`${i.workspaceId}-${i.id}`} className="flex flex-wrap items-baseline gap-2 text-slate-700">
                    <span className="font-mono text-[11px] font-bold text-slate-900">{i.when}</span>
                    <span>{i.owner ? `${i.owner}: ${i.title}` : i.title}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">{i.group}</span>
                    {i.messageId && (
                      <button onClick={() => onOpenEvidence(i.workspaceId, i.messageId!)} className="text-[10px] underline text-slate-500">
                        See the message
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {plan.groups.some(g => g.tentative.length > 0) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1 text-[11px] text-amber-900">
                <div className="text-xs font-bold">Not fixed yet</div>
                {plan.groups.flatMap(g => g.tentative.map(i => (
                  <div key={`${g.workspaceId}-${i.id}`}>
                    <span className="font-semibold">{i.title}</span>: {i.when} <span className="text-amber-700">({i.note}) · {g.title}</span>
                  </div>
                )))}
              </div>
            )}
            {plan.groups.some(g => g.spend.length > 0) && (
              <div className="rounded-lg border border-slate-200 p-3 space-y-1 text-xs">
                <div className="font-bold text-slate-900">Spending by group</div>
                {plan.groups.filter(g => g.spend.length > 0).map(g => (
                  <div key={g.workspaceId} className="text-slate-700">
                    {g.title}: <span className="font-mono font-bold">{totalsText(g.spend)}</span>
                    {g.ifApproved.length > 0 && <span className="text-amber-800"> (plus {totalsText(g.ifApproved)} if approved)</span>}
                  </div>
                ))}
                <div className="text-[10px] text-slate-400">Each group is counted separately. An estimate from what the chats decided, not checked against receipts.</div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Private Tasks & Assistant Q&A */}
        <div className="lg:col-span-7 space-y-6">
          {/* My commitments and open conflicts, straight from the groups in scope */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-100 bg-slate-50">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">What I owe, across my groups</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Commitments assigned to {currentUser.name}, and conflicts still open.</p>
            </div>
            <div className="divide-y divide-slate-100 p-2">
              {myCommitments.map(item => (
                <div key={item.commitment.id} className="p-3 flex items-start gap-3 text-xs">
                  <span className="text-[10px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600 font-bold shrink-0">
                    {item.workspaceTitle}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-800 font-medium leading-relaxed">{item.commitment.description}</div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                      {item.commitment.status.replace('_', ' ')}
                      {item.commitment.dueAt ? ` · due ${item.commitment.dueAt}` : ''}
                    </div>
                  </div>
                  {item.messageId && (
                    <button
                      onClick={() => onOpenEvidence(item.workspaceId, item.messageId!)}
                      className="text-[10px] text-[#008069] hover:underline font-mono font-bold shrink-0"
                    >
                      See quote
                    </button>
                  )}
                </div>
              ))}
              {openConflicts.map(item => (
                <div key={item.conflict.id} className="p-3 flex items-start gap-3 text-xs bg-rose-50/40">
                  <span className="text-[10px] bg-rose-100 px-1.5 py-0.5 rounded text-rose-700 font-bold shrink-0">
                    Disagreement · {item.workspaceTitle}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-800 font-medium">{item.conflict.topic}</div>
                    <div className="text-[11px] text-slate-600 mt-0.5">{item.conflict.description}</div>
                  </div>
                  {item.messageId && (
                    <button
                      onClick={() => onOpenEvidence(item.workspaceId, item.messageId!)}
                      className="text-[10px] text-[#008069] hover:underline font-mono font-bold shrink-0"
                    >
                      See quote
                    </button>
                  )}
                </div>
              ))}
              {myCommitments.length === 0 && openConflicts.length === 0 && (
                <div className="py-6 text-center text-xs text-slate-400">
                  {scopedWorkspaceIds.length === 0
                    ? 'No groups in scope. Tick a group above.'
                    : `Nothing assigned to ${currentUser.name} yet. Analyze a group that includes them to find commitments.`}
                </div>
              )}
            </div>
          </div>

          {/* Tasks List */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  My to-do list
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Things you add yourself
                </p>
              </div>
              <span className="text-xs font-mono font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-200">
                {personalTasks.filter((t) => t.status === 'pending').length} to do
              </span>
            </div>

            <div className="divide-y divide-slate-100 p-2">
              {personalTasks.map((task) => {
                const isCompleted = task.status === 'completed';
                return (
                  <div
                    key={task.id}
                    className="p-3 hover:bg-slate-50 rounded-lg transition-colors flex items-start gap-3"
                  >
                    <button
                      onClick={() => onToggleTask(task.id)}
                      className={`w-5 h-5 rounded-md border mt-0.5 flex items-center justify-center transition-colors ${
                        isCompleted
                          ? 'bg-[#008069] border-[#008069] text-white'
                          : 'border-slate-300 bg-white hover:border-slate-400'
                      }`}
                    >
                      {isCompleted && <CheckCircle2 className="w-3.5 h-3.5" />}
                    </button>

                    <div className="flex-1 space-y-1">
                      <div
                        className={`text-xs font-medium leading-relaxed ${
                          isCompleted ? 'line-through text-slate-400' : 'text-slate-800'
                        }`}
                      >
                        {task.title}
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 font-mono">
                        {task.dueAt && <span>Due: {task.dueAt}</span>}
                        {task.reminderAt && (
                          <span className="flex items-center gap-1 text-indigo-600 font-medium">
                            <Clock className="w-3 h-3" />
                            <span>Reminder: {task.reminderAt}</span>
                          </span>
                        )}
                        <span className="text-[10px] bg-slate-100 px-1.5 py-0.2 rounded text-slate-600 font-bold">
                          {task.visibility}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Quick Add Task */}
            <form
              onSubmit={handleCreateTask}
              className="p-3 border-t border-slate-100 bg-slate-50 flex items-center gap-2"
            >
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Add something to do..."
                className="flex-1 text-xs bg-white border border-slate-300 rounded-lg px-3 py-1.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#008069]"
              />
              <input
                type="text"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                placeholder="Due date (e.g. Tomorrow 5 PM)"
                className="w-36 text-xs bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#008069]"
              />
              <button
                type="submit"
                disabled={!newTitle.trim()}
                className="px-3.5 py-1.5 text-xs font-bold bg-[#008069] hover:bg-[#00705c] text-white rounded-lg disabled:opacity-40 transition-colors shadow-2xs"
              >
                Add
              </button>
            </form>
          </div>

          {/* Private Assistant Conversation */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3.5 shadow-xs">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
              <Sparkles className="w-4 h-4 text-indigo-600" />
              <span>Ask about my own stuff</span>
            </div>

            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
              {answers.length === 0 && (
                <p className="text-[11px] text-slate-400">
                  Ask about what you owe or what a group change means for you. Answers use only the groups in scope.
                </p>
              )}
              {answers.map((item, i) => (
                <div
                  key={i}
                  className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                    <span className="text-indigo-700 font-bold">Q: "{item.query}"</span>
                    <span>{item.timestamp}</span>
                  </div>
                  <p className="text-xs text-slate-800 leading-relaxed bg-white p-2.5 rounded border border-slate-200 font-normal whitespace-pre-wrap">
                    {item.answer}
                  </p>
                  <p className="text-[10px] font-mono text-slate-400">
                    {item.source === 'meta' ? `Answered by Meta ${item.model}` : 'Local summary (no model call)'}
                    {item.note ? ` · ${item.note}` : ''}
                  </p>
                </div>
              ))}
            </div>

            <form onSubmit={handleAskAssistant} className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={assistantQuery}
                onChange={(e) => setAssistantQuery(e.target.value)}
                placeholder="Ask what you owe, what you promised, or what changed for you..."
                className="flex-1 text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#008069]"
              />
              <button
                type="submit"
                disabled={!assistantQuery.trim() || isAsking}
                className="p-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-40 transition-colors shadow-xs"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>
        </div>

        {/* Right Column: Reminders and updates & Alert Preferences */}
        <div className="lg:col-span-5 space-y-6">
          {/* Notifications Feed */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-500" />
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  In-App Notifications
                </h3>
              </div>
              <span className="text-xs font-mono font-bold text-slate-600 bg-slate-200/60 px-2 py-0.5 rounded-full">
                {notifications.filter((n) => !n.isRead).length} to do
              </span>
            </div>

            <div className="p-3 space-y-2.5 max-h-72 overflow-y-auto">
              {[...notifications].sort((x, y) => Number(x.isRead) - Number(y.isRead)).map((notif) => (
                <div
                  key={notif.id}
                  className={`p-3 rounded-lg border text-xs space-y-1 transition-colors ${
                    notif.isRead
                      ? 'bg-slate-50 border-slate-200 text-slate-500'
                      : 'bg-emerald-50/40 border-emerald-200 text-slate-800 shadow-2xs'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={notif.isRead}
                      onChange={() => onToggleNotification(notif.id)}
                      className="mt-0.5 rounded text-[#008069] focus:ring-[#008069] h-4 w-4 shrink-0"
                      aria-label={notif.isRead ? `Mark "${notif.title}" as not done` : `Mark "${notif.title}" as done`}
                    />
                    <div className="flex-1 space-y-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className={`font-bold ${notif.isRead ? 'line-through text-slate-500' : 'text-slate-900'}`}>{notif.title}</span>
                        <span className="font-mono text-slate-400 shrink-0">{notif.createdAt}</span>
                      </div>
                      <p className={`text-[11px] leading-snug ${notif.isRead ? 'line-through text-slate-400' : 'text-slate-600'}`}>{notif.message}</p>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-slate-500">{notif.conversationName}</span>
                        {notif.evidenceMessageId && (
                          <button
                            onClick={() => onOpenEvidence(notif.conversationId, notif.evidenceMessageId!)}
                            className="text-[10px] text-[#008069] hover:underline font-bold"
                          >
                            See the message
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {notifications.length === 0 && (
                <div className="py-6 text-center text-xs text-slate-400">You're all caught up.</div>
              )}
            </div>
          </div>

          {/* Alert Controls */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 shadow-xs">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 uppercase tracking-wider">
              <Sliders className="w-4 h-4 text-slate-500" />
              <span>What should I be told about?</span>
            </div>

            <div className="space-y-2.5 text-xs">
              <label className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
                <div>
                  <div className="font-bold text-slate-900">Plans that clash</div>
                  <div className="text-[11px] text-slate-500">Tell me when a new suggestion clashes with a plan</div>
                </div>
                <input
                  type="checkbox"
                  checked={userPreferences.personalNotificationSettings.onConflict}
                  onChange={() => onToggleNotificationSetting('onConflict')}
                  className="rounded text-[#008069] focus:ring-[#008069] h-4 w-4"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
                <div>
                  <div className="font-bold text-slate-900">Date changes</div>
                  <div className="text-[11px] text-slate-500">Tell me when a date or booking changes</div>
                </div>
                <input
                  type="checkbox"
                  checked={userPreferences.personalNotificationSettings.onDateChange}
                  onChange={() => onToggleNotificationSetting('onDateChange')}
                  className="rounded text-[#008069] focus:ring-[#008069] h-4 w-4"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50 border border-slate-200 cursor-pointer">
                <div>
                  <div className="font-bold text-slate-900">Promises made to me</div>
                  <div className="text-[11px] text-slate-500">Tell me when a promise involves me</div>
                </div>
                <input
                  type="checkbox"
                  checked={userPreferences.personalNotificationSettings.onCommitmentAssigned}
                  onChange={() => onToggleNotificationSetting('onCommitmentAssigned')}
                  className="rounded text-[#008069] focus:ring-[#008069] h-4 w-4"
                />
              </label>
            </div>

            {/* Stored Preferences */}
            <div className="pt-3 border-t border-slate-100 space-y-1.5">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                Things I want remembered:
              </div>
              <ul className="text-xs text-slate-700 space-y-1 list-disc list-inside">
                {userPreferences.privatePreferences.map((pref, idx) => (
                  <li key={idx}>{pref}</li>
                ))}
                {userPreferences.privatePreferences.length === 0 && <li className="list-none text-slate-400">Nothing saved yet.</li>}
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* What left the browser */}
      <details className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-xs">
        <summary className="cursor-pointer text-xs font-bold text-slate-800 uppercase tracking-wider">
          What was sent to Meta this session ({modelCalls.length} request{modelCalls.length === 1 ? '' : 's'})
        </summary>
        <p className="mt-2 text-[11px] text-slate-500">
          Only a record of each request is kept here (what, which group, how much), never the chat text or the reply.
        </p>
        {modelCalls.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">Nothing has been sent to a Meta model yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 text-xs">
            {[...modelCalls].reverse().slice(0, 60).map(c => (
              <li key={c.id} className="py-1.5">
                <span className="font-mono text-slate-400">{c.at}</span>{' '}
                <span className={`font-semibold ${c.ok ? 'text-slate-800' : 'text-rose-700'}`}>{c.purpose}</span>
                {c.workspaceTitle ? <span className="text-slate-500"> · {c.workspaceTitle}</span> : ''}
                <div className="text-[11px] text-slate-500">
                  <span title={c.model}>Meta AI</span> · {c.detail}{c.tokens ? ` · ${c.tokens.toLocaleString()} tokens` : ''}{c.ok ? '' : ' · failed'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
};
