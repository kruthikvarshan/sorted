import React, { useEffect, useState } from 'react';
import { AlertTriangle, Bell, CalendarClock, CheckSquare, ChevronDown, Square, Wallet } from 'lucide-react';
import { api } from './api';

/**
 * The detail half of My Group OS, for the groups it follows: money group by group (with the bills behind every amount,
 * never netted across groups), reminders, your promises as a to-do list, and what is coming up. All worked out in code.
 */

interface Details {
  money: { roomId: string; group: string; with: string; direction: 'owe' | 'owed'; amount: number; currency: string; items: { reason: string; amount: number; kind: string }[]; pending: boolean }[];
  unassigned: { roomId: string; group: string; reason: string; amount: number; currency: string }[];
  schedule: { roomId: string; group: string; when: string; title: string; mine: boolean }[];
  tasks: { roomId: string; group: string; description: string; status: string; due?: string; to?: string }[];
  reminders: { roomId: string; group: string; kind: string; text: string }[];
}

const fmt = (a: number, c: string) => `${c || '₹'}${a.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const DONE = 'groupos_done';
const loadDone = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(DONE) ?? '[]'));
  } catch {
    return new Set();
  }
};

const Card: React.FC<{ icon: React.ReactNode; title: string; count?: number; children: React.ReactNode; testid?: string }> = ({ icon, title, count, children, testid }) => (
  <div className="overflow-hidden rounded-2xl bg-white shadow-sm" data-testid={testid}>
    <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
      {icon} {title}
      {count !== undefined && <span className="ml-auto rounded-full bg-slate-100 px-1.5 text-slate-600">{count}</span>}
    </div>
    <div className="divide-y divide-slate-100">{children}</div>
  </div>
);

export const MyDetails: React.FC<{ go: (path: string) => void; refresh: number }> = ({ go, refresh }) => {
  const [d, setD] = useState<Details | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [done, setDone] = useState(loadDone);

  useEffect(() => {
    let stop = false;
    const load = () =>
      api
        .details(api.scopedSeats())
        .then(r => !stop && (setD(r as Details), setFailed(false)))
        .catch(() => !stop && setFailed(true));
    load();
    const t = setInterval(load, 8000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [refresh]);

  const toggle = (key: string) => {
    const next = new Set(done);
    next.has(key) ? next.delete(key) : next.add(key);
    setDone(next);
    try {
      localStorage.setItem(DONE, JSON.stringify([...next]));
    } catch {
      /* fine */
    }
  };

  if (!d)
    return (
      <div className="rounded-2xl bg-white px-4 py-6 text-center text-xs text-slate-500 shadow-sm">
        {failed ? 'Could not load your reminders and money just now. Retrying…' : 'Loading your reminders, money and plans…'}
      </div>
    );
  const groups = [...new Set(d.money.map(m => m.group))];
  return (
    <>
      <Card icon={<Bell className="w-3.5 h-3.5" />} title="Reminders" count={d.reminders.length} testid="reminders">
        {d.reminders.length === 0 && <p className="px-4 py-3 text-xs text-slate-500">Nothing needs you right now.</p>}
        {d.reminders.slice(0, 12).map((r, i) => (
          <button key={i} onClick={() => go(`/live/${r.roomId}`)} className="flex w-full items-start gap-2 px-4 py-2.5 text-left text-xs hover:bg-slate-50">
            <span className="mt-0.5">{r.kind === 'pay' ? '💸' : r.kind === 'confirm' ? '✅' : r.kind === 'promise' ? '🤝' : r.kind === 'recipient' ? '❓' : '⚠️'}</span>
            <span className="flex-1">
              <span className="text-slate-800">{r.text}</span>
              <span className="block text-[10px] text-slate-400">{r.group}</span>
            </span>
          </button>
        ))}
      </Card>

      <Card icon={<Wallet className="w-3.5 h-3.5" />} title="Who owes whom, group by group" testid="money-detail">
        {groups.length === 0 && <p className="px-4 py-3 text-xs text-slate-500">Nothing owed either way in the groups you follow.</p>}
        {groups.map(g => (
          <div key={g} className="px-4 py-2.5 space-y-1.5">
            <div className="text-xs font-bold text-slate-900">{g}</div>
            {d.money.filter(m => m.group === g).map(m => {
              const key = `${g}|${m.with}`;
              return (
                <div key={key} className="rounded-lg border border-slate-100">
                  <button onClick={() => setOpen(open === key ? null : key)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs">
                    <span className="flex-1">
                      {m.direction === 'owe' ? <>You owe <b>{m.with}</b></> : <><b>{m.with}</b> owes you</>}
                      {m.pending && <span className="ml-1 text-[10px] text-amber-700">· part says paid</span>}
                    </span>
                    <span className={`font-mono font-bold ${m.direction === 'owe' ? 'text-rose-700' : 'text-emerald-700'}`}>{fmt(m.amount, m.currency)}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open === key ? 'rotate-180' : ''}`} />
                  </button>
                  {open === key && (
                    <ul className="space-y-0.5 border-t border-slate-100 px-2.5 py-1.5 text-[11px] text-slate-600">
                      {m.items.map((it, i) => <li key={i}>{it.reason}</li>)}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {d.unassigned.length > 0 && (
          <div className="px-4 py-2.5 text-[11px] text-slate-600">
            {d.unassigned.map((u, i) => (
              <div key={i}>❓ {u.group}: your share of {u.reason} is {fmt(u.amount, u.currency)}, with no one named to receive it yet.</div>
            ))}
          </div>
        )}
        <p className="px-4 py-2 text-[10px] text-slate-400">Inside a group, if you and someone owe each other, only the difference is shown. Money in one group never cancels out money in another.</p>
      </Card>

      <Card icon={<CheckSquare className="w-3.5 h-3.5" />} title="Your to-do (promises you made)" count={d.tasks.filter(t => !done.has(`${t.roomId}|${t.description}`)).length} testid="tasks">
        {d.tasks.length === 0 && <p className="px-4 py-3 text-xs text-slate-500">You have no open promises.</p>}
        {d.tasks.map((t, i) => {
          const key = `${t.roomId}|${t.description}`;
          const ticked = done.has(key);
          return (
            <button key={i} onClick={() => toggle(key)} className="flex w-full items-start gap-2 px-4 py-2 text-left text-xs hover:bg-slate-50">
              {ticked ? <CheckSquare className="mt-0.5 w-3.5 h-3.5 text-[#008069]" /> : <Square className="mt-0.5 w-3.5 h-3.5 text-slate-400" />}
              <span className="flex-1">
                <span className={ticked ? 'text-slate-400 line-through' : 'text-slate-800'}>{t.description}</span>
                <span className="block text-[10px] text-slate-400">{t.group}{t.due ? ` · by ${t.due}` : ''}</span>
              </span>
            </button>
          );
        })}
      </Card>

      <Card icon={<CalendarClock className="w-3.5 h-3.5" />} title="Coming up across your groups" count={d.schedule.length} testid="schedule">
        {d.schedule.length === 0 && <p className="px-4 py-3 text-xs text-slate-500">Nothing fixed yet.</p>}
        {d.schedule.slice(0, 15).map((s, i) => (
          <button key={i} onClick={() => go(`/live/${s.roomId}`)} className="flex w-full items-baseline gap-2 px-4 py-2 text-left text-xs hover:bg-slate-50">
            <span className="w-28 shrink-0 font-mono text-[11px] font-bold text-slate-900">{s.when}</span>
            <span className="flex-1 text-slate-700">{s.title}<span className="block text-[10px] text-slate-400">{s.group}</span></span>
            {s.mine && <AlertTriangle className="w-3 h-3 text-amber-600" />}
          </button>
        ))}
      </Card>
    </>
  );
};
