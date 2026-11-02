import type { Panel } from '../engine/panel';
import type { Message } from '../types/groupOs';

/** Client side of the live rooms API (server/live/http.ts). */

export interface BotAction {
  label: string;
  action: string;
  args: Record<string, string>;
  onlyFor?: string;
}

export interface LiveMessage extends Message {
  actions?: BotAction[];
  reason?: string;
  audioUrl?: string;
  imageUrl?: string;
  fromScreenshot?: boolean;
  sources?: { title: string; url: string }[];
}

export interface Person {
  id: string;
  name: string;
  phone?: string;
  upi?: string;
  /** Has joined on a phone (not just added by someone). */
  joined?: boolean;
}

export interface Snapshot {
  room: { id: string; title: string; example?: boolean; readBy?: { model: string; at: number; messages: number; calls: number; tokens: number; ms: number }; canReadFromScratch?: boolean };
  me: Person;
  members: Person[];
  messages: LiveMessage[];
  total: number;
  /** Index of the first message shown. */
  start: number;
  read: number;
  people: number;
  /** The last message Sorted has read, and when it reads next (if new messages are waiting). */
  lastReadId?: string;
  nextReadAt?: number;
  burst: number;
  /** A calm note while reading waits (the credit safety net). */
  note?: string;
  panel: Panel;
  analysing: boolean;
  label?: string;
  lastAnalysis?: { at: number; ms: number; newMessages: number; topics: number; tokens: number; error?: string };
}

export type LiveEvent =
  | { type: 'message'; message: LiveMessage }
  | { type: 'panel'; panel: Panel; analysing: boolean; lastAnalysis?: Snapshot['lastAnalysis']; read: number; people: number }
  | { type: 'members'; members: { id: string; name: string }[] }
  | { type: 'analysing'; on: boolean; label?: string }
  | { type: 'reading'; read: number; people: number; lastReadId?: string; nextReadAt?: number; burst: number; note?: string };

export interface GroupSummary {
  roomId: string;
  title: string;
  example?: boolean;
  me: string;
  last: { speaker: string; text: string; at: number } | null;
  total: number;
  topics: number;
  disagreements: number;
  decided: number;
  owe: string;
  owed: string;
  oweTotals: { currency: string; amount: number }[];
  owedTotals: { currency: string; amount: number }[];
  unread: number;
  nextReadAt?: number;
  reading: boolean;
}

const KEY = (roomId: string) => `groupos_live_${roomId}`;
const SESSION = 'groupos_session';

/** "919876543210" → "+91 98765 43210" (Indian numbers); other numbers just get their "+". */
export const phoneText = (digits: string) => (/^91\d{10}$/.test(digits) ? `+91 ${digits.slice(2, 7)} ${digits.slice(7)}` : `+${digits}`);

export interface AccountSummary {
  username: string;
  name: string;
  phone?: string;
  seats: { roomId: string; token: string; demo?: string; owner?: boolean }[];
  scope: string[];
}

/** The logged-in account's session, kept on this device. */
export const session = {
  get: (): string | null => {
    try {
      return localStorage.getItem(SESSION);
    } catch {
      return null;
    }
  },
  set: (s: string | null) => {
    try {
      if (s) localStorage.setItem(SESSION, s);
      else localStorage.removeItem(SESSION);
    } catch {
      /* private window */
    }
  },
};

/** Mirror the account's groups on this device, so every screen reads them the same way. */
export function adoptAccount(a: AccountSummary) {
  try {
    Object.keys(localStorage).filter(k => k.startsWith('groupos_live_') && k !== 'groupos_live_tip').forEach(k => localStorage.removeItem(k));
    a.seats.forEach(s => localStorage.setItem(KEY(s.roomId), s.token));
    // Ticked to-dos belong to the person who ticked them.
    if (localStorage.getItem('groupos_done_owner') !== a.username) {
      localStorage.removeItem('groupos_done');
      localStorage.setItem('groupos_done_owner', a.username);
    }
    localStorage.setItem('groupos_scope', JSON.stringify(a.scope));
  } catch {
    /* private window */
  }
}
const SCOPE = 'groupos_scope';

/** Which groups My Sorted follows, on this phone. Not set yet means all of them. */
export const scope = {
  get: (): string[] | null => {
    try {
      const raw = localStorage.getItem(SCOPE);
      return raw ? (JSON.parse(raw) as string[]) : null;
    } catch {
      return null;
    }
  },
  set: (ids: string[]) => {
    try {
      localStorage.setItem(SCOPE, JSON.stringify(ids));
    } catch {
      /* private window: the choice lasts until the page closes */
    }
    // Saved to the account too, so it follows you to another device.
    if (session.get()) void api.saveScope(ids).catch(() => undefined);
  },
  has: (roomId: string) => {
    const s = scope.get();
    return s === null || s.includes(roomId);
  },
};

/** Your seat in a room is remembered on this device only, so reopening the link puts you back in. */
export const savedToken = (roomId: string): string | null => {
  try {
    return localStorage.getItem(KEY(roomId));
  } catch {
    return null;
  }
};
export const saveToken = (roomId: string, token: string) => {
  try {
    localStorage.setItem(KEY(roomId), token);
  } catch {
    /* private window: you will be asked your name again next time */
  }
};
export const forgetToken = (roomId: string) => {
  try {
    localStorage.removeItem(KEY(roomId));
  } catch {
    /* ignore */
  }
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || body.message || `Request failed (${res.status})`), { status: res.status });
  return body as T;
}

const post = <T,>(path: string, body: unknown) => call<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const api = {
  create: (title: string, name: string, sample: false | 'live' | 'ready' = false) => post<{ roomId: string; token?: string; people: string[] }>('/live/api/rooms', { title, name, sample, session: session.get() }),
  login: (phone: string, pin: string, signup: boolean, name?: string) => post<{ session: string; isNew: boolean; account: AccountSummary }>('/live/api/account/login', { phone, pin, signup, name }),
  account: () => call<{ account: AccountSummary }>('/live/api/account', { headers: { 'x-groupos-session': session.get() ?? '' } }),
  logout: () => post<{ ok: boolean }>('/live/api/account/logout', { session: session.get() }),
  addSeat: (roomId: string, token: string, owner = false) => post<{ ok: boolean }>('/live/api/account/seat', { session: session.get(), roomId, token, owner }),
  saveScope: (ids: string[]) => post<{ ok: boolean }>('/live/api/account/scope', { session: session.get(), scope: ids }),
  deleteGroup: (roomId: string) => post<{ ok: boolean; deleted: boolean; account: AccountSummary }>('/live/api/account/delete', { session: session.get(), roomId }),
  mine: (roomId: string, token: string) => call<{ room: { id: string; title: string }; me: string }>(`/live/api/rooms/${roomId}?lite=1&token=${encodeURIComponent(token)}`),
  peek: (roomId: string) => call<{ room: { id: string; title: string }; people: string[] }>(`/live/api/rooms/${roomId}`),
  join: (roomId: string, name: string) => post<{ token: string }>(`/live/api/rooms/${roomId}/join`, { name }),
  snapshot: (roomId: string, token: string) => call<Snapshot>(`/live/api/rooms/${roomId}?token=${encodeURIComponent(token)}`),
  send: (roomId: string, token: string, text: string) => post<{ ok: boolean }>(`/live/api/rooms/${roomId}/messages?token=${encodeURIComponent(token)}`, { text }),
  tripQuestions: (roomId: string, token: string, topicId: string) =>
    call<{ trip: string; facts: Record<string, string>; quotes: Record<string, string>; fields: { key: string; label: string }[]; groupSize: number }>(`/live/api/rooms/${roomId}/plan?token=${encodeURIComponent(token)}&topicId=${encodeURIComponent(topicId)}`),
  planTrip: (roomId: string, token: string, topicId: string, answers: Record<string, string>) => post<{ ok: boolean; message?: string }>(`/live/api/rooms/${roomId}/plan?token=${encodeURIComponent(token)}`, { topicId, answers }),
  readNow: (roomId: string, token: string) => post<{ ok: boolean; message?: string }>(`/live/api/rooms/${roomId}/read?token=${encodeURIComponent(token)}`, {}),
  act: (roomId: string, token: string, action: string, args: Record<string, string>) => post<{ ok: boolean; message?: string }>(`/live/api/rooms/${roomId}/action?token=${encodeURIComponent(token)}`, { action, args }),
  readFromScratch: (roomId: string, token: string) => post<{ ok: boolean; message?: string }>(`/live/api/rooms/${roomId}/scratch?token=${encodeURIComponent(token)}`, {}),
  remind: (roomId: string, token: string, name: string, send = false) => post<{ ok: boolean; message: string; preview?: string; ready?: boolean }>(`/live/api/rooms/${roomId}/remind?token=${encodeURIComponent(token)}`, { name, send }),
  addPerson: (roomId: string, token: string, name: string, phone: string) => post<{ ok: boolean; name: string; joined: boolean }>(`/live/api/rooms/${roomId}/person?token=${encodeURIComponent(token)}`, { name, phone }),
  me: (roomId: string, token: string, patch: { phone?: string; upi?: string }) => post<{ ok: boolean }>(`/live/api/rooms/${roomId}/me?token=${encodeURIComponent(token)}`, patch),
  voice: async (roomId: string, token: string, audio: Blob) => {
    const res = await fetch(`/live/api/rooms/${roomId}/voice?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': audio.type || 'audio/webm' }, body: audio });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'The voice note could not be sent.');
    return body as { transcript: string };
  },
  image: async (roomId: string, token: string, file: Blob) => {
    const res = await fetch(`/live/api/rooms/${roomId}/image?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': file.type || 'image/jpeg' }, body: file });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'That image could not be read.');
    return body as { kind: string };
  },
  /** Every seat this phone holds, for private questions across groups. */
  seats: (): { roomId: string; token: string }[] => {
    try {
      return Object.keys(localStorage)
        .filter(k => k.startsWith('groupos_live_'))
        .map(k => ({ roomId: k.slice('groupos_live_'.length), token: localStorage.getItem(k) ?? '' }))
        .filter(s => s.token);
    } catch {
      return [];
    }
  },
  details: (seats: { roomId: string; token: string }[]) => post<unknown>('/live/api/details', { seats }),
  myGroups: (seats: { roomId: string; token: string }[]) =>
    post<{ groups: GroupSummary[] }>('/live/api/mine', { seats }),
  /** Seats of the groups My Sorted follows. */
  scopedSeats: () => api.seats().filter(s => scope.has(s.roomId)),
  ask: (seats: { roomId: string; token: string }[], text: string) => post<{ text: string; ok: boolean; groups: number }>('/live/api/private', { seats, text }),
  wrapped: (roomId: string, token: string) => call<{ stats: import('../engine/wrapped').Wrapped; art?: string }>(`/live/api/rooms/${roomId}/wrapped?token=${encodeURIComponent(token)}`),
  listen: async (roomId: string, token: string, audio: Blob) => {
    const res = await fetch(`/live/api/rooms/${roomId}/listen?token=${encodeURIComponent(token)}`, { method: 'POST', headers: { 'content-type': audio.type || 'audio/webm' }, body: audio });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'That recording could not be read.');
    return body as { turns: { speaker: string; text: string }[]; audioUrl: string };
  },
  conversation: (roomId: string, token: string, turns: { name: string; text: string }[], audioUrl?: string) =>
    post<{ ok: boolean; message?: string }>(`/live/api/rooms/${roomId}/conversation?token=${encodeURIComponent(token)}`, { turns, audioUrl }),
  history: (roomId: string, token: string, q: { before?: number; around?: string }) =>
    call<{ messages: LiveMessage[]; start: number }>(`/live/api/rooms/${roomId}/history?token=${encodeURIComponent(token)}${q.before !== undefined ? `&before=${q.before}` : ''}${q.around ? `&around=${encodeURIComponent(q.around)}` : ''}`),
  events: (roomId: string, token: string) => new EventSource(`/live/api/rooms/${roomId}/events?token=${encodeURIComponent(token)}`),
};

/** "Pay on WhatsApp": opens the chat with the person you owe, with the note ready; you pay there with WhatsApp Pay. */
export const whatsappPayLink = (phone: string, text: string) => `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
/** Any UPI app, amount filled in. The person approves the payment in their own app. */
export const upiLink = (upi: string, name: string, amount: number, note: string) =>
  `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(name)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note.slice(0, 50))}`;
