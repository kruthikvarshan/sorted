import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { ArrowLeft, AudioLines, Check, ImagePlus, Loader2, Lock, Mic, PanelRightOpen, Plus, QrCode, Send, Sparkles, Square, Users } from 'lucide-react';
import { AccountSummary, adoptAccount, api, phoneText, forgetToken, GroupSummary, LiveEvent, LiveMessage, saveToken, savedToken, scope, session, Snapshot } from './api';
import { formatMoney } from '../engine/ledger';
import { LivePanel, Tab as PanelTab } from './Panel';
import { WrappedSheet } from './Wrapped';
import { PlanOutLoud } from './PlanOutLoud';
import { ShareInbox } from './ShareInbox';
import { PrivateChat } from './PrivateChat';
import { TripPlanSheet } from './TripPlanSheet';
import { MyDetails } from './MyDetails';
import { openMicrophone } from '../services/microphone';

/**
 * Sorted: a group chat that people join from their phones, with Sorted as a member. It reads the chat by
 * topic as it happens, speaks up when something needs the group, answers @Sorted, and keeps everyone's balance.
 */

const roomFromPath = () => {
  const id = window.location.pathname.match(/^\/live\/([\w-]+)/)?.[1];
  return id === 'share' || id === 'me' ? undefined : id;
};
const onShare = () => window.location.pathname === '/live/share';
const onMe = () => window.location.pathname === '/live/me';
const go = (path: string) => {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

export const LiveApp: React.FC = () => {
  const [roomId, setRoomId] = useState(roomFromPath());
  const [share, setShare] = useState(onShare());
  const [mePage, setMePage] = useState(onMe());
  useEffect(() => {
    const onPop = () => {
      setRoomId(roomFromPath());
      setShare(onShare());
      setMePage(onMe());
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // Everything needs an account: your groups and My Sorted live in it, on any device.
  const [account, setAccount] = useState<AccountSummary | null | undefined>(undefined);
  const [reaching, setReaching] = useState(false);
  useEffect(() => {
    if (!session.get()) return setAccount(null);
    let stop = false;
    const check = () =>
      api
        .account()
        .then(r => {
          if (stop) return;
          adoptAccount(r.account);
          setAccount(r.account);
        })
        .catch((e: { status?: number }) => {
          if (stop) return;
          // Only the server saying this login is not valid ends it. A dropped connection or a server restarting keeps
          // you logged in and tries again.
          if (e.status === 401 || e.status === 403) {
            session.set(null);
            setAccount(null);
            return;
          }
          setReaching(true);
          setTimeout(check, 3000);
        });
    void check();
    return () => {
      stop = true;
    };
  }, []);
  if (account === undefined)
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 bg-[#efeae2]">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        {reaching && <p className="text-xs text-slate-500">Reaching Sorted… trying again in a moment.</p>}
      </div>
    );
  if (account === null) return <Login onDone={(a, s) => { session.set(s); adoptAccount(a); setAccount(a); }} />;
  if (share) return <ShareInbox go={go} />;
  if (mePage) return <MyGroupOsPage />;
  return roomId ? <RoomGate roomId={roomId} /> : (
    <Home
      account={account}
      onLogout={() => {
        void api.logout().catch(() => undefined);
        session.set(null);
        adoptAccount({ username: '', name: '', seats: [], scope: [] });
        setAccount(null);
      }}
    />
  );
};

const siteOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/* ---------------- login ---------------- */

const Login: React.FC<{ onDone: (a: AccountSummary, session: string) => void }> = ({ onDone }) => {
  const [signup, setSignup] = useState(false);
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = phone.replace(/\D/g, '').length >= 10 && pin.length === 4 && (!signup || name.trim());
  const submit = async () => {
    if (!ready || busy) return;
    setError('');
    setBusy(true);
    try {
      const r = await api.login(phone, pin, signup, signup ? name : undefined);
      onDone(r.account, r.session);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };
  const field = 'mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal';
  return (
    <div className="min-h-screen bg-[#efeae2] px-4 py-10">
      <div className="mx-auto max-w-sm space-y-5">
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#008069] text-white shadow-md"><Check className="h-8 w-8" strokeWidth={3.5} aria-hidden /></div>
          <h1 className="text-2xl font-bold text-slate-900">Sorted</h1>
          <p className="text-sm text-slate-600">Your group chat, sorted: what's decided, who owes whom, what's next.</p>
        </div>
        <div className="space-y-3 rounded-2xl bg-white p-5 shadow-sm">
          <div className="grid grid-cols-2 rounded-lg bg-slate-100 p-1 text-xs font-bold" role="tablist">
            <button role="tab" aria-selected={!signup} onClick={() => { setSignup(false); setError(''); }} className={`rounded-md py-1.5 ${!signup ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`} data-testid="tab-login">I have an account</button>
            <button role="tab" aria-selected={signup} onClick={() => { setSignup(true); setError(''); }} className={`rounded-md py-1.5 ${signup ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`} data-testid="tab-signup">First time here</button>
          </div>
          {signup && (
            <label className="block text-xs font-semibold text-slate-700">Your name
              <input value={name} onChange={e => setName(e.target.value)} autoComplete="name" placeholder="e.g. Asha" className={field} />
            </label>
          )}
          <label className="block text-xs font-semibold text-slate-700">Mobile number
            <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="+91 98765 43210" className={field} />
          </label>
          <label className="block text-xs font-semibold text-slate-700">{signup ? 'Pick a 4-digit PIN' : '4-digit PIN'}
            <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" type="password" autoComplete={signup ? 'new-password' : 'current-password'} placeholder="••••" className={`${field} tracking-widest`} onKeyDown={e => e.key === 'Enter' && submit()} />
          </label>
          <button onClick={submit} disabled={busy || !ready} className="w-full rounded-lg bg-[#008069] py-2.5 text-sm font-bold text-white disabled:opacity-40">{busy ? 'One moment…' : signup ? 'Create my account' : 'Log in'}</button>
          {error && <p className="text-xs text-rose-700" data-testid="login-error">{error}</p>}
          <p className="text-[11px] text-slate-500">
            {signup
              ? 'Your account comes with 8 example groups (1,200 to 5,000 messages each, made-up people) with you in them, so you can try everything. Delete any of them whenever you like. Groups someone added your number to show up too.'
              : 'Log in with the number and PIN you signed up with. Your groups and chats are all kept.'}
          </p>
        </div>
      </div>
    </div>
  );
};

/* ---------------- my groups ---------------- */

const when = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const money = (rows: { currency: string; amount: number }[]) => {
  const by = new Map<string, number>();
  rows.forEach(r => by.set(r.currency, (by.get(r.currency) ?? 0) + r.amount));
  const SYMBOL: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£' };
  return by.size ? [...by.entries()].map(([c, a]) => formatMoney(Math.round(a * 100) / 100, SYMBOL[c] ?? c ?? '₹')).join(' + ') : 'nothing';
};

/** Every group on this phone, kept live (checked every few seconds), with what needs you in each. */
function useMyGroups(refresh = 0) {
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop = false;
    const load = () => {
      const seats = api.seats();
      if (!seats.length) return setGroups([]);
      api
        .myGroups(seats)
        .then(r => !stop && (setGroups(r.groups), setFailed(false)))
        .catch(() => !stop && setFailed(true));
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [refresh]);
  // Not loaded yet is null; a failed check keeps the last good list and says so, never shows false zeros.
  return Object.assign(groups ?? [], { loaded: groups !== null, failed }) as GroupSummary[] & { loaded: boolean; failed: boolean };
}

const ScopeToggle: React.FC<{ roomId: string; onChange: () => void }> = ({ roomId, onChange }) => {
  const inScope = scope.has(roomId);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={e => {
        e.stopPropagation();
        const all = api.seats().map(s => s.roomId);
        const current = scope.get() ?? all;
        scope.set(inScope ? current.filter(id => id !== roomId) : [...current, roomId]);
        onChange();
      }}
      className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${inScope ? 'border-[#008069] bg-emerald-50 text-[#008069]' : 'border-slate-300 text-slate-600'}`}
      data-testid="scope-toggle"
    >
      {inScope ? '🔒 In My Sorted' : '+ Add to My Sorted'}
    </span>
  );
};

const DeleteGroup: React.FC<{ g: GroupSummary; onDone: () => void }> = ({ g, onDone }) => {
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');
  if (!ask)
    return (
      <span role="button" tabIndex={0} onClick={e => { e.stopPropagation(); setAsk(true); }} className="shrink-0 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500 hover:border-rose-300 hover:text-rose-600" data-testid="delete-group">
        Delete
      </span>
    );
  return (
    <span className="flex flex-wrap items-center gap-1.5 rounded-lg bg-rose-50 px-2 py-1 text-[10px] text-rose-800" onClick={e => e.stopPropagation()}>
      Delete “{g.title}” with all its messages and results?
      <span role="button" tabIndex={0} onClick={async () => { if (busy) return; setBusy(true); setFailed(''); try { const r = await api.deleteGroup(g.roomId); adoptAccount(r.account); onDone(); } catch (e: any) { setFailed(e.message); } finally { setBusy(false); } }} className="rounded-full bg-rose-600 px-3 py-1 font-bold text-white" data-testid="confirm-delete">{busy ? 'Deleting…' : 'Delete'}</span>
      <span role="button" tabIndex={0} onClick={() => setAsk(false)} className="rounded-full border border-rose-300 px-3 py-1 font-semibold">Keep</span>
      {failed && <span className="w-full text-rose-700">{failed}</span>}
    </span>
  );
};

const GroupRowView: React.FC<{ g: GroupSummary; onScope: () => void }> = ({ g, onScope }) => (
  <div role="link" tabIndex={0} onClick={() => go(`/live/${g.roomId}`)} onKeyDown={e => e.key === 'Enter' && e.target === e.currentTarget && go(`/live/${g.roomId}`)} className="flex w-full cursor-pointer items-center gap-3 border-b border-slate-100 px-4 py-3 text-left last:border-0 hover:bg-slate-50" data-testid="group-row">
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm font-bold text-slate-700">{g.title.charAt(0)}</span>
    <span className="min-w-0 flex-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5"><span className="truncate text-sm font-semibold text-slate-900">{g.title}</span>{g.example && <span className="shrink-0 rounded bg-slate-100 px-1 text-[9px] font-bold uppercase tracking-wide text-slate-500" title="Made-up people, to try Sorted">Example</span>}</span>
        {g.last && <span className="shrink-0 text-[11px] text-slate-400">{when(g.last.at)}</span>}
      </span>
      <span className="block truncate text-xs text-slate-500">{g.reading ? 'Sorted is reading…' : g.last ? `${g.last.speaker}: ${g.last.text}` : 'No messages yet'}</span>
      <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="text-slate-400">{g.total.toLocaleString('en-IN')} msgs · {g.topics} topics · as {g.me}{g.example ? ' · made-up people' : ''}</span>
        {g.unread > 0 && !g.reading && <span className="rounded bg-sky-50 px-1.5 py-0.5 font-semibold text-sky-700">{g.unread} not read yet</span>}
        {g.owe !== 'nothing' && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-800">you owe {g.owe}</span>}
        {g.owed !== 'nothing' && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800">owed {g.owed}</span>}
        {g.disagreements > 0 && <span className="rounded bg-rose-50 px-1.5 py-0.5 font-semibold text-rose-700">⚠ {g.disagreements} disagreement{g.disagreements === 1 ? '' : 's'}</span>}
      </span>
      <span className="mt-1.5 flex flex-wrap items-center gap-1.5"><ScopeToggle roomId={g.roomId} onChange={onScope} /><DeleteGroup g={g} onDone={onScope} /></span>
    </span>
  </div>
);

/** The chat list on the home screen. */
const MyGroups: React.FC = () => {
  const [tick, bump] = useState(0);
  const groups = useMyGroups(tick);
  if (!groups.loaded)
    return <div className="flex justify-center rounded-2xl bg-white py-8 shadow-sm">{groups.failed ? <span className="text-xs text-rose-700">Could not load your groups. Retrying…</span> : <Loader2 className="w-5 h-5 animate-spin text-slate-400" />}</div>;
  if (!groups.length) return <div className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-slate-600 shadow-sm">No groups yet. Start one below and invite your friends.</div>;
  const inScope = groups.filter(g => scope.has(g.roomId)).length;
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-sm" data-testid="my-groups">
      <button onClick={() => go('/live/me')} className="flex w-full items-center gap-3 border-b border-slate-100 bg-emerald-50/50 px-4 py-3 text-left hover:bg-emerald-50">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#008069] text-white"><Lock className="w-4 h-4" /></span>
        <span className="flex-1">
          <span className="block text-sm font-bold text-slate-900">My Sorted</span>
          <span className="block text-xs text-slate-500">Private · following {inScope} of {groups.length} groups</span>
        </span>
      </button>
      {groups.map(g => <GroupRowView key={g.roomId} g={g} onScope={() => bump(x => x + 1)} />)}
    </div>
  );
};

/** My Sorted: live numbers across the groups it follows, the private chat, and which groups it follows. */
const MyGroupOsPage: React.FC = () => {
  const [tick, bump] = useState(0);
  const groups = useMyGroups(tick);
  const followed = groups.filter(g => scope.has(g.roomId));
  const others = groups.filter(g => !scope.has(g.roomId));
  const reading = followed.filter(g => g.reading).length;
  const unread = followed.reduce((a, g) => a + g.unread, 0);
  return (
    <div className="min-h-screen bg-[#efeae2]">
      <div className="flex items-center gap-2 bg-[#008069] px-3 py-3 text-white shadow">
        <button onClick={() => go('/live')} aria-label="Back" className="rounded-full p-1 hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></button>
        <Lock className="w-4 h-4" />
        <div className="flex-1 text-[15px] font-semibold">My Sorted</div>
        <span className="text-[11px] text-white/80">only you see this</span>
      </div>
      {!groups.loaded ? (
        <div className="flex flex-col items-center gap-2 p-10 text-xs text-slate-600">{groups.failed ? 'Could not load your groups. Retrying…' : <Loader2 className="w-6 h-6 animate-spin text-slate-400" />}</div>
      ) : (
      <div className="mx-auto max-w-lg space-y-3 p-4">
        {groups.failed && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">Could not refresh just now; showing the last numbers. Retrying…</p>}
        <div className="rounded-2xl bg-white p-4 shadow-sm" data-testid="my-totals">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Across the {followed.length} groups you follow</div>
          <div className="mt-2 grid grid-cols-2 gap-3">
            <div><div className="text-[11px] text-slate-500">You owe</div><div className="text-lg font-bold font-mono text-slate-900">{money(followed.flatMap(g => g.oweTotals))}</div></div>
            <div><div className="text-[11px] text-slate-500">You are owed</div><div className="text-lg font-bold font-mono text-emerald-700">{money(followed.flatMap(g => g.owedTotals))}</div></div>
            <div><div className="text-[11px] text-slate-500">Open disagreements</div><div className="text-base font-bold text-rose-700">{followed.reduce((a, g) => a + g.disagreements, 0)}</div></div>
            <div><div className="text-[11px] text-slate-500">Things decided</div><div className="text-base font-bold text-slate-900">{followed.reduce((a, g) => a + g.decided, 0)}</div></div>
          </div>
          <div className="mt-2 text-[11px] text-slate-500">
            {reading ? `Reading new messages in ${reading} group${reading === 1 ? '' : 's'}… these numbers update when it finishes.` : unread ? `${unread} new message${unread === 1 ? '' : 's'} not read yet; each group reads them after a few more messages or 20 quiet seconds.` : 'Up to date with every group. Each group is counted on its own: money in one group never cancels out money in another.'}
          </div>
        </div>
        <MyDetails go={go} refresh={tick} />
        <PrivateChat />
        <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Groups in My Sorted</div>
          {followed.length ? followed.map(g => <GroupRowView key={g.roomId} g={g} onScope={() => bump(x => x + 1)} />) : <p className="px-4 py-3 text-xs text-slate-500">None yet. Add a group below.</p>}
        </div>
        {others.length > 0 && (
          <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Your other groups (not followed)</div>
            {others.map(g => <GroupRowView key={g.roomId} g={g} onScope={() => bump(x => x + 1)} />)}
          </div>
        )}
      </div>
      )}
    </div>
  );
};

/* ---------------- home ---------------- */

const Home: React.FC<{ account: AccountSummary; onLogout: () => void }> = ({ account, onLogout }) => {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const create = async () => {
    if (busy) return;
    setError('');
    if (!title.trim()) return setError('Give the group a name.');
    setBusy(true);
    try {
      const r = await api.create(title, account.name);
      if (r.token) {
        saveToken(r.roomId, r.token);
        await api.addSeat(r.roomId, r.token, true);
      }
      go(`/live/${r.roomId}?invite=1`);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#efeae2] px-4 py-6">
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#008069] text-white shadow-md"><Check className="h-6 w-6" strokeWidth={3.5} aria-hidden /></div>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-slate-900">Sorted</h1>
            <p className="text-xs text-slate-600">Hi {account.name} · {account.phone ? phoneText(account.phone) : ''}</p>
          </div>
          <button onClick={onLogout} className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-600">Log out</button>
        </div>

        <MyGroups />

        <div className="rounded-2xl bg-white p-5 shadow-sm space-y-3">
          <h2 className="text-sm font-bold text-slate-900">Start a new group</h2>
          <input value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => e.key === 'Enter' && create()} placeholder="Group name, e.g. Coorg weekend" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button onClick={create} disabled={busy} className="w-full rounded-lg bg-[#008069] py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {busy ? 'Creating…' : 'Create and invite friends'}
          </button>
        </div>
        {error && <p className="text-center text-sm text-rose-700">{error}</p>}
        <p className="text-center text-[11px] text-slate-500">Sorted runs on Meta AI: Muse Spark reads the chat and screenshots, Muse Voice hears voice notes, Muse Image paints your Group Wrapped, and Meta's web search plans trips. Every amount is calculated from the messages themselves, never guessed.</p>
      </div>
    </div>
  );
};

/* ---------------- joining ---------------- */

const RoomGate: React.FC<{ roomId: string }> = ({ roomId }) => {
  const [token, setToken] = useState(savedToken(roomId));
  const [info, setInfo] = useState<{ title: string; people: string[] } | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (token) return;
    api.peek(roomId).then(r => setInfo({ title: r.room.title, people: r.people })).catch(e => setError(e.message));
  }, [roomId, token]);

  const join = async (who: string) => {
    if (joining) return;
    setJoining(true);
    try {
      const r = await api.join(roomId, who);
      saveToken(roomId, r.token);
      await api.addSeat(roomId, r.token).catch(() => undefined);
      setToken(r.token);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setJoining(false);
    }
  };

  if (token) return <Room roomId={roomId} token={token} onLeave={() => (forgetToken(roomId), setToken(null))} />;
  return (
    <div className="min-h-screen bg-[#efeae2] px-4 py-10">
      <div className="mx-auto max-w-sm rounded-2xl bg-white p-5 shadow-sm space-y-4">
        {error ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-rose-700">{error}</p>
            <button onClick={() => go('/live')} className="rounded-lg bg-[#008069] px-4 py-2 text-sm font-bold text-white">Go to my groups</button>
          </div>
        ) : !info ? (
          <Loader2 className="mx-auto w-5 h-5 animate-spin text-slate-400" />
        ) : (
          <>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">You're invited to</div>
              <h1 className="text-xl font-bold text-slate-900">{info.title}</h1>
            </div>
            {info.people.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs text-slate-600">Who are you?</div>
                <div className="flex flex-wrap gap-2">
                  {info.people.map(p => (
                    <button key={p} disabled={joining} onClick={() => join(p)} className="rounded-full border border-slate-300 px-3 py-1.5 disabled:opacity-50 text-sm font-semibold text-slate-800 hover:border-[#008069]">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder={info.people.length ? 'Or a new name' : 'Your name'} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
              <button onClick={() => join(name)} disabled={!name.trim() || joining} className="rounded-lg bg-[#008069] px-4 text-sm font-bold text-white disabled:opacity-40">
                Join
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

/* ---------------- the room ---------------- */

const COLORS = ['#e91e63', '#1e88e5', '#8e24aa', '#f4511e', '#00897b', '#6d4c41', '#3949ab', '#c0ca33'];
const colorOf = (name: string) => COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const dayLabel = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
};
/** WhatsApp-style formatting: *bold* and _italic_ (only when the markers sit at word edges, so snake_case stays). */
const render = (text: string) =>
  text.split(/(\*[^*\n]+\*|(?<![\w])_[^_\n]+_(?![\w]))/g).map((part, i) =>
    part.length > 2 && part.startsWith('*') && part.endsWith('*') ? (
      <b key={i}>{part.slice(1, -1)}</b>
    ) : part.length > 2 && part.startsWith('_') && part.endsWith('_') ? (
      <i key={i}>{part.slice(1, -1)}</i>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );

const Room: React.FC<{ roomId: string; token: string; onLeave: () => void }> = ({ roomId, token, onLeave }) => {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [messages, setMessages] = useState<LiveMessage[]>([]);
  const [status, setStatus] = useState<{ on: boolean; label?: string }>({ on: false });
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('topics');
  // A brand-new group opens with the invite QR, so friends can join straight away.
  const [share, setShare] = useState(() => new URLSearchParams(window.location.search).has('invite'));
  const [showWrapped, setShowWrapped] = useState(false);
  const [outLoud, setOutLoud] = useState(false);
  const [more, setMore] = useState(false);
  const [tripTopic, setTripTopic] = useState<string | null>(null);
  const [recording, setRecording] = useState<{ stop: () => void; cancel: () => void; started: number } | null>(null);
  const [sendingVoice, setSendingVoice] = useState(false);
  const [readingImage, setReadingImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [elapsed, setElapsed] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  // A ticking clock for the "next read in…" countdown.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const [start, setStart] = useState(0);
  const [atLatest, setAtLatest] = useState(true);
  const atLatestRef = useRef(true);
  const [tip, setTip] = useState(() => {
    try {
      return !localStorage.getItem('groupos_live_tip');
    } catch {
      return false;
    }
  });
  const pendingJump = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  const addPerson = async (name: string, phone: string) => {
    try {
      const r = await api.addPerson(roomId, token, name, phone);
      const members = (await api.snapshot(roomId, token)).members;
      setSnap(s => (s ? { ...s, members } : s));
      return { ok: true, message: r.joined ? `${r.name} already uses Sorted, so this group is on their phone now.` : `Added ${r.name}. The group shows up for them when they log in with that number.` };
    } catch (e: any) {
      return { ok: false, message: e.message as string };
    }
  };

  const load = useCallback(async () => {
    try {
      const s = await api.snapshot(roomId, token);
      setSnap(s);
      setMessages(s.messages);
      setStart(s.start ?? 0);
      setAtLatest(true);
      atLatestRef.current = true;
      setStatus({ on: s.analysing, label: s.label });
    } catch (e: any) {
      if (/join/i.test(e.message)) onLeave();
      else setError(e.message);
    }
  }, [roomId, token, onLeave]);

  useEffect(() => {
    void load();
    const es = api.events(roomId, token);
    // If live updates do not arrive (some networks and tunnels hold them back), check for changes every few seconds.
    let lastEvent = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - lastEvent < 8000) return;
      try {
        const s = await api.snapshot(roomId, token);
        setSnap(prev => (prev ? { ...prev, panel: s.panel, lastAnalysis: s.lastAnalysis, read: s.read, people: s.people, lastReadId: s.lastReadId, nextReadAt: s.nextReadAt, burst: s.burst, note: s.note, total: s.total, members: s.members } : s));
        setStatus({ on: s.analysing, label: s.label });
        if (atLatestRef.current) setMessages(prev => [...prev, ...s.messages.filter(m => !prev.some(p => p.id === m.id) && m.createdAt >= (prev.at(-1)?.createdAt ?? 0))]);
      } catch {
        /* try again next time */
      }
    }, 4000);
    es.onmessage = ev => {
      lastEvent = Date.now();
      const e = JSON.parse(ev.data) as LiveEvent;
      if (e.type === 'message') {
        // While looking at older messages, new ones wait; "Back to latest" brings them in.
        if (atLatestRef.current) setMessages(prev => (prev.some(m => m.id === e.message.id) ? prev : [...prev, e.message]));
        setSnap(s => (s ? { ...s, total: s.total + 1 } : s));
      }
      else if (e.type === 'panel') {
        setSnap(s => (s ? { ...s, panel: e.panel, lastAnalysis: e.lastAnalysis, read: e.read, people: e.people } : s));
        setStatus({ on: e.analysing });
      } else if (e.type === 'analysing') setStatus({ on: e.on, label: e.label });
      else if (e.type === 'reading') setSnap(s => (s ? { ...s, read: e.read, people: e.people, lastReadId: e.lastReadId, nextReadAt: e.nextReadAt, burst: e.burst, note: e.note } : s));
      else if (e.type === 'members') setSnap(s => (s ? { ...s, members: e.members.map(m => s.members.find(x => x.id === m.id) ?? m) } : s));
    };
    return () => {
      es.close();
      clearInterval(poll);
    };
  }, [roomId, token, load]);

  useEffect(() => {
    const el = listRef.current;
    if (pendingJump.current) {
      const id = pendingJump.current;
      pendingJump.current = null;
      const target = document.getElementById(`msg-${id}`);
      if (target) {
        target.scrollIntoView({ block: 'center' });
        setHighlight(id);
        setTimeout(() => setHighlight(null), 2500);
      }
      return;
    }
    if (el && atBottom.current && atLatestRef.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const loadEarlier = async () => {
    if (loadingEarlier) return;
    setLoadingEarlier(true);
    const el = listRef.current;
    const before = el?.scrollHeight ?? 0;
    try {
      const w = await api.history(roomId, token, { before: start });
      atBottom.current = false;
      setMessages(prev => [...w.messages.filter(m => !prev.some(p => p.id === m.id)), ...prev]);
      setStart(w.start);
      requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight - before));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingEarlier(false);
    }
  };

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - recording.started) / 1000)), 250);
    return () => clearInterval(t);
  }, [recording]);
  // Leaving the chat while recording turns the microphone off (nothing is sent).
  const recordingRef = useRef(recording);
  recordingRef.current = recording;
  useEffect(() => () => recordingRef.current?.cancel(), []);

  const send = async (text = input) => {
    const clean = text.trim();
    if (!clean) return;
    setInput('');
    atBottom.current = true;
    try {
      await api.send(roomId, token, clean);
    } catch (e: any) {
      setError(e.message);
      setInput(clean);
    }
  };

  const [pressing, setPressing] = useState<string | null>(null);
  const press = async (key: string, action: string, args: Record<string, string>) => {
    if (pressing) return;
    setPressing(key);
    const r = await api.act(roomId, token, action, args).catch(e => ({ ok: false, message: e.message }));
    setPressing(null);
    if (!r.ok) setError(r.message ?? 'That did not work');
  };

  const toggleVoice = async () => {
    if (recording) return recording.stop();
    try {
      const { stream } = await openMicrophone();
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      let cancelled = false;
      rec.ondataavailable = e => e.data.size && chunks.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        setRecording(null);
        if (cancelled) return;
        setSendingVoice(true);
        try {
          await api.voice(roomId, token, new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
        } catch (e: any) {
          setError(e.message);
        } finally {
          setSendingVoice(false);
        }
      };
      rec.start(250);
      setElapsed(0);
      setRecording({ stop: () => rec.stop(), cancel: () => ((cancelled = true), rec.state !== 'inactive' && rec.stop(), stream.getTracks().forEach(t => t.stop())), started: Date.now() });
    } catch {
      setError('The microphone could not start. Allow it for this site and try again.');
    }
  };

  const sendImage = async (file?: File) => {
    if (!file) return;
    setReadingImage(true);
    try {
      await api.image(roomId, token, file);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setReadingImage(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const jump = async (id: string) => {
    setPanelOpen(false);
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlight(id);
      setTimeout(() => setHighlight(null), 2500);
      return;
    }
    // Further back than what is loaded: load the messages around it.
    try {
      const w = await api.history(roomId, token, { around: id });
      if (!w.messages.length) return setError('That message is no longer in this chat.');
      pendingJump.current = id;
      atLatestRef.current = false;
      setAtLatest(false);
      setStart(w.start);
      setMessages(w.messages);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const me = snap?.me;
  const joinUrl = `${window.location.origin}/live/${roomId}`;
  const grouped = useMemo(() => messages.map((m, i) => ({ m, newDay: i === 0 || dayLabel(m.createdAt) !== dayLabel(messages[i - 1].createdAt), sameAuthor: i > 0 && messages[i - 1].speakerId === m.speakerId && dayLabel(m.createdAt) === dayLabel(messages[i - 1].createdAt) })), [messages]);

  if (!snap || !me)
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-[#efeae2] px-6 text-center">
        {error ? (
          <>
            <p className="text-sm text-rose-700">{error}</p>
            <div className="flex gap-2">
              <button onClick={() => (setError(''), void load())} className="rounded-lg bg-[#008069] px-4 py-2 text-sm font-bold text-white">Try again</button>
              <button onClick={() => go('/live')} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">My groups</button>
            </div>
          </>
        ) : (
          <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
        )}
      </div>
    );

  const lastRead = snap.lastAnalysis;
  const unread = Math.max(0, snap.people - snap.read);
  const secondsLeft = snap.nextReadAt ? Math.max(0, Math.ceil((snap.nextReadAt - now) / 1000)) : undefined;
  const readNow = async () => {
    const r = await api.readNow(roomId, token).catch(e => ({ ok: false, message: e.message }));
    if (!r.ok) setError(r.message ?? 'Could not start reading');
  };
  return (
    <div className="flex h-[100dvh] bg-[#efeae2]">
      <div className="flex min-w-0 flex-1 flex-col">
        {/* header */}
        <div className="flex items-center gap-2 bg-[#008069] px-3 py-2 text-white shadow">
          <button onClick={() => (window.history.length > 1 && document.referrer.startsWith(window.location.origin) ? window.history.back() : go('/live'))} aria-label="Back" className="rounded-full p-1 hover:bg-white/10"><ArrowLeft className="w-5 h-5" /></button>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-sm font-bold">{snap.room.title.charAt(0)}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{snap.room.title}</div>
            <div className="truncate text-[11px] text-white/80">
              {status.on ? (status.label ?? 'Sorted is reading…') : `${snap.members.map(m => m.name).join(', ')}, Sorted`}
            </div>
          </div>
          <button onClick={() => { setPanelTab('me'); setPanelOpen(true); }} aria-label="My Sorted (private)" title="My Sorted: only you see it" className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1.5 text-[11px] font-bold hover:bg-white/25"><Lock className="w-3.5 h-3.5" /> <span className="hidden sm:inline">My Sorted</span></button>
          <button onClick={() => setShowWrapped(true)} aria-label="Group Wrapped" title="Group Wrapped" className="rounded-full p-2 hover:bg-white/10"><Sparkles className="w-5 h-5" /></button>
          <button onClick={() => setShare(true)} aria-label="Invite" className="rounded-full p-2 hover:bg-white/10"><QrCode className="w-5 h-5" /></button>
          <button onClick={() => { setPanelTab('topics'); setPanelOpen(true); }} aria-label={snap.panel.topics.some(t => t.disagreements.length) ? 'Open topics and money (there are disagreements)' : 'Open topics and money'} className="relative rounded-full p-2 hover:bg-white/10 lg:hidden">
            <PanelRightOpen className="w-5 h-5" />
            {snap.panel.topics.some(t => t.disagreements.length) && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-amber-400" />}
          </button>
        </div>
        {/* reading status */}
        <div className="flex items-center gap-1.5 bg-[#fffbe6] px-3 py-1 text-[11px] text-amber-900 border-b border-amber-100">
          {status.on ? <Loader2 className="w-3 h-3 shrink-0 animate-spin" /> : <Sparkles className="w-3 h-3 shrink-0" />}
          <span className="min-w-0 flex-1 truncate">
          {status.on
            ? status.label ?? 'Sorted is reading the new messages…'
            : unread > 0 && snap.note
            ? `${unread} new · ${snap.note}`
            : unread > 0
            ? `${unread} new · Sorted reads them ${secondsLeft !== undefined && secondsLeft > 0 ? `in ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}` : 'now'}`
            : lastRead
            ? `Sorted has read ${snap.read >= snap.people ? 'all ' : ''}${snap.read.toLocaleString('en-IN')} messages · ${snap.panel.topics.length} topic${snap.panel.topics.length === 1 ? '' : 's'}${lastRead.error ? ' · a few topics will be read again with the next message' : ''}`
            : snap.panel.topics.length
            ? `${snap.panel.topics.length} topic${snap.panel.topics.length === 1 ? '' : 's'} · read with Meta AI`
            : `Sorted reads new messages after ${snap.burst} of them, or 20 seconds after the chat goes quiet.`}
          </span>
          {!status.on && unread > 0 && !snap.note && (
            <button onClick={readNow} className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-900 hover:bg-amber-300" data-testid="read-now">Read now</button>
          )}
        </div>

        {/* messages */}
        <div ref={listRef} onScroll={e => (atBottom.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 80)} className="flex-1 overflow-y-auto px-3 py-2" data-testid="messages">
          {start > 0 && (
            <div className="my-2 text-center">
              <button onClick={loadEarlier} disabled={loadingEarlier} className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-semibold text-slate-600 shadow-xs">{loadingEarlier ? 'Loading…' : `Load earlier messages (${start.toLocaleString('en-IN')} more)`}</button>
            </div>
          )}
          {grouped.map(({ m, newDay, sameAuthor }) => {
            const mine = m.speakerId === me.id;
            const bot = m.speakerId === 'groupos';
            return (
              <React.Fragment key={m.id}>
                {newDay && <div className="my-3 flex justify-center"><span className="rounded-lg bg-white/90 px-2.5 py-1 text-[11px] font-medium text-slate-600 shadow-xs">{dayLabel(m.createdAt)}</span></div>}
                <div id={`msg-${m.id}`} className={`flex ${mine ? 'justify-end' : 'justify-start'} ${sameAuthor ? 'mt-0.5' : 'mt-2'}`}>
                  <div
                    className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-[14px] shadow-xs transition-colors sm:max-w-[70%] ${
                      highlight === m.id ? 'ring-2 ring-amber-400' : ''
                    } ${bot ? 'border border-[#008069]/30 bg-[#e7f6f2]' : mine ? 'bg-[#d9fdd3]' : 'bg-white'}`}
                  >
                    {!mine && !sameAuthor && (
                      <div className="mb-0.5 flex items-center gap-1 text-[12px] font-semibold" style={{ color: bot ? '#008069' : colorOf(m.speakerName) }}>
                        {bot && <Sparkles className="w-3 h-3" />}
                        {m.speakerName}
                      </div>
                    )}
                    {m.fromScreenshot && <div className="mb-0.5 text-[10px] text-slate-500">📸 from a screenshot</div>}
                    {m.imageUrl && <img src={m.imageUrl} alt="Shared image" className="mb-1 max-h-60 rounded-md" />}
                    {m.audioUrl && <audio controls src={m.audioUrl} className="mb-1 h-8 w-56 max-w-full" />}
                    <div className="whitespace-pre-wrap break-words text-slate-900">
                      {m.type === 'voice_transcript' && <span className="mr-1 text-[11px] text-slate-500">🎙</span>}
                      {render(m.content)}
                    </div>
                    {m.sources && m.sources.some(src => siteOf(src.url).endsWith('instagram.com')) && (
                      <div className="mt-1.5 space-y-0.5 border-t border-[#008069]/20 pt-1.5" data-testid="instagram">
                        <div className="text-[10px] font-bold uppercase text-slate-500">Seen on Instagram (from Meta AI web search)</div>
                        {m.sources.filter(src => siteOf(src.url).endsWith('instagram.com')).map((src, i) => (
                          <a key={i} href={src.url} target="_blank" rel="noreferrer" className="block truncate text-[12px] text-[#c13584]">
                            📸 <span className="underline">{src.url.replace(/^https?:\/\/(www\.)?instagram\.com\//, '@').replace(/\/$/, '')}</span>
                          </a>
                        ))}
                      </div>
                    )}
                    {m.sources && m.sources.some(src => !siteOf(src.url).endsWith('instagram.com')) && (
                      <div className="mt-1.5 space-y-0.5 border-t border-[#008069]/20 pt-1.5" data-testid="sources">
                        <div className="text-[10px] font-bold uppercase text-slate-500">Sources (from Meta AI web search)</div>
                        {m.sources.filter(src => !siteOf(src.url).endsWith('instagram.com')).map((src, i) => (
                          <a key={i} href={src.url} target="_blank" rel="noreferrer" className="block truncate text-[12px] text-[#008069]">
                            <b className="text-slate-600">{siteOf(src.url)}</b> · <span className="underline">{src.title}</span>
                          </a>
                        ))}
                      </div>
                    )}
                    {m.actions && m.actions.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {m.actions.map((a, i) => {
                          const allowed = !a.onlyFor || a.onlyFor === me.id;
                          return (
                            <button
                              key={i}
                              disabled={!allowed || pressing === `${m.id}:${i}`}
                              title={allowed ? '' : 'Only the person this is for can press it'}
                              onClick={() => press(`${m.id}:${i}`, a.action, a.args)}
                              className="rounded-full border border-[#008069] bg-white px-2.5 py-1 text-[12px] font-semibold text-[#008069] disabled:border-slate-200 disabled:text-slate-400"
                            >
                              {pressing === `${m.id}:${i}` ? '…' : a.label}
                            </button>
                          );
                        })}
                        {m.actions.some(a => a.onlyFor && a.onlyFor !== me.id) && <span className="w-full text-[10px] text-slate-500">Only the person asked can answer this.</span>}
                      </div>
                    )}
                    <div className="mt-0.5 text-right text-[10px] text-slate-500">{m.timestamp}</div>
                  </div>
                </div>
                {m.id === snap.lastReadId && unread > 0 && (
                  <div className="my-3 flex items-center gap-2 text-[11px] font-semibold text-[#008069]" data-testid="read-marker">
                    <span className="h-px flex-1 bg-[#008069]/30" />
                    <Sparkles className="w-3 h-3" /> Sorted has read up to here · {unread} newer not read yet
                    <span className="h-px flex-1 bg-[#008069]/30" />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>

        {!atLatest && (
          <button onClick={() => void load()} className="mx-auto -mt-12 mb-2 rounded-full bg-[#008069] px-4 py-1.5 text-xs font-bold text-white shadow-md">Back to latest</button>
        )}
        {tip && (
          <Tour
            name={me.name}
            onDone={() => {
              setTip(false);
              try {
                localStorage.setItem('groupos_live_tip', '1');
              } catch {
                /* fine */
              }
            }}
          />
        )}
        {/* composer */}
        {error && (
          <div className="flex items-start justify-between gap-2 bg-rose-50 px-3 py-1.5 text-xs text-rose-800" role="alert">
            <span>{error}</span>
            <button onClick={() => setError('')} className="font-bold underline">OK</button>
          </div>
        )}
        <div className="flex items-center gap-2 bg-[#f0f2f5] px-2 py-2">
          <button onClick={() => setInput(v => (v.includes('@Sorted') ? v : `@Sorted ${v}`))} className="shrink-0 rounded-full bg-white px-2.5 py-2 text-[12px] font-bold text-[#008069] shadow-xs">
            @Sorted
          </button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => sendImage(e.target.files?.[0])} />
          <div className="relative shrink-0">
            <button onClick={() => setMore(v => !v)} disabled={readingImage} aria-label="More: screenshot or plan out loud" aria-expanded={more} className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 hover:bg-white disabled:opacity-50" data-testid="more">
              {readingImage ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className={`w-5 h-5 transition-transform ${more ? 'rotate-45' : ''}`} />}
            </button>
            {more && <div className="fixed inset-0 z-20" onClick={() => setMore(false)} aria-hidden="true" />}
            {more && (
              <div className="absolute bottom-12 left-0 z-30 w-64 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-black/5" role="menu">
                <button role="menuitem" onClick={() => (setMore(false), fileRef.current?.click())} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-slate-50">
                  <ImagePlus className="mt-0.5 w-5 h-5 text-[#008069]" />
                  <span><span className="block text-sm font-semibold text-slate-900">Send a screenshot</span><span className="block text-[11px] text-slate-500">A payment (checked against what's owed) or any chat (read into this group)</span></span>
                </button>
                <button role="menuitem" onClick={() => (setMore(false), setOutLoud(true))} className="flex w-full items-start gap-3 border-t border-slate-100 px-3 py-2.5 text-left hover:bg-slate-50">
                  <AudioLines className="mt-0.5 w-5 h-5 text-[#008069]" />
                  <span><span className="block text-sm font-semibold text-slate-900">Plan out loud</span><span className="block text-[11px] text-slate-500">Record the group talking in person; each voice becomes its person's messages</span></span>
                </button>
              </div>
            )}
          </div>
          {recording ? (
            <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-3 py-2 text-sm text-rose-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose-600" /> Recording… {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
            </div>
          ) : (
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), void send())}
              placeholder={sendingVoice ? 'Transcribing your voice note…' : readingImage ? 'Reading your image…' : 'Message'}
              disabled={sendingVoice}
              className="min-w-0 flex-1 rounded-full bg-white px-4 py-2 text-[15px] outline-none"
            />
          )}
          {input.trim() && !recording ? (
            <button onClick={() => send()} aria-label="Send" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#008069] text-white"><Send className="w-4 h-4" /></button>
          ) : (
            <button onClick={toggleVoice} disabled={sendingVoice} aria-label={recording ? 'Stop and send voice note' : 'Record a voice note'} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white ${recording ? 'bg-rose-600' : 'bg-[#008069]'} disabled:opacity-50`}>
              {sendingVoice ? <Loader2 className="w-4 h-4 animate-spin" /> : recording ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* panel: beside the chat on wide screens, a sheet on phones */}
      <div className="hidden w-[380px] shrink-0 border-l border-slate-200 lg:block">
        <LivePanel onPlan={async topicId => { setPanelOpen(false); setTripTopic(topicId); }} reading={status.on} tab={panelTab} onTab={setPanelTab} panel={snap.panel} me={me} members={snap.members} onJump={jump} onPaid={(to, amount, currency) => send(`Paid ${to} ${formatMoney(amount, currency === 'INR' ? '₹' : currency)} to settle up`)} onSaveMe={async p => { await api.me(roomId, token, p); const members = (await api.snapshot(roomId, token)).members; setSnap(x => (x ? { ...x, members, me: members.find(mm => mm.id === x.me.id) ?? x.me } : x)); }} example={snap.room.example} readBy={snap.room.readBy} onReadFromScratch={snap.room.canReadFromScratch ? async () => { const r = await api.readFromScratch(roomId, token).catch(e => ({ ok: false, message: e.message })); if (r.ok) { setPanelOpen(false); await load(); return undefined; } return r.message; } : undefined} onAddPerson={addPerson} onRemind={(name, send) => api.remind(roomId, token, name, send)} />
      </div>
      {panelOpen && (
        <div className="fixed inset-0 z-40 flex flex-col bg-black/30 lg:hidden" onClick={() => setPanelOpen(false)}>
          <div className="mt-auto h-[85dvh] overflow-hidden rounded-t-2xl bg-white" onClick={e => e.stopPropagation()}>
            <LivePanel onPlan={async topicId => { setPanelOpen(false); setTripTopic(topicId); }} reading={status.on} tab={panelTab} onTab={setPanelTab} panel={snap.panel} me={me} members={snap.members} onClose={() => setPanelOpen(false)} onJump={jump} onPaid={(to, amount, currency) => send(`Paid ${to} ${formatMoney(amount, currency === 'INR' ? '₹' : currency)} to settle up`)} onSaveMe={async p => { await api.me(roomId, token, p); const members = (await api.snapshot(roomId, token)).members; setSnap(x => (x ? { ...x, members, me: members.find(mm => mm.id === x.me.id) ?? x.me } : x)); }} example={snap.room.example} readBy={snap.room.readBy} onReadFromScratch={snap.room.canReadFromScratch ? async () => { const r = await api.readFromScratch(roomId, token).catch(e => ({ ok: false, message: e.message })); if (r.ok) { setPanelOpen(false); await load(); return undefined; } return r.message; } : undefined} onAddPerson={addPerson} onRemind={(name, send) => api.remind(roomId, token, name, send)} />
          </div>
        </div>
      )}
      {tripTopic && <TripPlanSheet roomId={roomId} token={token} topicId={tripTopic} onClose={() => setTripTopic(null)} />}
      {outLoud && <PlanOutLoud roomId={roomId} token={token} me={me} members={snap.members} onClose={() => setOutLoud(false)} />}
      {showWrapped && <WrappedSheet roomId={roomId} token={token} onClose={() => setShowWrapped(false)} />}
      {share && <ShareSheet url={joinUrl} title={snap.room.title} onClose={() => setShare(false)} />}
    </div>
  );
};

/** A three-step first look at a group: what Sorted does, where its results are, and how to talk to it. */
const TOUR = [
  { title: 'Sorted reads along', body: (name: string) => <>You're <b>{name}</b>. Chat as usual. Sorted (Meta AI) reads new messages after 15 of them or 20 quiet seconds: the yellow bar shows how far it has read.</> },
  { title: 'Everything it works out', body: () => <>Tap the <b>panel</b> icon (top right): topics, what's decided, disagreements, and who owes whom, each linked to the messages it came from.</> },
  { title: 'Ask, show, remind', body: () => <><b>@Sorted</b> asks a question. <b>+</b> sends a payment or chat screenshot, or records the group planning out loud. <b>🔒</b> is your private view.</> },
];
const Tour: React.FC<{ name: string; onDone: () => void }> = ({ name, onDone }) => {
  const [i, setI] = useState(0);
  const step = TOUR[i];
  return (
    <div className="border-t border-[#008069]/20 bg-[#e7f6f2] px-3 py-2.5 text-[12px] text-slate-700" data-testid="tour">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 shrink-0 text-[#008069]" />
        <b className="flex-1 text-slate-900">{step.title}</b>
        <span className="text-[10px] text-slate-500">{i + 1} of {TOUR.length}</span>
      </div>
      <p className="mt-1 pl-6">{step.body(name)}</p>
      <div className="mt-1.5 flex justify-end gap-3 pl-6">
        <button onClick={onDone} className="font-semibold text-slate-500">Skip</button>
        <button onClick={() => (i + 1 < TOUR.length ? setI(i + 1) : onDone())} className="font-bold text-[#008069]">{i + 1 < TOUR.length ? 'Next' : 'Got it'}</button>
      </div>
    </div>
  );
};

/** Phones cannot open "localhost": invites use the public address (tunnel or deployment) when there is one. */
function usePublicOrigin() {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(c => setOrigin((c.publicUrl as string | null)?.replace(/\/$/, '') || window.location.origin))
      .catch(() => setOrigin(window.location.origin));
  }, []);
  return origin;
}

const ShareSheet: React.FC<{ url: string; title: string; onClose: () => void }> = ({ url: localUrl, title, onClose: close }) => {
  const origin = usePublicOrigin();
  const url = origin ? localUrl.replace(window.location.origin, origin) : '';
  const local = !!origin && /\/\/(localhost|127\.0\.0\.1)/.test(origin);
  const onClose = () => {
    if (window.location.search.includes('invite')) window.history.replaceState(null, '', window.location.pathname);
    close();
  };
  const [qr, setQr] = useState('');
  const [copied, setCopied] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  useEffect(() => void (url && QRCode.toDataURL(url, { margin: 1, width: 320 }).then(setQr).catch(() => setQrFailed(true))), [url]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-xs rounded-2xl bg-white p-5 text-center space-y-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-1.5 text-sm font-bold text-slate-900"><Users className="w-4 h-4" /> Invite to {title}</div>
        {qr ? <img src={qr} alt="QR code to join" className="mx-auto w-56" /> : qrFailed ? <p className="text-xs text-slate-500">The QR code could not be drawn; share the link instead.</p> : <Loader2 className="mx-auto w-5 h-5 animate-spin" />}
        {local ? (
          <p className="text-xs text-amber-800">This link only works on this computer, so phones cannot open it yet. Open Sorted from its public link to invite people.</p>
        ) : (
          <p className="text-xs text-slate-600">Scan with a phone camera, or share the link.</p>
        )}
        <p className="break-all text-[10px] text-slate-400">{url}</p>
        <div className="flex gap-2">
          <button onClick={() => navigator.clipboard.writeText(url).then(() => setCopied(true)).catch(() => window.prompt('Copy this link', url))} className="flex-1 rounded-lg border border-slate-300 py-2 text-xs font-semibold">{copied ? 'Copied ✓' : 'Copy link'}</button>
          <a href={`https://wa.me/?text=${encodeURIComponent(`Join our group on Sorted: ${url}`)}`} target="_blank" rel="noreferrer" className="flex-1 rounded-lg bg-[#25d366] py-2 text-xs font-bold text-white">Share on WhatsApp</a>
        </div>
      </div>
    </div>
  );
};
