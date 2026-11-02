import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { GroupIntelligenceState, Message, Workspace } from '../../src/types/groupOs';

/**
 * Storage for the WhatsApp side. One SQLite file under data/ (gitignored). Each person's groups belong to them:
 * nothing is shared between people, and "delete my data" removes all of it.
 */

export interface Person {
  phone: string;
  /** Group ids the private assistant may read. null = every group this person brought in. */
  scope: string[] | null;
  /** A question we asked and are waiting on, such as "which one is you in this chat?". */
  pending?: { kind: 'whoami'; groupId: string } | null;
  createdAt: string;
}

export interface StoredGroup {
  id: string;
  owner: string;
  workspace: Workspace;
  messages: Message[];
  state: GroupIntelligenceState;
  /** The owner's name inside this chat, once they told us. */
  me?: string;
  analyzedAt?: string;
  createdAt: string;
}

export interface Trace {
  id: number;
  at: string;
  channel: string;
  direction: 'in' | 'out' | 'model' | 'note';
  who: string;
  summary: string;
  payload?: string;
}

let db: DatabaseSync | null = null;

function open(): DatabaseSync {
  if (db) return db;
  const file = process.env.GROUP_OS_DB || path.resolve(process.cwd(), 'data/groupos.db');
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (phone TEXT PRIMARY KEY, data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, owner TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS groups_owner ON groups(owner);
    CREATE TABLE IF NOT EXISTS traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, channel TEXT NOT NULL, direction TEXT NOT NULL,
      who TEXT NOT NULL, summary TEXT NOT NULL, payload TEXT
    );
  `);
  return db;
}

/** For tests: start from an empty database. */
export function resetStore(file = ':memory:') {
  db?.close();
  db = null;
  process.env.GROUP_OS_DB = file;
}

export function getPerson(phone: string): Person | undefined {
  const row = open().prepare('SELECT data FROM people WHERE phone = ?').get(phone) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Person) : undefined;
}

export function savePerson(p: Person) {
  open().prepare('INSERT INTO people (phone, data) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET data = excluded.data').run(p.phone, JSON.stringify(p));
}

export function listGroups(owner: string): StoredGroup[] {
  const rows = open().prepare('SELECT data FROM groups WHERE owner = ? ORDER BY rowid').all(owner) as { data: string }[];
  return rows.map(r => JSON.parse(r.data) as StoredGroup);
}

export function getGroup(id: string): StoredGroup | undefined {
  const row = open().prepare('SELECT data FROM groups WHERE id = ?').get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as StoredGroup) : undefined;
}

export function saveGroup(g: StoredGroup) {
  open()
    .prepare('INSERT INTO groups (id, owner, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
    .run(g.id, g.owner, JSON.stringify(g));
}

export function deleteGroup(id: string) {
  open().prepare('DELETE FROM groups WHERE id = ?').run(id);
}

/** "Delete my data": the person, their groups, and every trace line about them. */
export function deleteEverything(phone: string) {
  const d = open();
  d.prepare('DELETE FROM groups WHERE owner = ?').run(phone);
  d.prepare('DELETE FROM people WHERE phone = ?').run(phone);
  d.prepare('DELETE FROM traces WHERE who = ?').run(maskPhone(phone));
}

/** Phone numbers are never shown in full on the trace page. */
export const maskPhone = (phone: string) => (phone.length > 4 ? `…${phone.slice(-4)}` : phone);
const redact = (text: string) => text.replace(/\+?\d[\d ]{8,16}\d/g, m => maskPhone(m.replace(/\D/g, '')));

export function addTrace(t: Omit<Trace, 'id' | 'at' | 'who'> & { phone: string }) {
  open()
    .prepare('INSERT INTO traces (at, channel, direction, who, summary, payload) VALUES (?, ?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), t.channel, t.direction, maskPhone(t.phone), redact(t.summary), t.payload ? redact(t.payload).slice(0, 20000) : null);
}

export function listTraces(limit = 200): Trace[] {
  return open().prepare('SELECT * FROM traces ORDER BY id DESC LIMIT ?').all(limit) as unknown as Trace[];
}
