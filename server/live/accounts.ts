import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Accounts for Sorted: a phone number (one account per number) and a 4-digit PIN the person picks (stored only
 * as a scrypt hash), plus the name others see. An account keeps its seats
 * in groups, which groups My Sorted follows, and its sessions, so the same groups appear on any device. The demo
 * groups are added to a new account once, never again.
 */

export interface Seat {
  roomId: string;
  token: string;
  /** Demo group id when this seat came with the account. */
  demo?: string;
  /** This account created the group, so it may delete it for everyone. */
  owner?: boolean;
}

export interface Account {
  /** The key: the phone number as digits with country code (older accounts: a username). */
  username: string;
  name: string;
  phone?: string;
  salt: string;
  pinHash: string;
  seats: Seat[];
  /** Room ids My Sorted follows. */
  scope: string[];
  sessions: string[];
  seeded: boolean;
  createdAt: number;
}

let db: DatabaseSync | null = null;
function open() {
  if (db) return db;
  const file = process.env.GROUP_OS_DB || path.resolve(process.cwd(), 'data/groupos.db');
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('CREATE TABLE IF NOT EXISTS live_accounts (username TEXT PRIMARY KEY, data TEXT NOT NULL)');
  // Sessions: found directly (not by reading every account), and they expire after 30 days without use.
  db.exec('CREATE TABLE IF NOT EXISTS live_sessions (session TEXT PRIMARY KEY, username TEXT NOT NULL, seen INTEGER NOT NULL)');
  return db;
}

export function resetAccounts(file = ':memory:') {
  failures.clear();
  db?.close();
  db = null;
  process.env.GROUP_OS_DB = file;
}

const clean = (u: string) => u.trim().toLowerCase();
const MAX_TRIES = 5;
const LOCK_MS = 15 * 60_000;
const failures = new Map<string, { n: number; at: number; until: number }>();
export const validPin = (p: string) => /^\d{4}$/.test(p);
const hash = (pin: string, salt: string) => scryptSync(pin, salt, 32).toString('hex');

/** Digits with country code, as WhatsApp uses them. A 10-digit number is taken as Indian (+91). */
export function normalizePhone(raw: string): string | undefined {
  let d = String(raw ?? '').replace(/[\s\-().]/g, '');
  if (!/^\+?\d+$/.test(d)) return undefined;
  d = d.replace(/^\+/, '').replace(/^00/, '');
  if (d.length === 10) d = `91${d}`;
  // An Indian mobile number is 91 + exactly 10 digits starting 6–9: one digit short or long is a typo, not a number.
  if (d.startsWith('91') && d.length <= 13) return /^91[6-9]\d{9}$/.test(d) ? d : undefined;
  return d.length >= 11 && d.length <= 15 ? d : undefined;
}

export function getAccount(key: string): Account | undefined {
  const row = open().prepare('SELECT data FROM live_accounts WHERE username = ?').get(clean(key)) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Account) : undefined;
}

export function saveAccount(a: Account) {
  open().prepare('INSERT INTO live_accounts (username, data) VALUES (?, ?) ON CONFLICT(username) DO UPDATE SET data = excluded.data').run(a.username, JSON.stringify(a));
}

/**
 * Sign up (first time: name, phone, PIN) or log in (phone, PIN). Returns a session token. Signing up with a number that
 * already has an account, or logging in with one that has none, is refused with a clear message.
 */
export function login(phone: string, pin: string, opts: { name?: string; signup?: boolean } = {}): { account?: Account; session?: string; isNew?: boolean; error?: string } {
  const p = normalizePhone(phone);
  if (!p) return { error: 'Enter your mobile number, e.g. 98765 43210 or +91 98765 43210.' };
  if (!validPin(pin)) return { error: 'The PIN is 4 digits.' };
  let account = getAccount(p);
  let isNew = false;
  if (opts.signup) {
    if (account) return { error: 'This number already has an account. Log in instead.' };
    const name = (opts.name ?? '').trim().slice(0, 30);
    if (!name) return { error: 'Type your name.' };
    if (/^(?:sorted|group\s*os)$/i.test(name)) return { error: 'That name is taken by Sorted itself. Pick another.' };
    const salt = randomBytes(16).toString('hex');
    account = { username: p, phone: p, name, salt, pinHash: hash(pin, salt), seats: [], scope: [], sessions: [], seeded: false, createdAt: Date.now() };
    isNew = true;
  } else {
    if (!account) return { error: 'No account with this number yet. Sign up first.' };
    // A 4-digit PIN has 10,000 options: after 5 wrong tries the number is locked for 15 minutes, from anywhere.
    const lock = failures.get(p);
    if (lock && lock.until > Date.now()) return { error: `Too many wrong PINs. Try again in ${Math.ceil((lock.until - Date.now()) / 60000)} minutes.` };
    const ok = timingSafeEqual(Buffer.from(hash(pin, account.salt)), Buffer.from(account.pinHash));
    if (!ok) {
      const n = (lock && lock.at > Date.now() - LOCK_MS ? lock.n : 0) + 1;
      failures.set(p, { n, at: Date.now(), until: n >= MAX_TRIES ? Date.now() + LOCK_MS : 0 });
      return { error: n >= MAX_TRIES ? 'Too many wrong PINs. Try again in 15 minutes.' : `That PIN does not match this number (${MAX_TRIES - n} tries left).` };
    }
    failures.delete(p);
  }
  const session = randomBytes(18).toString('base64url');
  account.sessions = [...account.sessions.slice(-9), session];
  saveAccount(account);
  open().prepare('INSERT OR REPLACE INTO live_sessions (session, username, seen) VALUES (?, ?, ?)').run(session, account.username, Date.now());
  return { account, session, isNew };
}

/** A session lasts 30 days from when it was last used, and each use renews it. */
export const SESSION_DAYS = 30;

export function bySession(session: string | null | undefined): Account | undefined {
  if (!session) return undefined;
  const now = Date.now();
  let row = open().prepare('SELECT username, seen FROM live_sessions WHERE session = ?').get(session) as { username: string; seen: number } | undefined;
  if (!row) {
    // Sessions from before the index: found once the old way, then indexed.
    const all = open().prepare('SELECT data FROM live_accounts').all() as { data: string }[];
    const owner = all.map(r => JSON.parse(r.data) as Account).find(a => a.sessions.includes(session));
    if (!owner) return undefined;
    open().prepare('INSERT OR REPLACE INTO live_sessions (session, username, seen) VALUES (?, ?, ?)').run(session, owner.username, now);
    row = { username: owner.username, seen: now };
  }
  if (now - row.seen > SESSION_DAYS * 86400000) {
    open().prepare('DELETE FROM live_sessions WHERE session = ?').run(session);
    return undefined;
  }
  // Renew at most once an hour, so reading the account does not write every time.
  if (now - row.seen > 3600_000) open().prepare('UPDATE live_sessions SET seen = ? WHERE session = ?').run(now, session);
  const account = getAccount(row.username);
  return account?.sessions.includes(session) ? account : undefined;
}

export function logout(session: string) {
  const a = bySession(session);
  if (!a) return;
  a.sessions = a.sessions.filter(s => s !== session);
  saveAccount(a);
  open().prepare('DELETE FROM live_sessions WHERE session = ?').run(session);
}
