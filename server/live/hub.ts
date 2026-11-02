import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { applyProposals, resolveConflict, ConflictChoice } from '../../src/engine/eventReducer';
import { buildPanel, Panel } from '../../src/engine/panel';
import { computeWrapped } from '../../src/engine/wrapped';
import { addTrace } from '../whatsapp/store';
import { normalizePhone } from './accounts';
import { asWork, check, Resting } from './budget';
import { channelReady, env as waEnv, sendCloudTemplate, sendText } from '../whatsapp/channels';
import { buildReminder } from '../../src/engine/reminder';
import { computeGroupLedger, computeMySettlement, dedupeBills } from '../../src/engine/settle';
import { summarizeGroupsForModel } from '../../src/engine/privateView';
import { computeGroupPlan, totalsText } from '../../src/engine/plan';
import { normalizeCurrency } from '../../src/engine/receiptVerifier';
import { MetaModelService } from '../../src/services/metaModelService';
import { markSharePaid } from '../../src/engine/shares';
import { assessReceipt, attachReceipt, confirmPayment, disputePayment, normRef, sameName, usedReferences } from '../../src/engine/receiptVerifier';
import { ImageReading } from '../../src/services/imageReader';
import { analyzeGroup } from '../../src/services/groupAnalyzer';
import { answerGroupQuestion } from '../../src/services/groupQuestion';
import { planTrip, tripBrief, tripFacts, TripFacts, TRIP_FACTS } from '../../src/services/tripPlanner';
import { GroupIntelligenceState, Message, User, Workspace } from '../../src/types/groupOs';

/**
 * Live rooms: a group chat that real people join from their phones (QR or link), with Sorted as a member.
 * Messages are stored in SQLite and pushed to every phone at once (server-sent events). After each burst of messages
 * the room is read with the topic pipeline (only new messages), the panel is rebuilt in code and pushed, and
 * Sorted speaks up when something needs the group: a new disagreement, a payment someone says they made, a new
 * split. When it speaks is decided by these rules, not by the model.
 */

export interface LiveMember {
  id: string;
  name: string;
  token: string;
  joinedAt: number;
  /** For "Pay on WhatsApp": digits with country code, given by the person. */
  phone?: string;
  upi?: string;
  /** Someone has taken this seat on a device. Seats in the sample group start unclaimed. */
  claimed?: boolean;
}

export interface BotAction {
  label: string;
  action: string;
  args: Record<string, string>;
  /** Only this member may press it (for example, only the payee confirms a payment). */
  onlyFor?: string;
}

export interface LiveMessage extends Message {
  actions?: BotAction[];
  /** Sorted messages: what triggered it. */
  reason?: string;
  audioUrl?: string;
  imageUrl?: string;
  /** Read from a screenshot someone shared, not typed in this room. */
  fromScreenshot?: boolean;
  /** Web sources behind a Sorted message (trip ideas). Only links the search returned. */
  sources?: { title: string; url: string }[];
}

export interface Room {
  id: string;
  title: string;
  createdAt: number;
  members: LiveMember[];
  state: GroupIntelligenceState;
  analysing: boolean;
  /** An example group that came with an account: its people are made up, so no real phone can take their seats. */
  example?: boolean;
  /** The account that created the group: only it can delete the group for everyone. */
  owner?: string;
  /** An example group someone asked to read again from the first message (allowed once). */
  rereadFromScratch?: boolean;
  lastAnalysis?: { at: number; ms: number; newMessages: number; topics: number; tokens: number; error?: string };
}

type Event = { type: 'message'; message: LiveMessage } | { type: 'panel'; panel: Panel; analysing: boolean; lastAnalysis?: Room['lastAnalysis']; read: number; people: number } | { type: 'members'; members: { id: string; name: string }[] } | { type: 'analysing'; on: boolean; label?: string }
  | { type: 'reading'; read: number; people: number; lastReadId?: string; nextReadAt?: number; burst: number };

const BOT = 'Sorted';
/** "@Sorted" asks Sorted a question ("@GroupOS", its old name, still works). */
const MENTION = /@\s?(?:sorted|group\s?os)\b/i;
/**
 * When Sorted reads, so a busy group is not re-read for every message: after BURST new messages, or once the chat
 * has been quiet for QUIET_MS, or straight away for @Sorted, a payment screenshot or "Read now". Each read covers
 * only the new messages and the topics they touch.
 */
export const QUIET_MS = Number(process.env.LIVE_QUIET_MS ?? 60000);
export const BURST = Number(process.env.LIVE_BURST ?? 15);
const SPEAK_GAP_MS = 15000;

/* ---------------- storage ---------------- */

let db: DatabaseSync | null = null;
function open() {
  if (db) return db;
  const file = process.env.GROUP_OS_DB || path.resolve(process.cwd(), 'data/groupos.db');
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS live_rooms (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS live_messages (room TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (room, seq));
  `);
  return db;
}

export function resetLive(file = ':memory:') {
  db?.close();
  db = null;
  rooms.clear();
  deleted.clear();
  process.env.GROUP_OS_DB = file;
}

interface Entry {
  room: Room;
  messages: LiveMessage[];
  listeners: Set<(e: Event) => void>;
  timer?: ReturnType<typeof setTimeout>;
  dirty: boolean;
  lastSpoke: number;
  private: Map<string, LiveMessage[]>;
  /** Payment screenshots waiting for Meta AI to record the payment they prove. */
  receipts: { messageId: string; claimId: string }[];
  /** What Sorted is doing right now, for phones that check in instead of listening. */
  label?: string;
  /** When the next read will happen if nothing else arrives (epoch ms). */
  nextReadAt?: number;
  /** What people changed while a read was running: put back on top of the read's results so nothing is lost. */
  edits?: Patch[];
  /** A calm note while reading waits (the credit safety net), shown instead of a countdown. */
  note?: string;
  /** When anyone last opened or used this group: idle groups are let go from memory (they stay in the database). */
  touched?: number;
}

interface Patch {
  decisions: GroupIntelligenceState['decisions'];
  commitments: GroupIntelligenceState['commitments'];
  conflicts: GroupIntelligenceState['conflicts'];
  evidence: GroupIntelligenceState['evidenceMap'];
}

/** Exactly what a person's action changed: new or changed items (by id) and new evidence. */
function diffState(before: GroupIntelligenceState, after: GroupIntelligenceState): Patch {
  const changed = <T extends { id: string }>(a: T[], b: T[]) => {
    const old = new Map(a.map(x => [x.id, JSON.stringify(x)]));
    return b.filter(x => old.get(x.id) !== JSON.stringify(x));
  };
  const evidence: GroupIntelligenceState['evidenceMap'] = {};
  for (const [k, v] of Object.entries(after.evidenceMap)) if (!before.evidenceMap[k]) evidence[k] = v;
  return { decisions: changed(before.decisions, after.decisions), commitments: changed(before.commitments, after.commitments), conflicts: changed(before.conflicts, after.conflicts), evidence };
}

/** Put people's changes back on top of a read's results (their version of an item wins). */
function replayEdits(entry: Entry, state: GroupIntelligenceState): GroupIntelligenceState {
  if (!entry.edits?.length) return state;
  const upsert = <T extends { id: string }>(list: T[], add: T[]) => [...list.filter(x => !add.some(y => y.id === x.id)), ...add];
  return entry.edits.reduce(
    (st, p) => ({ ...st, decisions: upsert(st.decisions, p.decisions), commitments: upsert(st.commitments, p.commitments), conflicts: upsert(st.conflicts, p.conflicts), evidenceMap: { ...st.evidenceMap, ...p.evidence } }),
    state
  );
}

/** A person's action changes the group's results; while a read runs it is also kept to be put back afterwards. */
function setState(entry: Entry, next: GroupIntelligenceState) {
  if (entry.room.analysing) (entry.edits ??= []).push(diffState(entry.room.state, next));
  entry.room.state = next;
}

/** A group nobody has opened for this long is let go from memory; opening it again reloads it from the database. */
export const IDLE_MS = 30 * 60_000;

/**
 * Let go of idle groups (each example group keeps thousands of messages in memory). Never one that is being read,
 * has someone connected, is waiting to read, or has people's changes waiting: nothing is ever lost.
 */
export function releaseIdle(now = Date.now()): number {
  let released = 0;
  for (const [id, e] of rooms) {
    if (e.room.analysing || e.listeners.size || e.timer || e.edits?.length || e.receipts.length || now - (e.touched ?? 0) < IDLE_MS) continue;
    rooms.delete(id);
    released++;
  }
  return released;
}
if (!(globalThis as any).__groupOsIdleSweep) {
  (globalThis as any).__groupOsIdleSweep = setInterval(() => releaseIdle(), 10 * 60_000);
  (globalThis as any).__groupOsIdleSweep.unref?.();
}

/** Rooms deleted while something was still working on them: never written back. */
const deleted = new Set<string>();
/** How long reading waits before trying again when the credit safety net paused it. */
const RESTING_RETRY_MS = 20 * 60_000;
const rooms = new Map<string, Entry>();
// Background work (reads, paintings, answers) that fails is logged, never fatal: also covers the dev server.
if (!(globalThis as any).__groupOsRejectionGuard) {
  (globalThis as any).__groupOsRejectionGuard = true;
  process.on('unhandledRejection', err => console.error('[sorted] background error:', err));
}

function saveRoom(room: Room) {
  if (deleted.has(room.id)) return;
  open().prepare('INSERT INTO live_rooms (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(room.id, JSON.stringify(room));
}

function saveMessage(roomId: string, seq: number, m: LiveMessage) {
  open().prepare('INSERT OR REPLACE INTO live_messages (room, seq, data) VALUES (?, ?, ?)').run(roomId, seq, JSON.stringify(m));
}

function load(id: string) {
  const cached = rooms.get(id);
  if (cached) {
    cached.touched = Date.now();
    return cached;
  }
  const row = open().prepare('SELECT data FROM live_rooms WHERE id = ?').get(id) as { data: string } | undefined;
  if (!row) return undefined;
  const room = JSON.parse(row.data) as Room;
  room.analysing = false;
  const messages = (open().prepare('SELECT data FROM live_messages WHERE room = ? ORDER BY seq').all(id) as { data: string }[]).map(r => JSON.parse(r.data) as LiveMessage);
  const entry: Entry = { room, messages, listeners: new Set(), dirty: false, lastSpoke: 0, private: new Map(), receipts: [], touched: Date.now() };
  rooms.set(id, entry);
  // After a restart, messages that arrived but were never read get read now.
  if (peopleMessages(entry).length > (room.state.readThrough ?? 0)) schedule(entry);
  // Groups read before their Wrapped background existed get it painted now, in the background.
  else if (room.state.readThrough && key()) setTimeout(() => void ensureArt(entry, wrappedStats(entry).artPrompt).catch(() => undefined), 2000);
  return entry;
}

const newId = (n = 9) => randomBytes(n).toString('base64url');

/* ---------------- rooms and members ---------------- */

export function workspaceOf(room: Room): Workspace {
  return {
    id: room.id,
    title: room.title,
    category: 'Live',
    description: '',
    participants: room.members.map<User>(m => ({ id: m.id, name: m.name, avatarColor: '#008069' })),
    unreadCount: 0,
    lastActivity: '',
    iconName: 'Users',
  };
}

export function createRoom(title: string, seed?: { messages: Message[]; state?: GroupIntelligenceState; people?: string[]; example?: boolean; owner?: string }): Room {
  const id = newId(6);
  const people = seed?.people ?? [];
  const room: Room = {
    id,
    title: title.trim().slice(0, 60) || 'Our group',
    createdAt: Date.now(),
    members: people.map(name => ({ id: `p_${name.toLowerCase().replace(/\W+/g, '_')}`, name, token: newId(), joinedAt: Date.now(), claimed: false })),
    state: seed?.state ?? { decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [], topics: [], readThrough: 0 },
    analysing: false,
    ...(seed?.example ? { example: true } : {}),
    ...(seed?.owner ? { owner: seed.owner } : {}),
  };
  saveRoom(room);
  const messages: LiveMessage[] = (seed?.messages ?? []).map(m => ({ ...m, conversationId: id }));
  const tx = open();
  tx.exec('BEGIN');
  messages.forEach((m, i) => saveMessage(id, i, m));
  tx.exec('COMMIT');
  rooms.set(id, { room, messages, listeners: new Set(), dirty: false, lastSpoke: 0, private: new Map(), receipts: [], touched: Date.now() });
  return room;
}

/**
 * Join by name. A name already taken by someone on a device is refused, so nobody can act as someone else. In the
 * sample group, the people in the chat start as open seats that a visitor can take once.
 */
export function joinRoom(roomId: string, name: string): { member?: LiveMember; error?: string } {
  const entry = load(roomId);
  if (!entry) return { error: 'This room does not exist' };
  const clean = name.trim().slice(0, 30);
  if (!clean || clean.toLowerCase() === BOT.toLowerCase()) return { error: 'Type a name' };
  let member = entry.room.members.find(m => m.name.toLowerCase() === clean.toLowerCase());
  if (member && member.claimed !== false) return { error: `${member.name} is already in this group on another phone. Pick another name.` };
  // A seat kept for someone's phone number is theirs: it opens when they log in with that number.
  if (member?.phone) return { error: `${member.name}'s place is kept for their phone number. They get in by logging in to Sorted with it.` };
  // Two names Sorted could mix up ("Ravi" and "Ravi K") would mix up their money.
  const near = !member && entry.room.members.find(m => sameName(m.name, clean) === true);
  if (near) return { error: `Someone called ${near.name} is already in this group. Use a name that is clearly different, for example with your surname.` };
  if (member) member.claimed = true;
  else {
    member = { id: `p_${newId(4)}`, name: clean, token: newId(), joinedAt: Date.now(), claimed: true };
    entry.room.members.push(member);
  }
  saveRoom(entry.room);
  emit(entry, { type: 'members', members: entry.room.members.map(m => ({ id: m.id, name: m.name })) });
  return { member };
}

/** Names a visitor can still pick: open seats in the sample group. */
export const openSeats = (room: Room) => room.members.filter(m => m.claimed === false && !m.phone).map(m => m.name);

export function memberFor(roomId: string, token: string | null | undefined) {
  const entry = load(roomId);
  const member = entry?.room.members.find(m => m.token === token);
  return entry && member ? { entry, member } : undefined;
}

/**
 * Add a person to a group by name and phone (or give a phone to someone who has not joined yet). When they log in with
 * that number, the seat is theirs. People who already joined keep their own number; example groups have no real people.
 */
export function addPerson(roomId: string, token: string, name: string, phone: string): { member?: LiveMember; error?: string } {
  const found = memberFor(roomId, token);
  if (!found) return { error: 'You are not in this group' };
  const { entry } = found;
  if (entry.room.example) return { error: 'The people in example groups are made up, so they cannot have real numbers.' };
  const p = normalizePhone(phone);
  if (!p) return { error: 'Enter a mobile number, e.g. 98765 43210 or +91 98765 43210.' };
  const clean = name.trim().slice(0, 30);
  if (!clean || clean.toLowerCase() === BOT.toLowerCase()) return { error: 'Type a name' };
  if (entry.room.members.some(m => m.phone === p && m.name.toLowerCase() !== clean.toLowerCase())) return { error: 'Someone in this group already has that number' };
  let member = entry.room.members.find(m => m.name.toLowerCase() === clean.toLowerCase());
  if (member && member.claimed !== false) return { error: `${member.name} has already joined; they add their own number.` };
  if (!member) {
    member = { id: `p_${newId(4)}`, name: clean, token: newId(), joinedAt: Date.now(), claimed: false };
    entry.room.members.push(member);
  }
  member.phone = p;
  saveRoom(entry.room);
  emit(entry, { type: 'members', members: entry.room.members.map(m => ({ id: m.id, name: m.name })) });
  return { member };
}

/** Seats waiting for this phone number in real (not example) groups: the person takes them when they log in. */
export function seatsForPhone(phone: string): { roomId: string; token: string }[] {
  const rows = open().prepare('SELECT id FROM live_rooms WHERE data LIKE ?').all(`%"phone":"${phone.replace(/\D/g, '')}"%`) as { id: string }[];
  const out: { roomId: string; token: string }[] = [];
  for (const { id } of rows) {
    const entry = load(id);
    const member = entry?.room.members.find(m => m.phone === phone && m.claimed === false);
    if (!entry || entry.room.example || !member) continue;
    member.claimed = true;
    saveRoom(entry.room);
    emit(entry, { type: 'members', members: entry.room.members.map(m => ({ id: m.id, name: m.name })) });
    out.push({ roomId: id, token: member.token });
  }
  return out;
}

/** Example groups small enough to watch being read from the first message, once per person. */
export const SCRATCH_MAX = 1000;

/**
 * Forget everything Sorted worked out for an example group and read it again from the first message, live, so a
 * person can watch real Meta reads build the topics and money. Only small example groups, once.
 */
export function readFromScratch(roomId: string, token: string): { ok: boolean; message?: string } {
  const found = memberFor(roomId, token);
  if (!found) return { ok: false, message: 'You are not in this group' };
  const { entry } = found;
  if (!entry.room.example) return { ok: false, message: 'Only example groups can be read again from scratch.' };
  if (peopleMessages(entry).length > SCRATCH_MAX) return { ok: false, message: 'This group is too long to read again here; Gym Squad is the one to watch.' };
  if (entry.room.rereadFromScratch) return { ok: false, message: 'This group was already read again from scratch.' };
  if (entry.room.analysing) return { ok: false, message: 'Sorted is reading right now; try again in a moment.' };
  entry.room.rereadFromScratch = true;
  entry.room.state = { decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [], topics: [], readThrough: 0 };
  saveRoom(entry.room);
  pushPanel(entry);
  botMessage(entry, `🔁 Reading this whole group again from the first message with Meta AI, live. Watch the topics and money build up in the panel.`, { reason: 'scratch' });
  schedule(entry, true);
  return { ok: true };
}

/** Read a group's unread messages soon (after the usual quiet wait), e.g. right after it was set up. */
export function readSoon(roomId: string) {
  const entry = load(roomId);
  if (entry) schedule(entry);
}

export function updateMember(roomId: string, token: string, patch: { phone?: string; upi?: string }) {
  const found = memberFor(roomId, token);
  if (!found) return false;
  if (patch.phone !== undefined) found.member.phone = patch.phone.replace(/\D/g, '').slice(0, 15) || undefined;
  if (patch.upi !== undefined) found.member.upi = /^[\w.\-]{2,}@[\w]{2,}$/.test(patch.upi.trim()) ? patch.upi.trim() : undefined;
  saveRoom(found.entry.room);
  return true;
}

export function snapshot(roomId: string, token: string) {
  const found = memberFor(roomId, token);
  if (!found) return undefined;
  const { entry, member } = found;
  return {
    room: {
      id: entry.room.id,
      title: entry.room.title,
      example: !!entry.room.example,
      readBy: entry.room.state.readBy,
      canReadFromScratch: !!entry.room.example && !entry.room.rereadFromScratch && peopleMessages(entry).length <= SCRATCH_MAX,
    },
    me: { id: member.id, name: member.name, phone: member.phone, upi: member.upi },
    members: entry.room.members.map(m => ({ id: m.id, name: m.name, phone: m.phone, upi: m.upi, joined: m.claimed !== false })),
    messages: entry.messages.slice(-400),
    total: entry.messages.length,
    start: Math.max(0, entry.messages.length - 400),
    /** People's messages Sorted has read (its own messages are never read). */
    ...readingStatus(entry),
    panel: buildPanel(workspaceOf(entry.room), entry.room.state, entry.messages, { defaultCurrency: '₹' }),
    analysing: entry.room.analysing,
    label: entry.room.analysing ? entry.label : undefined,
    lastAnalysis: entry.room.lastAnalysis,
    privateMessages: entry.private.get(member.id) ?? [],
  };
}

/** A window of older messages: the ones before `before`, or the ones around a message (for "see the message"). */
export function messageWindow(roomId: string, token: string, opts: { before?: number; around?: string }, size = 300) {
  const found = memberFor(roomId, token);
  if (!found) return undefined;
  const all = found.entry.messages;
  let end = Math.min(opts.before ?? all.length, all.length);
  if (opts.around) {
    const at = all.findIndex(m => m.id === opts.around);
    if (at < 0) return { messages: [], start: 0 };
    end = Math.min(all.length, at + Math.floor(size / 2));
  }
  const start = Math.max(0, end - size);
  return { messages: all.slice(start, end), start };
}

export function subscribe(roomId: string, token: string, listener: (e: Event) => void): (() => void) | undefined {
  const found = memberFor(roomId, token);
  if (!found) return undefined;
  found.entry.listeners.add(listener);
  return () => found.entry.listeners.delete(listener);
}

function emit(entry: Entry, e: Event) {
  if (e.type === 'analysing') entry.label = e.on ? e.label ?? entry.label : undefined;
  entry.listeners.forEach(l => {
    try {
      l(e);
    } catch {
      /* a closed connection */
    }
  });
}

/* ---------------- messages ---------------- */

function append(entry: Entry, m: LiveMessage) {
  entry.messages.push(m);
  saveMessage(entry.room.id, entry.messages.length - 1, m);
  emit(entry, { type: 'message', message: m });
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

export function botMessage(entry: Entry, content: string, extra: Partial<LiveMessage> = {}) {
  const now = Date.now();
  const m: LiveMessage = {
    id: `b_${newId(6)}`,
    conversationId: entry.room.id,
    speakerId: 'groupos',
    speakerName: BOT,
    timestamp: clock(now),
    content,
    type: 'system',
    createdAt: now,
    provenance: { source: 'meta', visibility: 'group' },
    ...extra,
  };
  append(entry, m);
  return m;
}

export interface PostOptions {
  type?: Message['type'];
  audioUrl?: string;
  imageUrl?: string;
}

export function postMessage(roomId: string, token: string, text: string, opts: PostOptions = {}): LiveMessage | undefined {
  const found = memberFor(roomId, token);
  const content = text.trim().slice(0, 4000);
  if (!found || !content) return undefined;
  const { entry, member } = found;
  const now = Date.now();
  const m: LiveMessage = {
    id: `l_${newId(6)}`,
    conversationId: roomId,
    speakerId: member.id,
    speakerName: member.name,
    timestamp: clock(now),
    content,
    type: opts.type ?? 'text',
    createdAt: now,
    ...(opts.audioUrl ? { audioUrl: opts.audioUrl } : {}),
    ...(opts.imageUrl ? { imageUrl: opts.imageUrl } : {}),
  };
  append(entry, m);
  if (MENTION.test(content)) void answerMention(entry, content, member.name);
  schedule(entry);
  return m;
}

/* ---------------- analysis and speaking up ---------------- */

/** Live-room activity goes on the same trace page as WhatsApp (/whatsapp/trace), so every Meta call can be checked. */
function trace(entry: Entry, summary: string) {
  try {
    addTrace({ channel: 'live', direction: 'model', phone: entry.room.id, summary });
  } catch {
    /* tracing never breaks the room */
  }
}

const key = () => process.env.MODEL_API_KEY?.trim() || '';

/** Where reading stands: how many people's messages are read, the last one read, and when the next read is due. */
export function readingStatus(entry: Entry) {
  const people = peopleMessages(entry);
  const read = Math.min(entry.room.state.readThrough ?? 0, people.length);
  return { read, people: people.length, lastReadId: read ? people[read - 1].id : undefined, nextReadAt: entry.note ? undefined : entry.nextReadAt, burst: BURST, note: entry.note };
}

function schedule(entry: Entry, now = false) {
  if (entry.timer) clearTimeout(entry.timer);
  const unread = peopleMessages(entry).length - (entry.room.state.readThrough ?? 0);
  const wait = now || unread >= BURST ? 0 : QUIET_MS;
  entry.nextReadAt = unread > 0 ? Date.now() + wait : undefined;
  emit(entry, { type: 'reading', ...readingStatus(entry) });
  if (unread <= 0) return;
  entry.timer = setTimeout(() => {
    entry.timer = undefined;
    void analyse(entry);
  }, wait);
}

/** Only people's messages are read: Sorted's own messages are never evidence. */
const peopleMessages = (entry: Entry) => entry.messages.filter(m => m.speakerId !== 'groupos');

export async function analyse(entry: Entry): Promise<void> {
  if (!key()) return;
  if (entry.room.analysing) {
    entry.dirty = true;
    return;
  }
  const messages = peopleMessages(entry);
  if ((entry.room.state.readThrough ?? 0) >= messages.length) return;
  // The credit safety net decides before a read starts; once started, a read always finishes.
  const kind = entry.room.example ? 'background' : 'interactive';
  try {
    check({ kind, roomId: entry.room.id });
  } catch (err) {
    if (!(err instanceof Resting)) throw err;
    entry.note = err.message;
    emit(entry, { type: 'reading', ...readingStatus(entry) });
    setTimeout(() => ((entry.note = undefined), schedule(entry)), RESTING_RETRY_MS);
    return;
  }
  entry.note = undefined;
  entry.room.analysing = true;
  emit(entry, { type: 'analysing', on: true });
  const before = entry.room.state;
  try {
    // Example groups are background reading; a real group's own chat is interactive (it pauses last).
    const { state, report } = await asWork({ kind, roomId: entry.room.id, started: true }, () => analyzeGroup(messages, before, {
      apiKey: key(),
      groupId: entry.room.id,
      onProgress: p =>
        emit(entry, {
          type: 'analysing',
          on: true,
          label:
            p.stage === 'tagging'
              ? `Sorting ${(messages.length - (before.readThrough ?? 0)).toLocaleString('en-IN')} new message${messages.length - (before.readThrough ?? 0) === 1 ? '' : 's'} into topics… ${p.done + 1} of ${p.total}`
              : p.stage === 'analysing'
              ? `Reading topics with Meta AI… ${p.done} of ${p.total} done`
              : undefined,
        }),
      // Show results as they arrive: the panel fills topic by topic.
      onPartial: partial => {
        entry.room.state = replayEdits(entry, partial);
        pushPanel(entry);
      },
    }));
    entry.room.state = replayEdits(entry, dropReceiptCopies(entry, state));
    entry.room.lastAnalysis = { at: Date.now(), ms: report.ms, newMessages: report.newMessages, topics: state.topics?.length ?? 0, tokens: report.tokens, ...(report.failedTopics.length ? { error: report.failedTopics.map(f => f.title).join(', ') } : {}) };
    // Paint the Wrapped background now, in the background, so the card opens at once later.
    void ensureArt(entry, wrappedStats(entry).artPrompt).catch(() => undefined);
    // A first reading of a long chat gets one summary, not a burst of announcements.
    if ((before.readThrough ?? 0) === 0 && report.newMessages > 50) {
      const s = dedupeBills(entry.room.state);
      const panel = buildPanel(workspaceOf(entry.room), s, entry.messages, { defaultCurrency: '₹' });
      botMessage(entry, `I read all ${report.newMessages.toLocaleString('en-IN')} messages: *${s.topics?.length ?? 0} topics*, ${s.decisions.filter(d => d.status === 'confirmed').length} things decided, ${s.conflicts.filter(c => c.status === 'open').length} open disagreements, ${s.commitments.filter(c => c.status === 'needs_clarification').length} payments waiting for confirmation. Shared costs so far: ${panel.spend}. Open the panel to see each topic and who owes whom.`, { reason: 'first-read' });
    } else speakUp(entry, before, entry.room.state);
    if (entry.room.state.topics?.length) void ensureArt(entry, wrappedStats(entry).artPrompt);
    trace(entry, `Meta muse-spark: read ${report.newMessages} new message(s) of "${entry.room.title}": ${report.batches} topic batch(es), ${report.topicsCreated.length} new topic(s), ${report.topicsUpdated.length} updated, ${report.calls} calls, ${report.tokens.toLocaleString()} tokens, ${Math.round(report.ms / 1000)}s${report.corrections.length ? `, ${report.corrections.length} tag(s) corrected in code` : ''}`);
  } catch (err: any) {
    entry.room.lastAnalysis = { at: Date.now(), ms: 0, newMessages: 0, topics: entry.room.state.topics?.length ?? 0, tokens: 0, error: err?.message ?? String(err) };
  } finally {
    entry.edits = [];
    entry.room.analysing = false;
    saveRoom(entry.room);
    pushPanel(entry);
    entry.nextReadAt = undefined;
    emit(entry, { type: 'reading', ...readingStatus(entry) });
    if (entry.dirty) {
      entry.dirty = false;
      schedule(entry);
    }
  }
}

export function pushPanel(entry: Entry) {
  emit(entry, { type: 'panel', panel: buildPanel(workspaceOf(entry.room), entry.room.state, entry.messages, { defaultCurrency: '₹' }), analysing: entry.room.analysing, lastAnalysis: entry.room.lastAnalysis, read: entry.room.state.readThrough ?? 0, people: peopleMessages(entry).length });
}

const topicTitle = (state: GroupIntelligenceState, topicId?: string) => state.topics?.find(t => t.id === topicId)?.title;

/** What changed since the last reading that the group should hear about now. Rules, not the model, decide. */
export function speakUp(entry: Entry, before: GroupIntelligenceState, after: GroupIntelligenceState) {
  const now = Date.now();
  if (now - entry.lastSpoke < SPEAK_GAP_MS) return;
  const seen = (ids: string[]) => new Set(ids);
  const oldConflicts = seen(before.conflicts.map(c => c.id));
  const oldClaims = seen(before.commitments.filter(c => c.status === 'needs_clarification').map(c => c.id));
  const oldSplits = new Map(before.decisions.filter(d => d.split).map(d => [d.id, d.split!.perPerson || d.split!.total]));
  const lines: string[] = [];
  const actions: BotAction[] = [];

  for (const c of after.conflicts.filter(c => c.status === 'open' && !oldConflicts.has(c.id)).slice(0, 2)) {
    const where = topicTitle(after, c.topicId);
    lines.push(`⚠️ ${where ? `*${where}*: ` : ''}${c.description}`);
    if (c.incumbentValue && c.challengerValue)
      actions.push(
        { label: `Keep ${c.incumbentValue.slice(0, 24)}`, action: 'resolve', args: { conflictId: c.id, choice: 'keep_current' } },
        { label: `Switch to ${c.challengerValue.slice(0, 24)}`, action: 'resolve', args: { conflictId: c.id, choice: 'adopt_proposal' } },
        { label: 'Different things', action: 'resolve', args: { conflictId: c.id, choice: 'different_subject' } }
      );
    actions.push({ label: 'Suggest a fair fix', action: 'suggest', args: { conflictId: c.id } }, { label: 'We sorted it', action: 'resolve', args: { conflictId: c.id, choice: 'dismiss' } });
  }
  for (const c of after.commitments.filter(c => c.status === 'needs_clarification' && !oldClaims.has(c.id)).slice(0, 2)) {
    const payee = c.payee ? entry.room.members.find(m => sameName(m.name, c.payee) === true) : undefined;
    const shot = c.verification?.state === 'receipt_consistent' ? ' 📷 Their screenshot matches.' : c.verification?.state === 'receipt_mismatch' ? ' 📷 Their screenshot does not match this.' : '';
    lines.push(`💸 ${c.ownerName} says: ${c.description}${c.amount ? ` (${c.currency || '₹'}${c.amount.toLocaleString('en-IN')})` : ''}.${shot} ${c.payee ? `${c.payee}, did you get it?` : 'Who received it?'}`);
    if (payee) actions.push({ label: `Confirm (${payee.name})`, action: 'confirm', args: { commitmentId: c.id }, onlyFor: payee.id }, { label: 'I didn’t get it', action: 'dispute', args: { commitmentId: c.id }, onlyFor: payee.id });
  }
  for (const d of after.decisions.filter(d => d.split && d.status !== 'rejected' && oldSplits.get(d.id) !== (d.split.perPerson || d.split.total)).slice(0, 2)) {
    const where = topicTitle(after, d.topicId);
    const each = d.split!.perPerson ? `${d.split!.currency || '₹'}${d.split!.perPerson.toLocaleString('en-IN')} each` : `${d.split!.currency || '₹'}${(d.split!.total ?? 0).toLocaleString('en-IN')} shared`;
    lines.push(`🧾 ${where ? `*${where}*: ` : ''}${d.topic}, ${each}${d.split!.collector ? `, to ${d.split!.collector}` : ''}${d.status === 'confirmed' ? '' : ' (not agreed yet)'}. It's in everyone's balance.`);
  }
  if (!lines.length) return;
  entry.lastSpoke = now;
  botMessage(entry, lines.join('\n'), { actions, reason: 'speak-up' });
}

async function answerMention(entry: Entry, question: string, asker?: string) {
  if (!key()) return void botMessage(entry, 'I’m not connected to Meta AI on this server yet.');
  // Read what is new first, so the answer includes the latest messages.
  if (peopleMessages(entry).length > (entry.room.state.readThrough ?? 0)) {
    emit(entry, { type: 'analysing', on: true, label: 'Sorted is catching up on the latest messages…' });
    if (!entry.room.analysing) await analyse(entry);
    for (let i = 0; i < 120 && entry.room.analysing; i++) await new Promise(r => setTimeout(r, 1000));
  }
  const deduped = dedupeBills(entry.room.state);
  const ledger = computeGroupLedger(workspaceOf(entry.room), deduped.decisions, deduped.commitments, { conflicts: entry.room.state.conflicts, evidenceMap: entry.room.state.evidenceMap, messages: entry.messages, defaultCurrency: '₹', topics: entry.room.state.topics });
  const moneyLines = ledger.pairs.map(p => `${p.from} owes ${p.to} ${p.currency}${p.amount.toLocaleString('en-IN')} (${p.items.map(i => i.reason).join(', ')})`);
  emit(entry, { type: 'analysing', on: true, label: 'Sorted is typing…' });
  const res = await answerGroupQuestion(key(), question.replace(new RegExp(MENTION.source, 'gi'), '').trim(), {
    groupTitle: entry.room.title,
    topics: entry.room.state.topics ?? [],
    state: entry.room.state,
    messages: peopleMessages(entry),
    moneyLines,
    asker,
  });
  emit(entry, { type: 'analysing', on: entry.room.analysing });
  trace(entry, `Meta ${res.model}: answered @Sorted in "${entry.room.title}" from ${(entry.room.state.topics ?? []).length} topic(s)${res.ok ? '' : ' (failed)'}`);
  botMessage(entry, res.text, { reason: 'mention', provenance: { source: res.ok ? 'meta' : 'local-fallback', model: res.model, visibility: 'group' } });
}

/* ---------------- plan out loud ---------------- */

/**
 * A conversation recorded in the room, split by speaker with Muse Voice. The person who recorded it says which
 * member each voice is; every turn then becomes a message, marked as spoken, and is read like any other.
 */
export function postConversation(roomId: string, token: string, turns: { name: string; text: string }[], audioUrl?: string): { ok: boolean; message?: string } {
  const found = memberFor(roomId, token);
  if (!found) return { ok: false, message: 'Join the room first' };
  const { entry, member } = found;
  const clean = turns.map(t => ({ name: t.name.trim().slice(0, 30), text: t.text.trim().slice(0, 2000) })).filter(t => t.name && t.text);
  if (!clean.length) return { ok: false, message: 'Nothing was said in that recording.' };
  const now = Date.now();
  botMessage(entry, `🎙 ${member.name} recorded the group talking. I separated ${new Set(clean.map(t => t.name)).size} voices and added what each person said below.`, { reason: 'plan-out-loud', audioUrl });
  clean.forEach((t, i) => {
    const known = entry.room.members.find(m => sameName(m.name, t.name) === true);
    append(entry, {
      id: `v_${newId(6)}`,
      conversationId: roomId,
      speakerId: known?.id ?? `voice_${t.name.toLowerCase().replace(/\W+/g, '_')}`,
      speakerName: known?.name ?? t.name,
      timestamp: clock(now),
      content: t.text,
      type: 'voice_transcript',
      createdAt: now + i,
    });
  });
  schedule(entry);
  return { ok: true };
}

/* ---------------- images ---------------- */

/**
 * Payment claims made from a screenshot are created in code (the image already proves who paid what). Meta AI may
 * also record the same payment when it reads the message later; that copy is removed so nothing counts twice.
 */
function dropReceiptCopies(entry: Entry, state: GroupIntelligenceState): GroupIntelligenceState {
  if (!entry.receipts.length) return state;
  const fromImage = new Map(entry.receipts.map(r => [r.messageId, r.claimId]));
  const claims = new Set(entry.receipts.map(r => r.claimId));
  return {
    ...state,
    commitments: state.commitments
      .filter(c => {
        const msg = state.evidenceMap[c.evidenceIds[0]]?.messageId;
        return !(msg && fromImage.has(msg) && fromImage.get(msg) !== c.id);
      })
      // A screenshot payment filed before its cost was known goes under that cost's topic now.
      .map(c => {
        if (!claims.has(c.id) || c.topicId) return c;
        const split = state.decisions.find(d => d.topicId && d.split?.collector && c.payee && sameName(d.split.collector, c.payee) === true && c.amount && Math.abs((d.split.perPerson || 0) - c.amount) < 1);
        return split ? { ...c, topicId: split.topicId } : c;
      }),
  };
}

/** A photo someone sent: a payment screenshot becomes a checked payment claim; a chat screenshot becomes messages. */
export function postImage(roomId: string, token: string, reading: ImageReading | null, imageUrl: string): { ok: boolean; message?: string } {
  const found = memberFor(roomId, token);
  if (!found) return { ok: false, message: 'Join the room first' };
  const { entry, member } = found;
  if (!reading) return { ok: false, message: 'Meta AI could not read that image.' };
  if (reading.kind === 'payment') {
    const f = reading.facts;
    const currency = !f.currency || /inr|rs|₹/i.test(f.currency) ? '₹' : f.currency;
    const amount = f.amount ? `${currency}${f.amount.toLocaleString('en-IN')}` : 'a payment';
    const payee = f.payee ? entry.room.members.find(m => sameName(m.name, f.payee) === true) : undefined;
    const payeeName = payee?.name ?? f.payee ?? 'someone';
    const text = `📷 Paid ${payeeName} ${amount}${f.reference ? ` (ref …${f.reference.slice(-4)})` : ''}`;
    const m = postMessage(roomId, token, text, { imageUrl });
    if (!m) return { ok: false, message: 'Could not post it' };

    // The same screenshot twice (same UPI reference) is one payment: say so, and count nothing new.
    if (f.reference && usedReferences(entry.room.state.commitments).has(normRef(f.reference))) {
      const first = entry.room.state.commitments.find(c => c.verification?.receipt?.reference && normRef(c.verification.receipt.reference) === normRef(f.reference!));
      const firstMsg = first ? entry.messages.find(x => x.id === entry.room.state.evidenceMap[first.evidenceIds[0]]?.messageId) : undefined;
      botMessage(entry, `⚠️ This screenshot (ref …${f.reference.slice(-4)}) was already shared${firstMsg ? ` by ${firstMsg.speakerName} at ${firstMsg.timestamp}` : ''}${first ? ` for "${first.description}"` : ''}. It is the same payment, so it is not counted again.`, { reason: 'receipt-duplicate' });
      saveRoom(entry.room);
      return { ok: true };
    }

    const now = new Date().toLocaleString();
    let state = applyProposals(
      entry.room.state,
      [{ kind: 'commitment', ownerName: member.name, description: `Paid ${payeeName} ${amount}`, status: 'completed', paymentClaim: true, payee: payeeName, ...(f.amount ? { amount: f.amount } : {}), currency, evidence: [{ messageId: m.id, quote: text }] }],
      { conversationId: roomId, messages: entry.messages, actor: 'system', actorLabel: 'Sorted (payment screenshot)', now }
    ).state;
    const claim = state.commitments.find(c => state.evidenceMap[c.evidenceIds[0]]?.messageId === m.id);
    if (claim) {
      state = attachReceipt(state, claim.id, f, assessReceipt(claim, f, usedReferences(state.commitments, claim.id)), { now, actorLabel: member.name, model: 'muse-spark' });
      // File it under the cost it pays for: a split owed to the same person, for the same amount.
      const split = state.decisions.find(d => d.split && d.split.collector && sameName(d.split.collector, payeeName) === true && f.amount && Math.abs((d.split.perPerson || 0) - f.amount) < 1);
      if (split?.topicId) state = { ...state, commitments: state.commitments.map(c => (c.id === claim.id ? { ...c, topicId: split.topicId } : c)) };
      entry.receipts.push({ messageId: m.id, claimId: claim.id });
      const checked = state.commitments.find(c => c.id === claim.id)!.verification?.state;
      const verdict = checked === 'receipt_consistent' ? 'The screenshot is consistent with it.' : checked === 'receipt_duplicate' ? 'This screenshot was already used for another payment.' : checked === 'receipt_mismatch' ? 'Parts of the screenshot do not match.' : '';
      botMessage(entry, `💸 ${member.name} paid ${payeeName} ${amount}${split ? ` for *${split.topic}*` : ''}. ${verdict} ${payee ? `${payee.name}, did you get it?` : 'Only the person who received it can confirm.'}`.replace(/\s+/g, ' ').trim(), {
        reason: 'receipt',
        actions: payee ? [{ label: `Confirm (${payee.name})`, action: 'confirm', args: { commitmentId: claim.id }, onlyFor: payee.id }, { label: 'I didn’t get it', action: 'dispute', args: { commitmentId: claim.id }, onlyFor: payee.id }] : [],
      });
    }
    setState(entry, state);
    saveRoom(entry.room);
    pushPanel(entry);
    return { ok: true };
  }
  if (reading.kind === 'chat') {
    const now = Date.now();
    botMessage(entry, `📸 ${member.name} shared a screenshot${reading.title ? ` of "${reading.title}"` : ''}. I read ${reading.lines.length} message${reading.lines.length === 1 ? '' : 's'} from it and added them below.`, { reason: 'screenshot', imageUrl });
    reading.lines.forEach((l, i) => {
      const speaker = /^you$/i.test(l.speaker) ? member.name : l.speaker;
      const known = entry.room.members.find(m => m.name.toLowerCase() === speaker.toLowerCase());
      append(entry, {
        id: `s_${newId(6)}`,
        conversationId: roomId,
        speakerId: known?.id ?? `shot_${speaker.toLowerCase().replace(/\W+/g, '_')}`,
        speakerName: known?.name ?? speaker,
        timestamp: l.time ?? clock(now),
        content: l.text,
        type: 'text',
        createdAt: now + i,
        fromScreenshot: true,
      });
    });
    schedule(entry);
    return { ok: true };
  }
  return { ok: false, message: `That image isn't a payment or a chat (${reading.summary}).` };
}

/* ---------------- Group Wrapped ---------------- */

const wrappedArt = new Map<string, string>();
const painting = new Map<string, Promise<string | undefined>>();

/** Muse Image paints the recap background once per room, in the background, so the card opens instantly. */
/** Image bytes say what they are; Muse Image may return WebP even when asked for a picture in general. */
const imageType = (b: Buffer) => (b.subarray(0, 4).toString() === 'RIFF' ? 'image/webp' : b[0] === 0xff ? 'image/jpeg' : 'image/png');

/**
 * The Wrapped background from Muse Image. Saved on disk under a name made from the prompt, so a restart keeps it and
 * groups with the same picture (the example groups of every account) share one painting instead of waiting again.
 */
function ensureArt(entry: Entry, prompt: string): Promise<string | undefined> {
  const name = `art_${createHash('sha1').update(prompt).digest('hex').slice(0, 16)}`;
  const dir = path.resolve(process.cwd(), 'data/uploads');
  const file = path.join(dir, `${name}.img`);
  if (wrappedArt.has(name)) return Promise.resolve(wrappedArt.get(name));
  if (existsSync(file)) {
    const bytes = readFileSync(file);
    const art = `data:${imageType(bytes)};base64,${bytes.toString('base64')}`;
    wrappedArt.set(name, art);
    return Promise.resolve(art);
  }
  if (!key()) return Promise.resolve(undefined);
  if (!painting.has(name))
    painting.set(
      name,
      asWork({ kind: 'background', roomId: entry.room.id }, () => MetaModelService.generateImageWithMeta(key(), prompt))
        .then(async res => {
          if (!res.success || !res.data) return undefined;
          const bytes = res.data.startsWith('data:') ? Buffer.from(res.data.split(',')[1] ?? '', 'base64') : await fetch(res.data).then(async r => Buffer.from(await r.arrayBuffer())).catch(() => undefined);
          if (!bytes?.length) return undefined;
          mkdirSync(dir, { recursive: true });
          writeFileSync(file, bytes);
          trace(entry, `Meta muse-image: painted the Wrapped background for "${entry.room.title}" (${Math.round(bytes.length / 1024)} KB)`);
          const art = `data:${imageType(bytes)};base64,${bytes.toString('base64')}`;
          wrappedArt.set(name, art);
          return art;
        })
        .finally(() => painting.delete(name))
    );
  return painting.get(name)!;
}

const wrappedStats = (entry: Entry) =>
  computeWrapped(entry.room.title, entry.messages, entry.room.state, buildPanel(workspaceOf(entry.room), entry.room.state, entry.messages, { defaultCurrency: '₹' }));

/** The recap, counted in code, with the background painted by Muse Image. */
export async function wrapped(roomId: string, token: string) {
  const found = memberFor(roomId, token);
  if (!found) return undefined;
  const stats = wrappedStats(found.entry);
  return { stats, art: await ensureArt(found.entry, stats.artPrompt) };
}

/* ---------------- my groups (the chat list) ---------------- */

/** One line per group this phone is in: last message, what I owe or am owed there, open disagreements. */
export function myGroups(seats: { roomId: string; token: string }[]) {
  return seats
    .map(s => memberFor(s.roomId, s.token))
    .filter((x): x is NonNullable<ReturnType<typeof memberFor>> => !!x)
    .map(({ entry, member }) => {
      const s = dedupeBills(entry.room.state);
      const ledger = computeGroupLedger(workspaceOf(entry.room), s.decisions, s.commitments, { conflicts: s.conflicts, evidenceMap: s.evidenceMap, messages: entry.messages, defaultCurrency: '₹', topics: s.topics });
      const mine = computeMySettlement([ledger], member.name);
      const last = entry.messages[entry.messages.length - 1];
      return {
        roomId: entry.room.id,
        title: entry.room.title,
        example: !!entry.room.example,
        me: member.name,
        last: last ? { speaker: last.speakerName, text: last.content.slice(0, 120), at: last.createdAt } : null,
        total: entry.messages.length,
        topics: s.topics?.length ?? 0,
        disagreements: s.conflicts.filter(c => c.status === 'open').length,
        owe: mine.oweText,
        owed: mine.owedText,
        oweTotals: mine.oweTotals,
        owedTotals: mine.owedTotals,
        decided: s.decisions.filter(d => d.status === 'confirmed').length,
        unread: Math.max(0, peopleMessages(entry).length - (s.readThrough ?? 0)),
        nextReadAt: entry.nextReadAt,
        reading: entry.room.analysing,
      };
    })
    .sort((a, b) => (b.last?.at ?? 0) - (a.last?.at ?? 0));
}

/* ---------------- trip planning ---------------- */

/** "Plan this trip": Muse Spark with web search suggests stays, travel and things to do, posted in the group with its sources. */
/** What the chat already says about a trip, for the person to check and complete before anything is searched. */
export function tripQuestions(roomId: string, token: string, topicId: string) {
  const found = memberFor(roomId, token);
  const topic = found?.entry.room.state.topics?.find(t => t.id === topicId);
  if (!found || !topic) return undefined;
  const { facts, quotes } = tripFacts(topic, found.entry.room.state);
  return { trip: topic.title.split(':')[0].trim(), facts, quotes, fields: TRIP_FACTS, groupSize: found.entry.room.members.length };
}

export async function planTripFor(roomId: string, token: string, topicId: string, answers: TripFacts = {}): Promise<{ ok: boolean; message?: string; missing?: string[] }> {
  const found = memberFor(roomId, token);
  if (!found) return { ok: false, message: 'Join the room first' };
  const { entry, member } = found;
  const topic = entry.room.state.topics?.find(t => t.id === topicId);
  if (!topic) return { ok: false, message: 'That topic is gone' };
  if (!key()) return { ok: false, message: 'Not connected to Meta AI' };
  // Nothing is assumed: every one of these comes from the chat or from the person asking.
  const facts = { ...tripFacts(topic, entry.room.state).facts, ...Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, String(v ?? '').trim().slice(0, 80)]).filter(([, v]) => v)) } as TripFacts;
  const missing = TRIP_FACTS.filter(f => !facts[f.key]).map(f => f.label);
  if (missing.length) return { ok: false, message: `Please fill in: ${missing.join(', ')}.`, missing };
  emit(entry, { type: 'analysing', on: true, label: `Looking up ideas for ${facts.to} on the web…` });
  try {
    const ideas = await planTrip(key(), tripBrief(topic, entry.room.state, facts as Required<TripFacts>));
    trace(entry, `Meta muse-spark + web search: trip ideas for "${topic.title}" (${facts.from} → ${facts.to}, ${facts.dates}, ${facts.budget}, ${facts.people} people), ${ideas.sources.length} sources${ideas.tokens ? `, ${ideas.tokens.toLocaleString()} tokens` : ''}`);
    botMessage(entry, `🧭 *Trip ideas: ${facts.from} → ${facts.to}* (asked by ${member.name})\n_${facts.dates} · ${facts.people} people · budget ${facts.budget}${/per (person|head)|each|pp\b/i.test(facts.budget!) ? '' : ' each'}_\n\n${ideas.text}\n\n_Prices are typical, from the sources below, not live. Nothing is booked._`, { reason: 'trip-ideas', sources: ideas.sources });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: err?.message ?? 'Could not get ideas right now' };
  } finally {
    emit(entry, { type: 'analysing', on: entry.room.analysing });
  }
}

/* ---------------- My Sorted details ---------------- */

/**
 * Everything My Sorted shows for one person, worked out in code from the groups they follow: money with the bills
 * behind it (each group on its own), what is coming up, their promises, and reminders.
 */
export function privateDetails(seats: { roomId: string; token: string }[]) {
  const mine = seats.map(s => memberFor(s.roomId, s.token)).filter((x): x is NonNullable<ReturnType<typeof memberFor>> => !!x);
  const money: { roomId: string; group: string; with: string; direction: 'owe' | 'owed'; amount: number; currency: string; items: { reason: string; amount: number; kind: string }[]; pending: boolean }[] = [];
  const unassigned: { roomId: string; group: string; reason: string; amount: number; currency: string }[] = [];
  const schedule: { roomId: string; group: string; when: string; title: string; sortKey: number; mine: boolean; messageId?: string }[] = [];
  const tasks: { roomId: string; group: string; description: string; status: string; due?: string; to?: string }[] = [];
  const reminders: { roomId: string; group: string; kind: 'pay' | 'confirm' | 'promise' | 'disagreement' | 'recipient'; text: string; messageId?: string; with?: string; amount?: number }[] = [];

  for (const { entry, member } of mine) {
    const ws = workspaceOf(entry.room);
    const s = dedupeBills(entry.room.state);
    const group = entry.room.title;
    const roomId = entry.room.id;
    const me = (n?: string) => !!n && sameName(n, member.name) === true;
    const panel = buildPanel(ws, entry.room.state, entry.messages, { defaultCurrency: '₹' });

    // Money: every topic's netted pairs that involve me, kept per group (never netted against another group).
    const byPerson = new Map<string, (typeof money)[number]>();
    for (const t of panel.topics) {
      for (const m of t.money) {
        if (!me(m.from) && !me(m.to)) continue;
        const other = me(m.from) ? m.to : m.from;
        const sign = me(m.from) ? 1 : -1;
        const key = `${other.toLowerCase()}|${m.currency}`;
        const cur = byPerson.get(key) ?? { roomId, group, with: other, direction: 'owe' as const, amount: 0, currency: m.currency, items: [], pending: false };
        cur.amount += sign * m.amount;
        cur.pending = cur.pending || m.pending;
        cur.items.push({ reason: `${t.title}: ${m.reasons.join(' ')}`, amount: m.amount, kind: sign > 0 ? 'you owe' : 'owes you' });
        byPerson.set(key, cur);
      }
    }
    byPerson.forEach(p => {
      if (Math.abs(p.amount) < 0.5) return;
      money.push({ ...p, direction: p.amount > 0 ? 'owe' : 'owed', amount: Math.round(Math.abs(p.amount) * 100) / 100 });
    });

    const ledger = computeGroupLedger(ws, s.decisions, s.commitments, { conflicts: s.conflicts, evidenceMap: s.evidenceMap, messages: entry.messages, defaultCurrency: '₹', topics: s.topics });
    ledger.unassigned.filter(d => me(d.from) && d.needsRecipient).forEach(d => unassigned.push({ roomId, group, reason: d.reason, amount: d.amount, currency: d.currency }));

    // Schedule: what the group has fixed, and my own promises with a due date.
    const plan = computeGroupPlan(ws, s.decisions, s.commitments, s.evidenceMap, ledger);
    plan.fixed.forEach(i => schedule.push({ roomId, group, when: i.when, title: i.title, sortKey: i.sortKey, mine: false, messageId: i.messageId }));
    plan.due.filter(i => me(i.owner)).forEach(i => schedule.push({ roomId, group, when: i.when, title: `You: ${i.title}`, sortKey: i.sortKey, mine: true }));

    // Tasks: promises I made that are not done.
    s.commitments
      .filter(c => me(c.ownerName) && ['proposed', 'accepted', 'in_progress'].includes(c.status))
      .forEach(c => tasks.push({ roomId, group, description: c.description, status: c.status, due: c.dueAt, to: c.payee }));

    // Reminders: what needs me now.
    money.filter(m => m.roomId === roomId && m.direction === 'owe').forEach(m => reminders.push({ roomId, group, kind: 'pay', text: `Pay ${m.with} ${formatMoneyLocal(m.amount, m.currency)}`, with: m.with, amount: m.amount }));
    s.commitments
      .filter(c => c.status === 'needs_clarification' && me(c.payee) && c.verification?.state !== 'disputed')
      .forEach(c => reminders.push({ roomId, group, kind: 'confirm', text: `${c.ownerName} says they paid you${c.amount ? ` ${formatMoneyLocal(c.amount, c.currency || '₹')}` : ''}. Did you get it?`, messageId: s.evidenceMap[c.evidenceIds[0]]?.messageId }));
    s.commitments
      .filter(c => me(c.ownerName) && c.dueAt && ['accepted', 'in_progress'].includes(c.status))
      .forEach(c => reminders.push({ roomId, group, kind: 'promise', text: `You promised: ${c.description} (by ${c.dueAt})`, messageId: s.evidenceMap[c.evidenceIds[0]]?.messageId }));
    const iSpokeIn = new Set((s.topics ?? []).filter(t => t.people.some(p => me(p))).map(t => t.id));
    s.conflicts
      .filter(c => c.status === 'open' && (!c.topicId || iSpokeIn.has(c.topicId)))
      .slice(0, 5)
      .forEach(c => reminders.push({ roomId, group, kind: 'disagreement', text: `${c.topic}: ${c.description}`, messageId: s.evidenceMap[c.evidenceIds[0]]?.messageId }));
    unassigned.filter(u => u.roomId === roomId).forEach(u => reminders.push({ roomId, group, kind: 'recipient', text: `Your share of ${u.reason} (${formatMoneyLocal(u.amount, u.currency)}) has no one named to receive it. Choose who to pay.` }));
  }
  schedule.sort((a, b) => a.sortKey - b.sortKey);
  return { money, unassigned, schedule: schedule.slice(0, 40), tasks, reminders };
}

const formatMoneyLocal = (amount: number, currency: string) => `${currency || '₹'}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/* ---------------- private Sorted ---------------- */

/**
 * "What do I owe across my groups?" asked privately. The phone sends the seats it holds (room + token); only those
 * rooms are read, each for the person in that seat. Groups are never netted against each other. Nothing about the
 * question or answer is stored.
 */
export async function privateAnswer(seats: { roomId: string; token: string }[], question: string): Promise<{ text: string; ok: boolean; groups: number }> {
  const mine = seats.map(s => memberFor(s.roomId, s.token)).filter((x): x is NonNullable<ReturnType<typeof memberFor>> => !!x);
  if (!mine.length) return { text: 'You are not in any group on this phone yet.', ok: false, groups: 0 };
  const sums = { owe: new Map<string, number>(), owed: new Map<string, number>() };
  const lines: string[] = [];
  const groups = mine.flatMap(({ entry, member }) => {
    const ws = workspaceOf(entry.room);
    const s = dedupeBills(entry.room.state);
    const ledger = computeGroupLedger(ws, s.decisions, s.commitments, { conflicts: s.conflicts, evidenceMap: s.evidenceMap, messages: entry.messages, defaultCurrency: '₹', topics: entry.room.state.topics });
    const mineHere = computeMySettlement([ledger], member.name);
    mineHere.oweTotals.forEach(t => sums.owe.set(normalizeCurrency(t.currency) ?? t.currency, (sums.owe.get(normalizeCurrency(t.currency) ?? t.currency) ?? 0) + t.amount));
    mineHere.owedTotals.forEach(t => sums.owed.set(normalizeCurrency(t.currency) ?? t.currency, (sums.owed.get(normalizeCurrency(t.currency) ?? t.currency) ?? 0) + t.amount));
    lines.push(...mineHere.lines, `In "${ws.title}" the person asking is ${member.name}.`);
    return summarizeGroupsForModel({
      workspaces: [ws], scopedIds: [ws.id], decisionsByWs: { [ws.id]: s.decisions }, commitmentsByWs: { [ws.id]: s.commitments },
      conflictsByWs: { [ws.id]: s.conflicts }, evidenceByWs: { [ws.id]: s.evidenceMap }, user: { id: member.id, name: member.name, avatarColor: '' },
    });
  });
  const rows = (m: Map<string, number>) => [...m.entries()].map(([currency, amount]) => ({ currency, amount }));
  if (!key()) return { text: `You owe ${totalsText(rows(sums.owe))} and are owed ${totalsText(rows(sums.owed))}.`, ok: false, groups: mine.length };
  const res = await MetaModelService.askPrivateAssistantWithMeta(key(), question, {
    userName: 'the person asking',
    groups,
    money: { totalsText: totalsText(rows(sums.owe)), owedText: totalsText(rows(sums.owed)), lines },
  });
  return res.success && res.data ? { text: res.data, ok: true, groups: mine.length } : { text: 'I could not reach Meta AI just now. Try again in a moment.', ok: false, groups: mine.length };
}

/* ---------------- buttons ---------------- */

export function act(roomId: string, token: string, action: string, args: Record<string, string>): { ok: boolean; message?: string } {
  const found = memberFor(roomId, token);
  if (!found) return { ok: false, message: 'Not in this room' };
  const { entry, member } = found;
  const now = new Date().toLocaleString();
  let state = entry.room.state;

  if (action === 'resolve') {
    state = { ...state, ...resolveConflict(state, args.conflictId, args.choice as ConflictChoice, { now, actorLabel: member.name }) };
    const label = { keep_current: 'kept the agreed plan', adopt_proposal: 'switched to the new plan', different_subject: 'marked them as different things', dismiss: 'marked it as sorted' }[args.choice] ?? 'settled it';
    botMessage(entry, `✅ ${member.name} ${label}.`, { reason: 'action' });
  } else if (action === 'confirm' || action === 'dispute') {
    const c = state.commitments.find(x => x.id === args.commitmentId);
    if (!c) return { ok: false, message: 'That payment is gone' };
    if (c.payee && sameName(c.payee, member.name) !== true) return { ok: false, message: `Only ${c.payee} can confirm this` };
    state = action === 'confirm' ? confirmPayment(state, c.id, member.name, { now, actorLabel: member.name }) : disputePayment(state, c.id, member.name, { now, actorLabel: member.name });
    botMessage(entry, action === 'confirm' ? `✅ ${member.name} confirmed ${c.ownerName}'s payment. Balances updated.` : `❗ ${member.name} says they did not receive it. It stays owed.`, { reason: 'action' });
  } else if (action === 'paid') {
    state = markSharePaid(state, args.decisionId, member.name, { now, groupSize: entry.room.members.length });
    const d = state.decisions.find(x => x.id === args.decisionId);
    botMessage(entry, `💸 ${member.name} says they paid their share of ${d?.topic ?? 'a cost'}${d?.split?.collector ? `. ${d.split.collector}, please confirm` : ''}.`, { reason: 'action', actions: (() => {
      const claim = state.commitments.find(c => c.shareOfDecisionId === args.decisionId && c.ownerName === member.name && c.status === 'needs_clarification');
      const payee = d?.split?.collector ? entry.room.members.find(m => sameName(m.name, d.split!.collector) === true) : undefined;
      return claim && payee ? [{ label: `Confirm (${payee.name})`, action: 'confirm', args: { commitmentId: claim.id }, onlyFor: payee.id }, { label: 'I didn’t get it', action: 'dispute', args: { commitmentId: claim.id }, onlyFor: payee.id }] : [];
    })() });
  } else if (action === 'suggest') {
    const c = state.conflicts.find(x => x.id === args.conflictId);
    if (!c) return { ok: false, message: 'That disagreement is already settled' };
    void answerMention(entry, `Suggest ONE fair way for the group to settle this, in two short lines, naming who does what: ${c.topic}: ${c.description}`);
    return { ok: true };
  } else {
    return { ok: false, message: 'Unknown action' };
  }
  setState(entry, state);
  saveRoom(entry.room);
  pushPanel(entry);
  return { ok: true };
}

/** "Read now": read the new messages straight away instead of waiting. */
export function readNow(roomId: string, token: string): { ok: boolean; message?: string } {
  const found = memberFor(roomId, token);
  if (!found) return { ok: false, message: 'Join the room first' };
  if (found.entry.room.analysing) return { ok: true, message: 'Already reading' };
  if (peopleMessages(found.entry).length <= (found.entry.room.state.readThrough ?? 0)) return { ok: true, message: 'Everything is already read' };
  schedule(found.entry, true);
  return { ok: true };
}

/** Delete a group for everyone: its messages, results and seats. */
/**
 * Remind one person on WhatsApp about this group: what they owe, what they promised, payments waiting for them to
 * confirm. The text is written in code from the group's results. With an approved template (WHATSAPP_REMINDER_TEMPLATE)
 * it always arrives; as plain text it only arrives if they wrote to the Sorted number in the last 24 hours.
 */
export async function remind(roomId: string, token: string, name: string, link: string, opts: { preview?: boolean } = {}): Promise<{ ok: boolean; message: string; preview?: string; ready?: boolean }> {
  const found = memberFor(roomId, token);
  if (!found) return { ok: false, message: 'You are not in this group' };
  const { entry, member: me } = found;
  const target = entry.room.members.find(m => m.name.toLowerCase() === name.trim().toLowerCase());
  if (!target || target.id === me.id) return { ok: false, message: 'Pick someone else in the group' };
  if (entry.room.example) return { ok: false, message: `${target.name} is a made-up person in an example group, so there is no one to message.` };
  if (!target.phone) return { ok: false, message: `${target.name} has no WhatsApp number yet. Add it under People in this group.` };
  const s = dedupeBills(entry.room.state);
  const panel = buildPanel(workspaceOf(entry.room), entry.room.state, entry.messages, { defaultCurrency: '₹' });
  // Only promises from the last two weeks of the chat, newest first, and not "in 2 minutes" errands: an old cricket
  // plan is not something to remind anyone about.
  const at = new Map(entry.messages.map(m => [m.id, m.createdAt]));
  const latest = (c: (typeof s.commitments)[number]) => Math.max(...c.evidenceIds.map(id => at.get(s.evidenceMap[id]?.messageId ?? '') ?? 0));
  const now = entry.messages[entry.messages.length - 1]?.createdAt ?? Date.now();
  const recent = s.commitments
    .filter(c => !!c.amount || ((latest(c) <= 0 || latest(c) >= now - 14 * 86400000) && !/\b\d+\s?(min|mins|minute|minutes)\b/i.test(c.description)))
    .sort((a, b) => latest(b) - latest(a));
  const r = buildReminder({ panel, commitments: recent, person: target.name, group: entry.room.title, from: me.name, link });
  if (!r) return { ok: false, message: `${target.name} owes nothing and has nothing open in this group.` };
  if (!channelReady('cloud')) return { ok: false, message: 'WhatsApp is not connected on this server yet (WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID).', preview: r.text };
  // First the person sees exactly what will be sent; it goes out only when they press Send.
  if (opts.preview) return { ok: true, ready: true, message: `This goes to ${target.name} (+${target.phone}) on WhatsApp:`, preview: r.text };
  const template = waEnv('WHATSAPP_REMINDER_TEMPLATE');
  try {
    if (template) await sendCloudTemplate(target.phone, template, [target.name, entry.room.title, r.short, link]);
    else await sendText('cloud', target.phone, r.text);
  } catch (err: any) {
    addTrace({ channel: 'live', direction: 'note', phone: entry.room.id, summary: `WhatsApp reminder to ${target.name} failed: ${String(err.message).slice(0, 160)}` });
    return { ok: false, message: whatsappProblem(String(err.message), target.name), preview: r.text };
  }
  addTrace({ channel: 'live', direction: 'out', phone: entry.room.id, summary: `WhatsApp reminder to ${target.name} (${r.count} item${r.count === 1 ? '' : 's'})${template ? ` via template ${template}` : ''}: ${r.short}` });
  botMessage(entry, `🔔 ${me.name} sent ${target.name} a WhatsApp reminder: ${r.short}.`);
  return { ok: true, message: `Sent to ${target.name} on WhatsApp.${template ? '' : ' (As plain text it arrives only if they wrote to the Sorted number in the last 24 hours.)'}`, preview: r.text };
}

/** WhatsApp's error codes in plain words, with what to do about them. */
export function whatsappProblem(raw: string, name: string): string {
  const code = raw.match(/\b(1310\d\d|1320\d\d|190|10|100|368|80007|130429)\b/)?.[1];
  switch (code) {
    case '131030':
      return `${name}'s number isn't on the test number's allowed list. Check the number is right, or add it in Meta's WhatsApp API Setup → "To".`;
    case '131047':
    case '131026':
      return `WhatsApp could not deliver it: ${name} needs to send any message to the Sorted number first (or the reminder template must be approved).`;
    case '190':
      return 'The WhatsApp access token has expired. Put a new one in the server settings.';
    case '130429':
    case '80007':
      return 'WhatsApp is limiting how fast messages go out. Try again in a minute.';
    default:
      return `WhatsApp did not accept it (${code ?? 'no code'}). Try again in a moment.`;
  }
}

export function deleteRoom(roomId: string) {
  const entry = rooms.get(roomId);
  if (entry?.timer) clearTimeout(entry.timer);
  deleted.add(roomId);
  entry?.listeners.clear();
  rooms.delete(roomId);
  const d = open();
  d.prepare('DELETE FROM live_messages WHERE room = ?').run(roomId);
  d.prepare('DELETE FROM live_rooms WHERE id = ?').run(roomId);
}

export function roomEntry(roomId: string) {
  return load(roomId);
}
