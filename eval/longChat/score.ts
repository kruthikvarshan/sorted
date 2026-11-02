/**
 * Scores a group read by Group OS against the answer key written with the chat: every money line was tagged by the
 * generator ("owes" / "paid"), so the true balance between every two people is known to the rupee.
 *
 *   npx tsx eval/longChat/score.ts --group=gymsquad
 *
 * Prints each pair (truth vs Group OS), the payments Group OS found, and saves eval/results/<group>.score.json.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildPanel } from '../../src/engine/panel';
import type { MoneyEvent } from './generate';

const id = process.argv.find(a => a.startsWith('--group='))?.split('=')[1] ?? 'gymsquad';
const data = JSON.parse(readFileSync(`src/data/longChat/${id}.json`, 'utf8')) as { title: string; people: string[]; messages: { at: string; speaker: string; text: string; money?: MoneyEvent[] }[] };
const state = JSON.parse(readFileSync(`src/data/longChat/${id}.state.json`, 'utf8'));

// The truth: what each person owes each other person once every tagged debt and payment is counted.
const net = new Map<string, number>();
const add = (from: string, to: string, amount: number) => {
  const [a, b] = [from, to].sort();
  const k = `${a}|${b}`;
  net.set(k, (net.get(k) ?? 0) + (from === a ? amount : -amount));
};
// Only what Group OS has read: example groups keep their newest messages unread on purpose, to be read live.
const readThrough = state.readThrough ?? data.messages.length;
let tagged = 0;
for (const m of data.messages.slice(0, readThrough))
  for (const e of m.money ?? []) {
    tagged++;
    if ('owes' in e) add(e.owes[0], e.owes[1], e.owes[2]);
    else add(e.paid[0], e.paid[1], -e.paid[2]);
  }
const truth = [...net.entries()]
  .filter(([, v]) => Math.abs(v) >= 1)
  .map(([k, v]) => {
    const [a, b] = k.split('|');
    return v > 0 ? { from: a, to: b, amount: Math.round(v) } : { from: b, to: a, amount: Math.round(-v) };
  });

// What Group OS shows.
const messages = data.messages.map((m, i) => ({ id: `m${i + 1}`, conversationId: id, speakerId: `p_${m.speaker.toLowerCase().replace(/\W+/g, '_')}`, speakerName: m.speaker, timestamp: m.at.slice(11, 16), content: m.text, type: 'text' as const, createdAt: new Date(m.at).getTime() }));
const ws = { id, title: data.title, category: 'Live', description: '', participants: data.people.map(n => ({ id: `p_${n.toLowerCase()}`, name: n, avatarColor: '' })), unreadCount: 0, lastActivity: '', iconName: 'Users' };
const shown = buildPanel(ws as any, state, messages as any, { defaultCurrency: '₹' }).owes.map(o => ({ from: o.from, to: o.to, amount: Math.round(o.amount) }));

// Pair by pair.
const keyOf = (p: { from: string; to: string }) => [p.from, p.to].sort().join('|');
const signed = (p: { from: string; to: string; amount: number }) => ([p.from, p.to].sort()[0] === p.from ? p.amount : -p.amount);
const pairs = new Set([...truth.map(keyOf), ...shown.map(keyOf)]);
const rows = [...pairs].map(k => {
  const t = truth.find(p => keyOf(p) === k);
  const s = shown.find(p => keyOf(p) === k);
  const tv = t ? signed(t) : 0;
  const sv = s ? signed(s) : 0;
  const [a, b] = k.split('|');
  const say = (v: number) => (Math.abs(v) < 1 ? 'settled' : v > 0 ? `${a} → ${b} ₹${v.toLocaleString('en-IN')}` : `${b} → ${a} ₹${(-v).toLocaleString('en-IN')}`);
  return { pair: `${a} & ${b}`, truth: say(tv), groupOs: say(sv), exact: Math.abs(tv - sv) < 1, off: Math.round(sv - tv) };
});

// Payments: a tagged payment counts as found when a recorded payment cites that line or one of the next few.
const cited = new Set<number>();
for (const c of state.commitments ?? [])
  if (c.status === 'completed' && c.payee)
    for (const e of c.evidenceIds ?? []) {
      const mid = state.evidenceMap?.[e]?.messageId;
      if (mid) cited.add(Number(String(mid).slice(1)));
    }
let paid = 0;
let found = 0;
data.messages.slice(0, readThrough).forEach((m, i) => {
  if (!(m.money ?? []).some(e => 'paid' in e)) return;
  paid++;
  if ([0, 1, 2, 3, 4].some(d => cited.has(i + 1 + d))) found++;
});

const exact = rows.filter(r => r.exact).length;
const report = { group: id, title: data.title, messages: data.messages.length, read: readThrough, taggedEvents: tagged, pairsExact: `${exact}/${rows.length}`, paymentsFound: `${found}/${paid}`, rows };
mkdirSync('eval/results', { recursive: true });
writeFileSync(`eval/results/${id}.score.json`, JSON.stringify(report, null, 2));
console.log(`${data.title}: ${exact}/${rows.length} pairs exact · payments found ${found}/${paid} · ${tagged} tagged money lines`);
rows.forEach(r => console.log(`  ${r.exact ? '✓' : '✗'} ${r.pair.padEnd(22)} truth: ${r.truth.padEnd(28)} Group OS: ${r.groupOs}`));
