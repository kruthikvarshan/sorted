import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Message } from '../../src/types/groupOs';
import { MetaModelService } from '../../src/services/metaModelService';
import { DEFAULT_SPOKEN_LANGUAGES } from '../../src/state/preferences';
import { shrinkImage, toWav16k } from '../whatsapp/media';
import { readImage } from '../../src/services/imageReader';
import { addTrace } from '../whatsapp/store';
import { env as waEnv } from '../whatsapp/channels';
import { sameName } from '../../src/engine/receiptVerifier';
import { asWork, guardMetaCalls, Resting, spendReport } from './budget';
import { Account, bySession, getAccount, login, logout, normalizePhone, saveAccount } from './accounts';

const trace = (room: string, summary: string) => {
  try {
    addTrace({ channel: 'live', direction: 'model', phone: room, summary });
  } catch {
    /* never breaks a request */
  }
};
import { act, addPerson, readFromScratch, remind, tripQuestions, readSoon, seatsForPhone, createRoom, deleteRoom, joinRoom, messageWindow, myGroups, openSeats, planTripFor, privateDetails, readNow, postConversation, privateAnswer, wrapped, memberFor, postImage, postMessage, roomEntry, snapshot, subscribe, updateMember, analyse, pushPanel } from './hub';

/**
 * HTTP for live rooms, on plain Node request/response so it runs the same inside the Vite dev server and the
 * production Express server:
 *   POST /live/api/rooms                    create a room (optionally from the 2,000-message sample group)
 *   POST /live/api/rooms/:id/join           join with a name, get a private token
 *   GET  /live/api/rooms/:id?token=         everything to draw the room
 *   GET  /live/api/rooms/:id/events?token=  live updates (server-sent events)
 *   POST /live/api/rooms/:id/messages       send a message
 *   POST /live/api/rooms/:id/voice          send a voice note (audio body), transcribed by Muse Voice
 *   POST /live/api/rooms/:id/action         press a Sorted button
 *   POST /live/api/rooms/:id/me             set your phone number / UPI id (for Pay on WhatsApp)
 *   GET  /live/api/media/:file              play back a voice note
 */

const UPLOADS = () => path.resolve(process.cwd(), 'data/uploads');
const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage, limit = 15 * 1024 * 1024): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const parseJson = (b: Buffer) => {
  try {
    return JSON.parse(b.toString('utf8') || '{}');
  } catch {
    return {};
  }
};

/** The sample group: 1,983 messages over four months, and (when available) its results read in advance. */
/** The demo groups, in the order Neha's phone lists them. Neha is in all of them. */
export const DEMO_GROUPS = ['flat402', 'goa2026', 'raofamily', 'productsquad', 'iiitbatch', 'greenmeadows', 'gymsquad', 'hydfoodies'];
/** The groups that start in Neha's private Sorted (she adds or removes the rest herself). */
export const DEMO_SCOPE = ['flat402', 'goa2026', 'raofamily', 'productsquad'];

export function sample(id = 'flat402') {
  const file = path.resolve(process.cwd(), `src/data/longChat/${id}.json`);
  const data = JSON.parse(readFileSync(file, 'utf8')) as { title: string; people: string[]; messages: { at: string; speaker: string; text: string }[] };
  const messages: Message[] = data.messages.map((m, i) => ({
    id: `m${i + 1}`,
    conversationId: '',
    speakerId: `p_${m.speaker.toLowerCase().replace(/\W+/g, '_')}`,
    speakerName: m.speaker,
    timestamp: new Date(m.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    content: m.text,
    type: 'text',
    createdAt: new Date(m.at).getTime(),
  }));
  const stateFile = path.resolve(process.cwd(), `src/data/longChat/${id}.state.json`);
  const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : undefined;
  return { title: data.title, people: data.people, messages, state };
}

/** Simple limits so a public link cannot be used to run up Meta costs. Per IP for new rooms, per seat for the rest. */
const hits = new Map<string, number[]>();
export function allowed(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter(t => now - t < windowMs);
  if (recent.length >= max) return false;
  recent.push(now);
  hits.set(key, recent);
  return true;
}
/**
 * Who is calling, for rate limits. Cloudflare's own header first (the tunnel sets it and a client cannot), then the
 * address the nearest proxy added (the last X-Forwarded-For entry, not the first, which a client can write), then the
 * socket.
 */
const ipOf = (req: IncomingMessage) =>
  String(req.headers['cf-connecting-ip'] ?? '').trim() || String(req.headers['x-forwarded-for'] ?? '').split(',').pop()!.trim() || req.socket.remoteAddress || 'unknown';
const slowDown = (res: ServerResponse) => json(res, 429, { error: 'Too many at once. Wait a moment and try again.' });

/**
 * The demo groups are written with Neha as the phone's owner. For an account, Neha becomes the account's name
 * everywhere (messages, people, and the results read in advance), so the person is themselves in every group.
 */
/** Replace one person's name everywhere in an example chat (messages, people, results), keeping its case. */
function renameIn(text: string, from: string, to: string): string {
  const lit = (t: string) => JSON.stringify(t).slice(1, -1);
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fromSlug = from.toLowerCase().replace(/\W+/g, '_');
  const toSlug = to.toLowerCase().replace(/\W+/g, '_');
  return text
    .replace(new RegExp(`\\bp_${fromSlug}\\b`, 'g'), () => `p_${toSlug}`)
    .replace(new RegExp(`\\b${esc}\\b`, 'g'), () => lit(to))
    .replace(new RegExp(`\\b${esc.toUpperCase()}\\b`, 'g'), () => lit(to.toUpperCase()))
    .replace(new RegExp(`\\b${esc.toLowerCase()}(${esc.slice(-1).toLowerCase()}*)\\b`, 'g'), (_, extra) => lit(to.toLowerCase()) + extra);
}

/** Names for example characters who would clash with the person's own name. */
const STAND_INS = ['Nikhil', 'Tanvi', 'Farhan', 'Ishaan', 'Meghna', 'Rehan', 'Zara', 'Kabir', 'Anvi', 'Dhruv'];

/**
 * The demo groups are written with Neha as the phone's owner. For an account, Neha becomes the account's name
 * everywhere (messages, people, and the results read in advance), so the person is themselves in every group. An
 * example character whose name could be mistaken for theirs ("Karthik" when they are Karthik) is renamed first, so
 * their money never mixes with a made-up person's.
 */
export function asPerson<T extends { people: string[] }>(s: T, name: string): T & { me: string } {
  const who = name.trim() || 'Neha';
  if (who === 'Neha') return { ...s, me: who };
  let text = JSON.stringify(s);
  const taken = new Set(s.people.map(p => p.toLowerCase()));
  for (const other of s.people.filter(p => p !== 'Neha')) {
    if (sameName(other, who) !== true) continue;
    const stand = STAND_INS.find(n => !taken.has(n.toLowerCase()) && sameName(n, who) !== true)!;
    taken.add(stand.toLowerCase());
    text = renameIn(text, other, stand);
  }
  text = renameIn(text, 'Neha', who);
  return { ...JSON.parse(text), me: who };
}

/**
 * Example chats were written for fixed dates; they are moved by whole days so the newest message is within the last
 * day (times of day stay the same), and the group never looks dated in the future or months old.
 */
export function shiftToNow<T extends { messages: Message[]; state?: any }>(s: T, now = Date.now()): T {
  const last = s.messages[s.messages.length - 1]?.createdAt;
  if (!last) return s;
  const DAY = 86400000;
  let days = Math.floor((now - last) / DAY);
  if (last + days * DAY > now) days -= 1;
  if (!days) return s;
  const by = days * DAY;
  const topics = s.state?.topics?.map((t: any) => ({ ...t, firstAt: t.firstAt + by, lastAt: t.lastAt + by }));
  return { ...s, messages: s.messages.map(m => ({ ...m, createdAt: m.createdAt + by })), ...(s.state ? { state: { ...s.state, ...(topics ? { topics } : {}) } } : {}) };
}

/** The demo groups that come with a new account, once. The person takes Neha's seat in each, under their own name. */
function seedDemo(account: Account) {
  for (const id of DEMO_GROUPS) {
    if (!existsSync(path.resolve(process.cwd(), `src/data/longChat/${id}.json`))) continue;
    const s = shiftToNow(asPerson(sample(id), account.name));
    const room = createRoom(s.title, { messages: s.messages, state: s.state, people: s.people, example: true, owner: account.username });
    const member = joinRoom(room.id, s.me).member!;
    // The newest messages (or all of them, with no saved results) are read right away, not left waiting.
    readSoon(room.id);
    account.seats.push({ roomId: room.id, token: member.token, demo: id });
    if (DEMO_SCOPE.includes(id)) account.scope.push(room.id);
  }
  account.seeded = true;
  saveAccount(account);
}

/** Accounts made before demo groups used the account's name are moved over once: their Neha demo groups are replaced. */
function reseedAsSelf(account: Account): boolean {
  if (account.name === 'Neha') return false;
  const old = account.seats.filter(s => s.demo && memberFor(s.roomId, s.token)?.member.name === 'Neha');
  if (!old.length) return false;
  old.forEach(s => deleteRoom(s.roomId));
  account.seats = account.seats.filter(s => !old.includes(s));
  account.scope = account.scope.filter(id => !old.some(s => s.roomId === id));
  account.seeded = false;
  return true;
}

/** Groups where someone added this account's phone number for a person who had not joined yet: the seats are taken now. */
function takeWaitingSeats(account: Account): boolean {
  if (!account.phone) return false;
  // Your number goes on your own seat in every group you are in, so people there can pay and remind you.
  // Only in groups that are clearly theirs (examples, groups they made); a group joined by a link gets their number only
  // if they add it themselves.
  account.seats.forEach(s => {
    const m = memberFor(s.roomId, s.token)?.member;
    if (m && !m.phone && (s.demo || s.owner)) updateMember(s.roomId, s.token, { phone: account.phone });
  });
  const found = seatsForPhone(account.phone).filter(s => !account.seats.some(x => x.roomId === s.roomId));
  account.seats.push(...found);
  account.scope.push(...found.map(s => s.roomId));
  if (found.length) saveAccount(account);
  return found.length > 0;
}

let started = false;
function start() {
  if (started) return;
  started = true;
  guardMetaCalls();
  MetaModelService.baseUrl = (process.env.META_API_BASE || 'https://api.meta.ai/v1').replace(/\/$/, '');
}

/** Every request about a group runs as that group's interactive work, so Meta spend is counted and limited per group. */
export function handleLive(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const parts = new URL(req.url || '/', 'http://x').pathname.replace(/^\/live\/api\//, '').split('/');
  return asWork({ kind: 'interactive', roomId: parts[0] === 'rooms' && parts[1] ? parts[1] : undefined }, () => handleLiveRequest(req, res));
}

async function handleLiveRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url || '/', 'http://x');
  if (!url.pathname.startsWith('/live/api/')) return false;
  start();
  const parts = url.pathname.replace(/^\/live\/api\//, '').split('/').filter(Boolean);
  const token = url.searchParams.get('token');

  try {
    if (parts[0] === 'media' && parts[1] && req.method === 'GET') {
      const file = path.join(UPLOADS(), path.basename(parts[1]));
      if (!existsSync(file)) return json(res, 404, { error: 'not found' }), true;
      res.setHeader('content-type', file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.webm') ? 'audio/webm' : file.endsWith('.mp4') ? 'audio/mp4' : 'audio/ogg');
      res.end(readFileSync(file));
      return true;
    }

    // How much Meta credit has been used: today and in total, background vs interactive (locked with TRACE_TOKEN).
    if (parts[0] === 'spend' && req.method === 'GET') {
      const need = waEnv('TRACE_TOKEN');
      if (need && url.searchParams.get('key') !== need) return json(res, 401, { error: 'This page needs its key.' }), true;
      return json(res, 200, spendReport()), true;
    }

    if (parts[0] === 'details' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      const seats = Array.isArray(body.seats) ? body.seats.filter((s: any) => typeof s?.roomId === 'string' && typeof s?.token === 'string').slice(0, 50) : [];
      return json(res, 200, privateDetails(seats)), true;
    }

    if (parts[0] === 'mine' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      const seats = Array.isArray(body.seats) ? body.seats.filter((s: any) => typeof s?.roomId === 'string' && typeof s?.token === 'string').slice(0, 50) : [];
      return json(res, 200, { groups: myGroups(seats) }), true;
    }

    if (parts[0] === 'private' && req.method === 'POST') {
      if (!allowed(`private:${ipOf(req)}`, 20, 60_000)) return slowDown(res), true;
      const body = parseJson(await readBody(req));
      const seats = Array.isArray(body.seats) ? body.seats.filter((s: any) => typeof s?.roomId === 'string' && typeof s?.token === 'string').slice(0, 20) : [];
      const text = String(body.text ?? '').trim().slice(0, 1000);
      if (!text) return json(res, 400, { error: 'Ask something' }), true;
      return json(res, 200, await privateAnswer(seats, text)), true;
    }

    // Accounts: log in (or sign up) with a username and PIN; the demo groups are added once, on the first login.
    if (parts[0] === 'account') {
      const body = req.method === 'POST' ? parseJson(await readBody(req)) : {};
      // The session comes in a header (not the URL, which ends up in logs); the body and URL forms still work.
      const session = String(req.headers['x-groupos-session'] ?? body.session ?? url.searchParams.get('session') ?? '');
      const summary = (a: Account) => ({ username: a.username, name: a.name, phone: a.phone, seats: a.seats, scope: a.scope });
      if (parts[1] === 'login' && req.method === 'POST') {
        if (!allowed(`login:${ipOf(req)}`, 20, 600_000)) return slowDown(res), true;
        // Each new account starts reading 8 example groups with Meta AI, so sign-ups are limited per address.
        if (body.signup === true && !allowed(`signup:${ipOf(req)}`, 5, 3600_000)) return json(res, 429, { error: 'Too many new accounts from here in the last hour. Try again later.' }), true;
        const r = login(String(body.phone ?? ''), String(body.pin ?? ''), { name: body.name, signup: body.signup === true });
        if (!r.account) return json(res, 400, { error: r.error }), true;
        reseedAsSelf(r.account);
        if (!r.account.seeded) seedDemo(r.account);
        takeWaitingSeats(r.account);
        return json(res, 200, { session: r.session, isNew: r.isNew, account: summary(r.account) }), true;
      }
      const account = bySession(session);
      if (!account) return json(res, 401, { error: 'Please log in again.' }), true;
      if (parts.length === 1 && req.method === 'GET') {
        if (reseedAsSelf(account)) seedDemo(account);
        takeWaitingSeats(account);
        return json(res, 200, { account: summary(account) }), true;
      }
      if (parts[1] === 'logout') return logout(session), json(res, 200, { ok: true }), true;
      if (parts[1] === 'scope' && Array.isArray(body.scope)) {
        account.scope = body.scope.filter((id: unknown) => typeof id === 'string' && account.seats.some(s => s.roomId === id));
        saveAccount(account);
        return json(res, 200, { ok: true }), true;
      }
      if (parts[1] === 'seat' && typeof body.roomId === 'string' && typeof body.token === 'string') {
        if (!memberFor(body.roomId, body.token)) return json(res, 400, { error: 'That seat is not valid' }), true;
        if (!account.seats.some(s => s.roomId === body.roomId)) {
          // Owner only if this account created the group (recorded on the group itself), never because the phone says so.
          const isOwner = roomEntry(body.roomId)?.room.owner === account.username;
          account.seats.push({ roomId: body.roomId, token: body.token, ...(isOwner ? { owner: true } : {}) });
          account.scope.push(body.roomId);
        }
        saveAccount(account);
        return json(res, 200, { ok: true, account: summary(account) }), true;
      }
      if (parts[1] === 'delete' && typeof body.roomId === 'string') {
        const seat = account.seats.find(s => s.roomId === body.roomId);
        if (!seat) return json(res, 404, { error: 'You are not in that group' }), true;
        // A group you created (or that came with your account) is deleted for everyone; otherwise you just leave it.
        const ownsIt = roomEntry(seat.roomId)?.room.owner === account.username || !!seat.demo;
        if (ownsIt) deleteRoom(seat.roomId);
        account.seats = account.seats.filter(s => s.roomId !== body.roomId);
        account.scope = account.scope.filter(id => id !== body.roomId);
        saveAccount(account);
        return json(res, 200, { ok: true, deleted: ownsIt, account: summary(account) }), true;
      }
      return json(res, 404, { error: 'not found' }), true;
    }

    if (parts[0] !== 'rooms') return json(res, 404, { error: 'not found' }), true;

    if (parts.length === 1 && req.method === 'POST') {
      if (!allowed(`room:${ipOf(req)}`, 20, 3600_000)) return slowDown(res), true;
      const body = parseJson(await readBody(req));
      // Within one account, group names are unique.
      const owner = bySession(body.session);
      // Groups are made from an account, so each has an owner and nobody can create groups (and Meta reads) anonymously.
      if (!owner) return json(res, 401, { error: 'Please log in again.' }), true;
      const wanted = String(body.title ?? '').trim().toLowerCase();
      if (owner && wanted && owner.seats.some(s => roomEntry(s.roomId)?.room.title.trim().toLowerCase() === wanted))
        return json(res, 409, { error: `You already have a group called "${String(body.title).trim()}". Pick another name.` }), true;
      let room;
      if (body.sample) {
        const s = sample();
        // Read live by default; "already read" opens results from an earlier run (clearly labelled in the app).
        const ready = body.sample === 'ready' ? s.state : undefined;
        room = createRoom(body.title || s.title, { messages: s.messages, state: ready, people: s.people, owner: owner.username });
        const entry = roomEntry(room.id)!;
        if (!ready) void analyse(entry);
      } else room = createRoom(body.title || 'Our group', { messages: [], owner: owner.username });
      const member = body.name ? joinRoom(room.id, body.name).member : undefined;
      return json(res, 200, { roomId: room.id, token: member?.token, people: openSeats(room) }), true;
    }

    const roomId = parts[1];
    const entry = roomEntry(roomId);
    if (!entry) return json(res, 404, { error: 'This room does not exist' }), true;

    if (parts.length === 2 && req.method === 'GET') {
      if (!token) return json(res, 200, { room: { id: entry.room.id, title: entry.room.title }, people: openSeats(entry.room), members: entry.room.members.length }), true;
      if (url.searchParams.has('lite')) {
        const who = memberFor(roomId, token);
        return who ? json(res, 200, { room: { id: entry.room.id, title: entry.room.title }, me: who.member.name }) : json(res, 401, { error: 'Join the room first' }), true;
      }
      const snap = snapshot(roomId, token);
      return snap ? json(res, 200, snap) : json(res, 401, { error: 'Join the room first' }), true;
    }

    if (parts[2] === 'join' && req.method === 'POST') {
      if (!allowed(`join:${ipOf(req)}`, 30, 3600_000)) return slowDown(res), true;
      const { name } = parseJson(await readBody(req));
      const r = joinRoom(roomId, String(name ?? ''));
      return r.member ? json(res, 200, { token: r.member.token, memberId: r.member.id }) : json(res, 400, { error: r.error }), true;
    }

    if (parts[2] === 'history' && req.method === 'GET') {
      const w = messageWindow(roomId, token ?? '', { before: url.searchParams.has('before') && Number.isFinite(Number(url.searchParams.get('before'))) ? Number(url.searchParams.get('before')) : undefined, around: url.searchParams.get('around') ?? undefined });
      return w ? json(res, 200, w) : json(res, 401, { error: 'Join the room first' }), true;
    }

    if (parts[2] === 'events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no', 'content-encoding': 'identity' });
      // Some proxies hold back a stream until a few KB have passed; this padding gets it flowing at once.
      res.write(`: connected${' '.repeat(4096)}\n\n`);
      const off = subscribe(roomId, token ?? '', e => res.write(`data: ${JSON.stringify(e)}\n\n`));
      if (!off) {
        res.end();
        return true;
      }
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => {
        clearInterval(ping);
        off();
      });
      return true;
    }

    if (!memberFor(roomId, token)) return json(res, 401, { error: 'Join the room first' }), true;
    if (req.method === 'POST' && !allowed(`seat:${token}`, 40, 60_000)) return slowDown(res), true;
    if (req.method === 'POST' && /^(voice|listen|image)$/.test(parts[2] ?? '') && !allowed(`media:${token}`, 8, 60_000)) return slowDown(res), true;

    if (parts[2] === 'messages' && req.method === 'POST') {
      const { text } = parseJson(await readBody(req));
      const m = postMessage(roomId, token!, String(text ?? ''));
      return m ? json(res, 200, { ok: true, id: m.id }) : json(res, 400, { error: 'Empty message' }), true;
    }

    if (parts[2] === 'voice' && req.method === 'POST') {
      const audio = await readBody(req);
      if (audio.length < 2000) return json(res, 400, { error: 'That recording is too short.' }), true;
      const wav = await toWav16k(audio).catch(() => null);
      if (!wav) return json(res, 400, { error: 'That recording could not be read.' }), true;
      const result = await MetaModelService.transcribeAudioWithMeta(process.env.MODEL_API_KEY ?? '', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), { languageBias: DEFAULT_SPOKEN_LANGUAGES });
      trace(roomId, `Meta ${result.modelUsed}: transcribed a voice note${result.success ? '' : ' (failed)'}`);
      if (!result.success || !result.data) return json(res, 502, { error: 'Meta could not transcribe that just now.' }), true;
      if (!result.data.transcript) return json(res, 400, { error: 'No speech was heard in that recording.' }), true;
      mkdirSync(UPLOADS(), { recursive: true });
      const type = String(req.headers['content-type'] ?? '');
      const name = `${randomBytes(8).toString('hex')}.${type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm'}`;
      writeFileSync(path.join(UPLOADS(), name), audio);
      const m = postMessage(roomId, token!, result.data.transcript, { type: 'voice_transcript', audioUrl: `/live/api/media/${name}` });
      return json(res, 200, { ok: true, id: m?.id, transcript: result.data.transcript }), true;
    }

    // Plan out loud, step 1: separate the voices (nothing is posted yet).
    if (parts[2] === 'listen' && req.method === 'POST') {
      const audio = await readBody(req, 40 * 1024 * 1024);
      const wav = await toWav16k(audio).catch(() => null);
      if (!wav) return json(res, 400, { error: 'That recording could not be read.' }), true;
      const result = await MetaModelService.transcribeAudioWithMeta(process.env.MODEL_API_KEY ?? '', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), { diarize: true, languageBias: DEFAULT_SPOKEN_LANGUAGES });
      trace(roomId, `Meta ${result.modelUsed}: separated speakers in a recording of the group${result.success ? ` (${result.data?.turns.length ?? 0} turns)` : ' (failed)'}`);
      if (!result.success || !result.data) return json(res, 502, { error: 'Meta could not transcribe that just now.' }), true;
      const turns = result.data.turns.length ? result.data.turns.map(t => ({ speaker: String(t.speaker ?? '1'), text: t.text })) : [{ speaker: '1', text: result.data.transcript }];
      mkdirSync(UPLOADS(), { recursive: true });
      const type = String(req.headers['content-type'] ?? '');
      const name = `${randomBytes(8).toString('hex')}.${type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm'}`;
      writeFileSync(path.join(UPLOADS(), name), audio);
      return json(res, 200, { turns: turns.filter(t => t.text.trim()), audioUrl: `/live/api/media/${name}` }), true;
    }

    // Plan out loud, step 2: post the turns once the recorder has said who each voice is.
    if (parts[2] === 'conversation' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      const r = postConversation(roomId, token!, Array.isArray(body.turns) ? body.turns : [], typeof body.audioUrl === 'string' ? body.audioUrl : undefined);
      return json(res, r.ok ? 200 : 400, r), true;
    }

    if (parts[2] === 'image' && req.method === 'POST') {
      const raw = await readBody(req, 20 * 1024 * 1024);
      const jpg = await shrinkImage(raw).catch(() => null);
      if (!jpg) return json(res, 400, { error: 'That image could not be opened.' }), true;
      mkdirSync(UPLOADS(), { recursive: true });
      const name = `${randomBytes(8).toString('hex')}.jpg`;
      writeFileSync(path.join(UPLOADS(), name), jpg);
      let resting = '';
      const reading = await readImage(process.env.MODEL_API_KEY ?? '', `data:image/jpeg;base64,${jpg.toString('base64')}`).catch(err => ((resting = err instanceof Resting ? err.message : ''), null));
      if (resting) return json(res, 200, { ok: false, message: resting }), true;
      trace(roomId, `Meta muse-spark (vision): read an image as ${reading?.kind ?? 'unreadable'}${reading?.kind === 'chat' ? ` (${reading.lines.length} messages)` : ''}`);
      const r = postImage(roomId, token!, reading, `/live/api/media/${name}`);
      return json(res, r.ok ? 200 : 400, r.ok ? { ok: true, kind: reading?.kind } : { error: r.message }), true;
    }

    // The trip planner first shows what the chat already says, and asks for the rest.
    if (parts[2] === 'plan' && req.method === 'GET') {
      const q = tripQuestions(roomId, token!, String(url.searchParams.get('topicId') ?? ''));
      return q ? (json(res, 200, q), true) : (json(res, 404, { error: 'That topic is gone' }), true);
    }

    if (parts[2] === 'plan' && req.method === 'POST') {
      const { topicId, answers } = parseJson(await readBody(req));
      // Asking for missing details costs nothing; only an actual search counts against the limit.
      const r0 = tripQuestions(roomId, token!, String(topicId ?? ''));
      const filled = { ...r0?.facts, ...(answers && typeof answers === 'object' ? answers : {}) };
      if (r0 && r0.fields.every(f => String((filled as any)[f.key] ?? '').trim()) && !allowed(`plan:${roomId}`, 6, 3600_000)) return slowDown(res), true;
      const r = await planTripFor(roomId, token!, String(topicId ?? ''), answers && typeof answers === 'object' ? answers : {});
      return json(res, r.ok ? 200 : 400, r), true;
    }

    if (parts[2] === 'scratch' && req.method === 'POST') {
      const r = readFromScratch(roomId, token!);
      return json(res, r.ok ? 200 : 400, r), true;
    }

    if (parts[2] === 'read' && req.method === 'POST') {
      return json(res, 200, readNow(roomId, token!)), true;
    }

    if (parts[2] === 'wrapped' && req.method === 'GET') {
      const w = await wrapped(roomId, token!);
      return w ? json(res, 200, w) : json(res, 404, { error: 'not found' }), true;
    }

    if (parts[2] === 'action' && req.method === 'POST') {
      const { action, args } = parseJson(await readBody(req));
      const r = act(roomId, token!, String(action), args ?? {});
      return json(res, r.ok ? 200 : 400, r), true;
    }

    if (parts[2] === 'remind' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      if (body.send === true && !allowed(`remind:${token}`, 10, 3600_000)) return slowDown(res), true;
      const base = (waEnv('PUBLIC_URL') || `http://${req.headers.host}`).replace(/\/$/, '');
      const r = await remind(roomId, token!, String(body.name ?? ''), `${base}/live/${roomId}`, { preview: body.send !== true });
      return json(res, 200, r), true;
    }

    // Add a person by name and phone. If they already have an account, the group shows up for them at once.
    if (parts[2] === 'person' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      const r = addPerson(roomId, token!, String(body.name ?? ''), String(body.phone ?? ''));
      if (!r.member) return json(res, 400, { error: r.error }), true;
      const p = normalizePhone(String(body.phone ?? ''));
      const theirs = p ? getAccount(p) : undefined;
      if (theirs) takeWaitingSeats(theirs);
      return json(res, 200, { ok: true, name: r.member.name, joined: !!theirs }), true;
    }

    if (parts[2] === 'me' && req.method === 'POST') {
      const body = parseJson(await readBody(req));
      updateMember(roomId, token!, { phone: body.phone, upi: body.upi });
      pushPanel(entry);
      return json(res, 200, { ok: true }), true;
    }

    return json(res, 404, { error: 'not found' }), true;
  } catch (err: any) {
    return json(res, 500, { error: err?.message ?? 'Something went wrong' }), true;
  }
}
