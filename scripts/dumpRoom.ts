/**
 * Prints one group for debugging: its messages, what Sorted worked out (topics, decisions, money, disagreements) and the
 * server's recent log lines about it. Never prints login tokens, PINs or phone numbers.
 *
 *   npx tsx scripts/dumpRoom.ts "Sunday Chai"
 */
import { DatabaseSync } from 'node:sqlite';

const title = process.argv[2];
if (!title) throw new Error('Usage: npx tsx scripts/dumpRoom.ts "<group name>"');
const db = new DatabaseSync(process.env.GROUP_OS_DB ?? 'data/groupos.db', { readOnly: true });

const rooms = (db.prepare('SELECT id, data FROM live_rooms').all() as { id: string; data: string }[])
  .map(r => ({ id: r.id, room: JSON.parse(r.data) }))
  .filter(r => String(r.room.title ?? '').toLowerCase().includes(title.toLowerCase()))
  .sort((a, b) => (b.room.createdAt ?? 0) - (a.room.createdAt ?? 0));
if (!rooms.length) throw new Error(`No group named like "${title}"`);
const { id, room } = rooms[0];
if (rooms.length > 1) console.log(`(${rooms.length} groups match; showing the newest)`);

const hidden = new Set(['token', 'phone', 'pin', 'session', 'evidenceMap', 'history']);
const clean = (v: unknown) => JSON.stringify(v, (k, x) => (hidden.has(k) ? undefined : x));

console.log(`\n== GROUP ${room.title} (${id}) created ${new Date(room.createdAt).toISOString()}`);
console.log('members:', (room.members ?? []).map((m: { name: string; joinedAt?: number; phone?: string }) => `${m.name}${m.joinedAt ? '' : ' (not joined)'}${m.phone ? ' [has number]' : ''}`).join(', '));
console.log('analysing:', room.analysing, '· lastAnalysis:', clean(room.lastAnalysis));

console.log('\n== MESSAGES');
const msgs = (db.prepare('SELECT seq, data FROM live_messages WHERE room = ? ORDER BY seq').all(id) as { seq: number; data: string }[]).map(m => ({ seq: m.seq, ...JSON.parse(m.data) }));
for (const m of msgs) console.log(`#${m.seq} ${m.timestamp ?? ''} ${m.speakerName}: ${String(m.content ?? '').replace(/\n/g, ' ⏎ ')}${m.fromScreenshot ? ' [screenshot]' : ''}`);

const s = room.state ?? {};
console.log(`\n== WHAT SORTED WORKED OUT (readThrough ${s.readThrough ?? '?'} of ${msgs.length})`);
for (const k of ['topics', 'decisions', 'commitments', 'conflicts']) {
  console.log(`\n-- ${k} (${(s[k] ?? []).length})`);
  for (const x of s[k] ?? []) console.log(clean(x));
}

console.log('\n== SERVER LOG (latest 60 about this group)');
const traces = db.prepare('SELECT at, direction, who, summary FROM traces WHERE summary LIKE ? OR who LIKE ? ORDER BY id DESC LIMIT 60').all(`%${room.title}%`, `%${room.title}%`) as { at: string; direction: string; who: string; summary: string }[];
for (const t of traces.reverse()) console.log(`${t.at} ${t.direction} ${t.who}: ${t.summary}`);
