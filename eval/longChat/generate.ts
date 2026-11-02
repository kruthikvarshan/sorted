/**
 * Writes the long test chat: each storyline chunk is turned into WhatsApp messages by Muse Spark, then everything
 * is interleaved by time. Every message keeps the topic it was written for, so topic tagging can be scored.
 *
 *   npx tsx eval/longChat/generate.ts            writes src/data/longChat/flat402.json
 *
 * Needs MODEL_API_KEY in .env.local. Fictional people only.
 */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { MetaModelService } from '../../src/services/metaModelService';
import { guardMetaCalls } from '../../server/live/budget';
import { CHUNKS, Chunk, PEOPLE, Person } from './story';
import { GROUPS } from './groups';

// --group=<id> writes one of the extra demo groups; without it, the Flat 402 sample.
const groupArg = process.argv.find(a => a.startsWith('--group='))?.split('=')[1];
const group = groupArg ? GROUPS.find(g => g.id === groupArg) : undefined;
if (groupArg && !group) throw new Error(`Unknown group ${groupArg}. Known: ${GROUPS.map(g => g.id).join(', ')}`);
const people: Person[] = group?.people ?? PEOPLE;
const chunks: Chunk[] = group?.chunks ?? CHUNKS;

config({ path: ['.env.local', '.env'], quiet: true });
const key = process.env.MODEL_API_KEY?.trim();
if (!key) throw new Error('MODEL_API_KEY is not set');
MetaModelService.baseUrl = process.env.META_API_BASE || 'https://api.meta.ai/v1';
// Our own runs spend from the same Meta credit, so they are counted on the same spend page.
guardMetaCalls();

export interface LongMessage {
  at: string; // ISO local time
  speaker: string;
  text: string;
  topic: string;
  /** The money this line moves, as the writer meant it: the right answer the app is scored against. */
  money?: MoneyEvent[];
}

/** owes: [from, to, amount] creates a debt; paid: [from, to, amount] a payment that happened. */
export type MoneyEvent = { owes: [string, string, number] } | { paid: [string, string, number] };

/** Part k of n of a chunk covers the k-th slice of its dates and of its events, so long threads stay in order. */
function slice(c: Chunk, part: number, parts: number) {
  const a = new Date(c.from).getTime(), b = new Date(c.to).getTime();
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  const from = day(a + ((b - a) * (part - 1)) / parts), to = day(a + ((b - a) * part) / parts);
  const per = Math.ceil(c.beats.length / parts);
  const beats = c.beats.length <= 1 ? c.beats : c.beats.slice((part - 1) * per, part * per);
  return { from, to, beats: beats.length ? beats : ['Natural follow-up talk about this thread only: no new bills, no new amounts, no new payments, no new decisions. Do not repeat earlier events as if they happened again.'] };
}

const prompt = (c: Chunk, part: number, parts: number, n: number, before: LongMessage[] = []) => [
  {
    role: 'system' as const,
    content: `You write realistic WhatsApp group messages for a test dataset. Fictional people only.
People and how they write:
${people.filter(p => c.who.includes(p.name)).map(p => `- ${p.name}: ${p.style}`).join('\n')}

${group?.voice ?? 'Write like real friends in Hyderabad: short messages, typos, emojis, replies like "ok", "done", "😂", several messages in a row from one person, Telugu and Hindi in English letters mixed with English.'} Numbers are written the way people type them (9000, 9k, ₹9,000). Never explain, never narrate.

Output ONLY JSON lines, one message per line, no array, no other text:
{"d":"YYYY-MM-DD","t":"HH:MM","s":"Name","x":"message text"}

Money tags (the answer key, not shown to anyone): on the ONE line where money between two people in this chat is settled as owed or paid, add "m":
- a debt is agreed (a bill split, a loan given, a bet lost, a share): "m":{"owes":[["Debtor","Creditor",amount], ...]} with one entry per person who owes, never the payer themself;
- a payment happens (the payer's own "sent/bhej diya" line, not the "received" reply): "m":{"paid":[["Payer","Receiver",amount]]}.
Tag each debt and each payment exactly once. No tag for talk about money, reminders, plans, prices or payments to people outside the chat (owner, maid, shop). A part payment is tagged with the part paid.`,
  },
  {
    role: 'user' as const,
    content: `Thread: ${c.title}
Dates: between ${slice(c, part, parts).from} and ${slice(c, part, parts).to}, spread over several days and times of day (mornings, late nights), in time order.
${parts > 1 ? `This is part ${part} of ${parts} of this thread.\n` : ''}${
      before.length
        ? `The chat so far in this thread ends like this; continue from here. Everything in earlier parts already happened and must not happen again (no second payment of the same thing, no "still pending" for something already paid):\n${before.map(m => `${m.at.slice(0, 16).replace('T', ' ')} ${m.speaker}: ${m.text}`).join('\n')}\n${slice(c, part - 1, parts).beats.length ? `Already done earlier: ${c.beats.slice(0, Math.ceil(c.beats.length / parts) * (part - 1)).join(' ')}\n` : ''}`
        : ''
    }Talk only about this thread: no amounts, bills or payments from other topics.
Only these people speak: ${c.who.join(', ')}.
Write exactly ${n} messages. These events MUST happen, in this order, with these exact numbers and names:
${slice(c, part, parts).beats.map((b, i) => `${i + 1}. ${b}`).join('\n')}
Fill the rest with natural back-and-forth about this thread.`,
  },
];

function parse(raw: string, c: Chunk, range = { from: c.from, to: c.to }): LongMessage[] {
  const out: LongMessage[] = [];
  for (const line of raw.split('\n')) {
    const s = line.trim().replace(/,$/, '');
    if (!s.startsWith('{')) continue;
    try {
      const o = JSON.parse(s);
      if (!c.who.includes(o.s) || typeof o.x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.d) || !/^\d{1,2}:\d{2}$/.test(o.t)) continue;
      if (o.d < range.from || o.d > range.to) continue;
      const money: MoneyEvent[] = [];
      const ok = (r: any) => Array.isArray(r) && r.length === 3 && c.who.includes(r[0]) && c.who.includes(r[1]) && r[0] !== r[1] && Number(r[2]) > 0;
      for (const r of o.m?.owes ?? []) if (ok(r)) money.push({ owes: [r[0], r[1], Number(r[2])] });
      for (const r of o.m?.paid ?? []) if (ok(r)) money.push({ paid: [r[0], r[1], Number(r[2])] });
      out.push({ at: `${o.d}T${o.t.padStart(5, '0')}:00`, speaker: o.s, text: o.x.trim(), topic: c.topic, ...(money.length ? { money } : {}) });
    } catch {
      /* skip a broken line */
    }
  }
  return out;
}

async function writeChunk(c: Chunk): Promise<LongMessage[]> {
  const parts = Math.max(1, Math.ceil(c.count / 110));
  const all: LongMessage[] = [];
  for (let part = 1; part <= parts; part++) {
    const n = Math.round(c.count / parts);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const raw = await MetaModelService.callChatCompletion(key!, prompt(c, part, parts, n, all.slice(-30)), { temperature: 0.9, max_tokens: 24000, reasoningEffort: 'minimal' });
        const got = parse(raw, c, slice(c, part, parts));
        if (got.length >= n * 0.6) {
          all.push(...got);
          break;
        }
        console.warn(`  ${c.title} part ${part}: only ${got.length}/${n}, retrying`);
      } catch (err: any) {
        console.warn(`  ${c.title} part ${part}: ${err.message.slice(0, 120)}, retrying`);
      }
    }
  }
  console.log(`  ${c.title} (${c.from}): ${all.length} messages`);
  return all;
}

async function main() {
  const started = Date.now();
  const results: LongMessage[][] = [];
  const queue = chunks.map((c, i) => ({ c, i }));
  await Promise.all(
    Array.from({ length: 5 }, async () => {
      while (queue.length) {
        const { c, i } = queue.shift()!;
        results[i] = await writeChunk(c);
      }
    })
  );
  const messages = results.flat().sort((a, b) => a.at.localeCompare(b.at));
  mkdirSync('src/data/longChat', { recursive: true });
  const file = `src/data/longChat/${group?.id ?? 'flat402'}.json`;
  writeFileSync(file, JSON.stringify({ title: group?.title ?? 'Flat 402 & friends', generatedWith: MetaModelService.DEFAULT_MODEL, people: people.map(p => p.name), messages }, null, 0));
  const byTopic = messages.reduce<Record<string, number>>((m, x) => ((m[x.topic] = (m[x.topic] ?? 0) + 1), m), {});
  console.log(`\n${messages.length} messages written in ${Math.round((Date.now() - started) / 1000)}s`, byTopic);
}

main();
