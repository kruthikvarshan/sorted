import React, { useState } from 'react';
import { AlertTriangle, Bell, CheckCircle2, ChevronDown, CircleDot, Clock, Lock, Loader2, MessageCircle, Send, Wallet, X } from 'lucide-react';
import type { Panel as PanelData, TopicCard } from '../engine/panel';
import { formatMoney } from '../engine/ledger';
import { Person, phoneText, upiLink, whatsappPayLink } from './api';
import { PrivateChat } from './PrivateChat';

interface PanelProps {
  panel: PanelData;
  me: Person;
  members: Person[];
  onClose?: () => void;
  onJump: (messageId: string) => void;
  onPaid: (to: string, amount: number, currency: string) => void;
  onSaveMe: (patch: { phone?: string; upi?: string }) => Promise<void>;
  /** Which tab is open; the room controls it so the header's "My Group OS" button can open it. */
  tab?: Tab;
  onTab?: (t: Tab) => void;
  onPlan?: (topicId: string) => Promise<void>;
  /** Group OS is still reading: topics found so far are shown even before their results are in. */
  reading?: boolean;
  /** Example group: made-up people, so no real numbers can be added. */
  example?: boolean;
  onAddPerson?: (name: string, phone: string) => Promise<{ ok: boolean; message: string }>;
  onRemind?: (name: string, send?: boolean) => Promise<{ ok: boolean; message: string; preview?: string; ready?: boolean }>;
  /** For example groups: the real numbers of the read that made these results, and watching it read again. */
  readBy?: { model: string; at: number; messages: number; calls: number; tokens: number; ms: number };
  onReadFromScratch?: () => Promise<string | undefined>;
}

/** How an example group's results were made: a real read by Muse Spark, with its numbers. */
const HowRead: React.FC<{ readBy?: PanelProps['readBy']; onReadFromScratch?: PanelProps['onReadFromScratch'] }> = ({ readBy, onReadFromScratch }) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  return (
    <div className="rounded-xl border border-[#008069]/20 bg-[#e7f6f2] p-3 text-[11px] text-slate-700 space-y-1.5" data-testid="how-read">
      <div className="font-bold text-slate-900">Example group · made-up people</div>
      {readBy ? (
        <p>
          Read by Meta's <b>{readBy.model}</b> on {new Date(readBy.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: {readBy.messages.toLocaleString('en-IN')} messages, {readBy.calls} Meta calls, {Math.round(readBy.tokens / 1000).toLocaleString('en-IN')}k tokens, {Math.round(readBy.ms / 60000)} min. The newest messages were read live when you joined.
        </p>
      ) : (
        <p>Read in advance by Meta's Muse Spark; the newest messages were read live when you joined.</p>
      )}
      {onReadFromScratch && (
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setNote((await onReadFromScratch()) ?? '');
            setBusy(false);
          }}
          className="w-full rounded-lg border border-[#008069] bg-white py-1.5 text-[12px] font-bold text-[#008069] disabled:opacity-50"
          data-testid="read-from-scratch"
        >
          {busy ? 'Starting…' : '🔁 Watch Group OS read this whole group from scratch'}
        </button>
      )}
      {note && <p className="text-rose-700">{note}</p>}
    </div>
  );
};

/** "I paid this": asks once, then posts the payment to the chat a single time. */
const PaidButton: React.FC<{ to: string; amount: number; currency: string; onPaid: (to: string, amount: number, currency: string) => void | Promise<void> }> = ({ to, amount, currency, onPaid }) => {
  const [stage, setStage] = useState<'idle' | 'ask' | 'busy' | 'done'>('idle');
  if (stage === 'done') return <span className="rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">Posted in the chat ✓ {to} confirms it</span>;
  if (stage === 'ask' || stage === 'busy')
    return (
      <span className="flex flex-wrap items-center gap-1.5 text-[11px]">
        Paid {to} {formatMoney(amount, currency)}?
        <button disabled={stage === 'busy'} onClick={async () => { setStage('busy'); await onPaid(to, amount, currency); setStage('done'); }} className="rounded-md bg-[#008069] px-2.5 py-1 font-bold text-white disabled:opacity-50">Yes, I paid</button>
        <button disabled={stage === 'busy'} onClick={() => setStage('idle')} className="rounded-md border border-slate-300 px-2.5 py-1 font-semibold text-slate-600">Not yet</button>
      </span>
    );
  return (
    <button onClick={() => setStage('ask')} className="rounded-md border border-[#008069] px-2.5 py-1 text-[11px] font-semibold text-[#008069]">
      I paid this
    </button>
  );
};

/** A WhatsApp reminder to one person: first shows exactly what will be sent, and sends only when you press Send. */
const RemindButton: React.FC<{ name: string; onRemind: NonNullable<PanelProps['onRemind']> }> = ({ name, onRemind }) => {
  const [busy, setBusy] = useState(false);
  const [r, setR] = useState<{ ok: boolean; message: string; preview?: string; ready?: boolean } | null>(null);
  const run = async (send: boolean) => {
    setBusy(true);
    setR(await onRemind(name, send).catch(e => ({ ok: false, message: e.message as string })));
    setBusy(false);
  };
  return (
    <span className="flex flex-col gap-1">
      {!r?.ready && !(r?.ok && !r.ready) && (
        <button disabled={busy} onClick={() => run(false)} className="inline-flex w-fit items-center gap-1 rounded-md border border-[#25d366] px-2.5 py-1 text-[11px] font-semibold text-[#128c4b] disabled:opacity-50" data-testid="remind">
          <Bell className="w-3 h-3" /> {busy ? 'One moment…' : `Remind ${name} on WhatsApp`}
        </button>
      )}
      {r && (
        <span className={`text-[11px] ${r.ok ? 'text-slate-700' : 'text-rose-700'}`}>
          {r.message}
          {r.preview && <pre className="mt-1 whitespace-pre-wrap rounded-lg border border-slate-200 bg-[#dcf8c6]/60 p-2 font-sans text-[11px] text-slate-800" data-testid="remind-preview">{r.preview}</pre>}
        </span>
      )}
      {r?.ready && (
        <span className="flex gap-1.5">
          <button disabled={busy} onClick={() => run(true)} className="rounded-md bg-[#25d366] px-3 py-1 text-[11px] font-bold text-white disabled:opacity-50" data-testid="remind-send">{busy ? 'Sending…' : 'Send'}</button>
          <button disabled={busy} onClick={() => setR(null)} className="rounded-md border border-slate-300 px-3 py-1 text-[11px] font-semibold text-slate-600">Cancel</button>
        </span>
      )}
    </span>
  );
};

/** Who is in the group, and adding someone (or their number) so the group shows up when they log in. */
const People: React.FC<{ me: Person; members: Person[]; example?: boolean; onAdd?: (name: string, phone: string) => Promise<{ ok: boolean; message: string }>; onRemind?: PanelProps['onRemind'] }> = ({ me, members, example, onAdd, onRemind }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const others = members.filter(m => m.id !== me.id);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 text-xs" data-testid="people">
      <div className="font-bold text-slate-900">People in this group</div>
      {example && <p className="rounded-md bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600">This is an example group. The people in it are made up, so nobody can join as them or get messages.</p>}
      <ul className="divide-y divide-slate-100">
        {others.map(m => (
          <li key={m.id} className="space-y-1 py-1.5">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-semibold text-slate-800">{m.name}</span>
              <span className="text-[10px] text-slate-500">
                {example ? 'example person' : m.joined ? `joined${m.phone ? ` · ${phoneText(m.phone)}` : ''}` : m.phone ? `added · ${phoneText(m.phone)} · joins when they log in` : 'no number yet'}
              </span>
              {!example && !m.joined && !m.phone && onAdd && <button onClick={() => { setName(m.name); setNote(null); }} className="rounded-full border border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-[#008069]">Add number</button>}
            </div>
            {!example && m.phone && onRemind && <RemindButton name={m.name} onRemind={onRemind} />}
          </li>
        ))}
      </ul>
      {!example && onAdd && (
        <div className="space-y-1.5 rounded-lg bg-slate-50 p-2">
          <div className="text-[11px] font-semibold text-slate-700">Add a person (or their number)</div>
          <div className="flex gap-1.5">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="w-1/3 rounded-md border border-slate-300 px-2 py-1.5" />
            <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="+91 98765 43210" className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5" />
            <button
              disabled={busy || !name.trim() || phone.replace(/\D/g, '').length < 10}
              onClick={async () => {
                setBusy(true);
                const r = await onAdd(name, phone);
                setNote(r);
                setBusy(false);
                if (r.ok) {
                  setName('');
                  setPhone('');
                }
              }}
              className="rounded-md bg-[#008069] px-3 py-1.5 font-bold text-white disabled:opacity-40"
              data-testid="add-person"
            >
              {busy ? '…' : 'Add'}
            </button>
          </div>
          {note && <p className={`text-[11px] ${note.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{note.message}</p>}
          <p className="text-[10px] text-slate-400">When they log in to Group OS with this number, this group is theirs, as themselves.</p>
        </div>
      )}
    </div>
  );
};

export type Tab = 'topics' | 'money' | 'me';
const KIND_ICON: Record<string, string> = { trip: '🏖️', bills: '🏠', event: '🎉', purchase: '🛍️', plan: '🗓️', other: '📌', general: '💬' };
const ago = (ms: number) => {
  if (!ms) return '';
  const d = Math.round((Date.now() - ms) / 86400000);
  if (ms > Date.now()) return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 31 ? `${d} days ago` : new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

const Section: React.FC<{ title: string; children: React.ReactNode; tone?: string }> = ({ title, children, tone = 'text-slate-500' }) => (
  <div className="space-y-1">
    <div className={`text-[10px] font-bold uppercase tracking-wide ${tone}`}>{title}</div>
    {children}
  </div>
);

const TopicView: React.FC<{ t: TopicCard; onJump: (id: string) => void; reading?: boolean; onPlan?: (topicId: string) => Promise<void> }> = ({ t, onJump, reading, onPlan }) => {
  const [planning, setPlanning] = useState(false);
  const [open, setOpen] = useState(false);
  const owed = t.money.length;
  return (
    <div className={`rounded-xl border bg-white shadow-xs ${t.status === 'closed' ? 'border-slate-200 opacity-80' : 'border-slate-200'}`} data-testid="topic-card">
      <button onClick={() => setOpen(!open)} className="w-full flex items-start gap-2 p-3 text-left">
        <span className="text-lg leading-none mt-0.5">{KIND_ICON[t.kind] ?? '📌'}</span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="font-semibold text-[13px] text-slate-900 truncate">{t.title}</span>
            {t.status === 'closed' && <span className="text-[9px] font-bold uppercase text-slate-400">done</span>}
          </span>
          {t.summary && <span className="block text-[11px] text-slate-500 line-clamp-2">{t.summary}</span>}
          <span className="mt-1 flex flex-wrap gap-1.5 text-[10px]">
            {t.decided.length > 0 && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800">✓ {t.decided.length} decided</span>}
            {t.open.length > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">{t.open.length} open</span>}
            {t.disagreements.length > 0 && <span className="rounded bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700">⚠ {t.disagreements.length} disagreement{t.disagreements.length === 1 ? '' : 's'}</span>}
            {owed > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800">💸 {owed} owed</span>}
            {reading && !t.decided.length && !t.money.length && !t.open.length && <span className="rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-700">reading…</span>}
            <span className="text-slate-400">{t.messageCount ? `${t.messageCount} msgs · ` : ''}{ago(t.lastAt)}</span>
          </span>
        </span>
        <ChevronDown className={`w-4 h-4 text-slate-400 mt-1 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-slate-100 p-3 space-y-3 text-[12px] text-slate-700">
          {t.disagreements.length > 0 && (
            <Section title="Needs the group" tone="text-rose-600">
              {t.disagreements.map(d => (
                <div key={d.id} className="flex gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                  <span>
                    <b>{d.topic}:</b> {d.description}
                    {d.messageId && <button onClick={() => onJump(d.messageId!)} className="ml-1 text-[10px] underline text-slate-500">see</button>}
                  </span>
                </div>
              ))}
            </Section>
          )}
          {t.decided.length > 0 && (
            <Section title="Decided" tone="text-emerald-700">
              {t.decided.map((d, i) => (
                <div key={i} className="flex gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <b>{d.topic}:</b> {d.value}
                    {d.messageId && <button onClick={() => onJump(d.messageId!)} className="ml-1 text-[10px] underline text-slate-500">see</button>}
                  </span>
                </div>
              ))}
            </Section>
          )}
          {t.open.length > 0 && (
            <Section title="Not settled yet">
              {t.open.map((d, i) => (
                <div key={i} className="flex gap-1.5">
                  <CircleDot className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <span>
                    <b>{d.topic}:</b> {d.value} <span className="text-slate-400">({d.why})</span>
                  </span>
                </div>
              ))}
            </Section>
          )}
          {t.money.length > 0 && (
            <Section title="Who owes whom" tone="text-amber-700">
              {t.money.map((m, i) => (
                <div key={i}>
                  <div>
                    <b>{m.from}</b> owes <b>{m.to}</b> <span className="font-mono font-bold">{formatMoney(m.amount, m.currency)}</span>
                    {m.pending && <span className="ml-1 text-[10px] text-amber-700">· part says paid</span>}
                  </div>
                  <div className="pl-2 text-[11px] text-slate-500">{m.reasons.join('  ')}</div>
                </div>
              ))}
            </Section>
          )}
          {t.waiting.length > 0 && (
            <Section title="Not counted yet" tone="text-amber-700">
              {t.waiting.map((w, i) => (
                <div key={i} className="text-[11px]">
                  <b>{w.topic}</b>: {w.why}
                  {w.detail ? `. ${w.detail}` : ''}
                  {w.eachAmount ? ` If it goes ahead: ${formatMoney(w.eachAmount, w.currency ?? '')} each.` : ''}
                </div>
              ))}
            </Section>
          )}
          {t.promises.length > 0 && (
            <Section title="Promises">
              {t.promises.slice(0, 8).map((p, i) => (
                <div key={i} className="text-[11px]">
                  <b>{p.owner}</b>: {p.description} <span className="text-slate-400">({p.status.replace('_', ' ')}{p.due ? `, by ${p.due}` : ''})</span>
                </div>
              ))}
            </Section>
          )}
          {t.spend && <div className="text-[11px] text-slate-500">Shared costs in this topic: <b className="font-mono">{t.spend}</b></div>}
          {t.kind === 'trip' && onPlan && (
            <button
              onClick={async () => {
                setPlanning(true);
                try {
                  await onPlan(t.id);
                } finally {
                  setPlanning(false);
                }
              }}
              disabled={planning}
              className="w-full rounded-lg border border-[#008069] py-1.5 text-[12px] font-bold text-[#008069] disabled:opacity-50"
              data-testid="plan-trip"
            >
              🧭 Plan this trip (ideas with links from the web)
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export const LivePanel: React.FC<PanelProps> = ({ panel, me, members, onClose, onJump, onPaid, onSaveMe, tab: shown, onTab, reading, onPlan, example, onAddPerson, onRemind, readBy, onReadFromScratch }) => {
  const [own, setOwn] = useState<Tab>('topics');
  const tab = shown ?? own;
  const setTab = (t: Tab) => (onTab ? onTab(t) : setOwn(t));
  const [phone, setPhone] = useState(me.phone ?? '');
  const [upi, setUpi] = useState(me.upi ?? '');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const person = (name: string) => members.find(m => m.name.toLowerCase() === name.toLowerCase());
  const mine = panel.settle.filter(s => s.from.toLowerCase() === me.name.toLowerCase());
  const toMe = panel.settle.filter(s => s.to.toLowerCase() === me.name.toLowerCase());
  // Threads with nothing decided, owed, promised or disputed are folded away so the panel shows what matters.
  const empty = (t: TopicCard) => !reading && !t.decided.length && !t.open.length && !t.disagreements.length && !t.money.length && !t.promises.length && !t.waiting.length;
  const open = panel.topics.filter(t => t.status === 'open' && !empty(t));
  const closed = panel.topics.filter(t => t.status === 'closed' && !empty(t));
  const quiet = panel.topics.filter(empty);

  return (
    <div className="flex h-full flex-col bg-[#f7f5f2]">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex gap-1">
          {(['topics', 'money', 'me'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 text-xs font-semibold ${tab === t ? 'bg-[#008069] text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {t === 'topics' ? `Topics (${open.length})` : t === 'money' ? 'Money' : '🔒 My Group OS'}
            </button>
          ))}
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close panel" className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {tab === 'topics' && (
          <>
            {example && <HowRead readBy={readBy} onReadFromScratch={onReadFromScratch} />}
            {panel.topics.length === 0 && reading && <p className="p-4 text-center text-xs text-slate-500">Group OS is sorting the chat into topics. They appear here as they are found.</p>}
            {panel.topics.length === 0 && !reading && <p className="p-4 text-center text-xs text-slate-500">Nothing yet. As the group talks, Group OS sorts the chat into topics here: trips, bills, plans, each with what's decided and who owes whom.</p>}
            {open.map(t => <TopicView key={t.id} t={t} onJump={onJump} reading={reading} onPlan={onPlan} />)}
            {closed.length > 0 && <div className="pt-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">Finished</div>}
            {closed.map(t => <TopicView key={t.id} t={t} onJump={onJump} onPlan={onPlan} />)}
            {quiet.length > 0 && (
              <details className="pt-2">
                <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-wide text-slate-400">Other threads ({quiet.length})</summary>
                <div className="mt-2 space-y-2">{quiet.map(t => <TopicView key={t.id} t={t} onJump={onJump} />)}</div>
              </details>
            )}
          </>
        )}

        {tab === 'money' && (
          <div className="space-y-3" data-testid="money-tab">
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                <Wallet className="w-4 h-4 text-[#008069]" /> Settle up
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">All topics together. If two people owe each other, only the difference is shown, and the payments below are the fewest that clear everything.</p>
              {panel.settle.length === 0 && <p className="mt-2 text-xs text-emerald-700 font-semibold">Everyone is settled. 🎉</p>}
              {panel.owes.length > 0 && (
                <div className="mt-2 rounded-lg bg-slate-50 p-2" data-testid="who-owes-whom">
                  <div className="text-[11px] font-bold text-slate-700">Who owes whom</div>
                  <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
                    {panel.owes.map((o, i) => (
                      <li key={i} className="flex justify-between gap-2">
                        <span><b>{o.from.toLowerCase() === me.name.toLowerCase() ? 'You' : o.from}</b> → <b>{o.to.toLowerCase() === me.name.toLowerCase() ? 'you' : o.to}</b></span>
                        <span className="font-mono">{formatMoney(o.amount, o.currency)}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 text-[11px] font-bold text-slate-700">Simplest way to settle</div>
                </div>
              )}
              <ul className="mt-2 space-y-2">
                {panel.settle.map((s, i) => {
                  const isMine = s.from.toLowerCase() === me.name.toLowerCase();
                  const payee = person(s.to);
                  const note = `Group OS: settling up with ${s.to}`;
                  return (
                    <li key={i} className={`rounded-lg border p-2 ${isMine ? 'border-[#008069] bg-emerald-50/50' : 'border-slate-200'}`} data-testid="settle-row">
                      <div className="text-xs">
                        <b>{isMine ? 'You' : s.from}</b> → <b>{s.to.toLowerCase() === me.name.toLowerCase() ? 'you' : s.to}</b>{' '}
                        <span className="font-mono font-bold">{formatMoney(s.amount, s.currency)}</span>
                      </div>
                      {isMine && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {payee?.phone ? (
                            <a href={whatsappPayLink(payee.phone, `Sending ${formatMoney(s.amount, s.currency)} (Group OS settle-up). I'll pay with WhatsApp Pay here.`)} target="_blank" rel="noreferrer" className="rounded-md bg-[#25d366] px-2.5 py-1 text-[11px] font-bold text-white">
                              Pay on WhatsApp
                            </a>
                          ) : (
                            !example && <span className="rounded-md border border-dashed border-slate-300 px-2 py-1 text-[10px] text-slate-500">{s.to} hasn't added a WhatsApp number</span>
                          )}
                          {payee?.upi && (
                            <a href={upiLink(payee.upi, s.to, s.amount, note)} className="rounded-md border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-slate-700">
                              Pay with any UPI app
                            </a>
                          )}
                          <PaidButton to={s.to} amount={s.amount} currency={s.currency} onPaid={onPaid} />
                        </div>
                      )}
                      {!isMine && !example && onRemind && person(s.from)?.phone && (
                        <div className="mt-1.5"><RemindButton name={s.from} onRemind={onRemind} /></div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 space-y-1">
              <div><b>You pay:</b> {mine.length ? mine.map(s => `${formatMoney(s.amount, s.currency)} to ${s.to}`).join(', ') : 'nothing'}</div>
              <div><b>You receive:</b> {toMe.length ? toMe.map(s => `${formatMoney(s.amount, s.currency)} from ${s.from}`).join(', ') : 'nothing'}</div>
              <div className="text-slate-500">Shared costs so far: <b className="font-mono">{panel.spend}</b></div>
            </div>
            <p className="text-[10px] text-slate-400 px-1">
              Payments happen in your own app. There is no way for an app to start a WhatsApp Pay transfer between friends, so "Pay on WhatsApp" opens your chat with them, ready to pay.
            </p>
          </div>
        )}

        {tab === 'me' && (
          <div className="space-y-3">
          <PrivateChat compact />
          <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2 text-xs">
            <div className="font-bold text-slate-900">You are {me.name}</div>
            <label className="block">
              <span className="text-[11px] text-slate-600">WhatsApp number, so friends can pay you on WhatsApp</span>
              <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="91 98765 43210" className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5" />
            </label>
            <label className="block">
              <span className="text-[11px] text-slate-600">UPI id (optional)</span>
              <input value={upi} onChange={e => setUpi(e.target.value)} placeholder="name@okbank" className="mt-0.5 w-full rounded-md border border-slate-300 px-2 py-1.5" />
            </label>
            <button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setSaveError('');
                try {
                  await onSaveMe({ phone, upi });
                  setSaved(true);
                  setTimeout(() => setSaved(false), 1500);
                } catch (e: any) {
                  setSaveError(e.message ?? 'Could not save');
                } finally {
                  setSaving(false);
                }
              }}
              className="rounded-md bg-[#008069] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
            >
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
            </button>
            {saveError && <p className="text-[11px] text-rose-700">{saveError}</p>}
            <p className="text-[10px] text-slate-400">Only people in this group see these, and only to pay you.</p>
          </div>
          <People me={me} members={members} example={example} onAdd={onAddPerson} onRemind={onRemind} />
          </div>
        )}
      </div>
      <div className="border-t border-slate-200 bg-white px-3 py-1.5 text-[10px] text-slate-400 flex items-center gap-1">
        <Clock className="w-3 h-3" /> Updated {new Date(panel.updatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} · calculated from the messages, not guessed <MessageCircle className="w-3 h-3 ml-auto" />
      </div>
    </div>
  );
};
