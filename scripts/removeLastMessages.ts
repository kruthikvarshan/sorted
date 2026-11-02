/**
 * Removes the last few messages of one group (for example test questions and Sorted's replies to them). Without
 * --yes it only shows what it would remove. Restart the service afterwards: groups are held in memory.
 *
 *   npx tsx scripts/removeLastMessages.ts --group="Flat 7B" --last=4          (preview)
 *   npx tsx scripts/removeLastMessages.ts --group="Flat 7B" --last=4 --yes    (remove)
 */
import { DatabaseSync } from 'node:sqlite';

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const title = arg('group');
const last = Number(arg('last') ?? 0);
const really = process.argv.includes('--yes');
if (!title || !(last > 0)) throw new Error('Usage: --group="<name>" --last=<n> [--yes]');

const db = new DatabaseSync(process.env.GROUP_OS_DB ?? 'data/groupos.db');
const rooms = (db.prepare('SELECT id, data FROM live_rooms').all() as { id: string; data: string }[])
  .map(r => ({ id: r.id, room: JSON.parse(r.data) }))
  .filter(r => String(r.room.title ?? '').toLowerCase().includes(title.toLowerCase()));
if (rooms.length !== 1) throw new Error(`${rooms.length} groups match "${title}"; use a more exact name.`);
const { id, room } = rooms[0];

const rows = (db.prepare('SELECT seq, data FROM live_messages WHERE room = ? ORDER BY seq DESC LIMIT ?').all(id, last) as { seq: number; data: string }[]).reverse();
const gone = rows.map(r => ({ seq: r.seq, ...JSON.parse(r.data) }));
console.log(`${room.title}: ${really ? 'removing' : 'would remove'} these ${gone.length} messages`);
for (const m of gone) console.log(`  #${m.seq} ${m.timestamp ?? ''} ${m.speakerName}: ${String(m.content ?? '').replace(/\n/g, ' ').slice(0, 120)}`);

// Sorted's read position counts people's messages only; it moves back by the people's messages removed.
const people = gone.filter(m => m.speakerId !== 'groupos').length;
const ids = new Set(gone.map(m => m.id));
const cited = Object.entries(room.state?.evidenceMap ?? {}).filter(([, e]) => ids.has((e as { messageId: string }).messageId)).length;
console.log(`  read position ${room.state?.readThrough ?? 0} → ${Math.max(0, (room.state?.readThrough ?? 0) - people)}; evidence citing them: ${cited}`);

if (!really) {
  console.log('Preview only. Add --yes to remove them, then restart the service.');
} else {
  const del = db.prepare('DELETE FROM live_messages WHERE room = ? AND seq = ?');
  for (const m of gone) del.run(id, m.seq);
  room.state.readThrough = Math.max(0, (room.state.readThrough ?? 0) - people);
  db.prepare('UPDATE live_rooms SET data = ? WHERE id = ?').run(JSON.stringify(room), id);
  console.log('Removed. Now restart the service (Render: Manual Deploy → Restart service).');
}
