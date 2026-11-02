import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

/**
 * A quiet safety net for the Meta credit: every call to Meta's API is counted in dollars from Meta's own usage
 * numbers, and work pauses calmly before the credit could run out. Nothing a person sees ever says "out of tokens":
 *  - up to the soft limit, everything runs;
 *  - past it, background reading waits ("Group OS will read these a little later");
 *  - past the hard limit, new Meta calls wait; everything already worked out (chat, money, settle-up) keeps working.
 * One group also has a daily share, so a single group cannot use everyone's credit.
 * Prices: Muse Spark $1.25 / $4.25 per million input / output tokens, web search $2.50 per 1,000 searches.
 */

/** `started`: a read the safety net already let start; it always finishes, so no message is half-read. */
export type Work = { kind: 'background' | 'interactive'; roomId?: string; started?: boolean };

const work = new AsyncLocalStorage<Work>();
/** Run something as background or interactive work for a group, so the limits know what it is. */
export const asWork = <T>(w: Work, fn: () => T): T => work.run(w, fn);

const env = (k: string, d: number) => Number(process.env[k] ?? d);
export const limits = () => ({
  soft: env('META_BUDGET_SOFT_USD', 60),
  hard: env('META_BUDGET_HARD_USD', 85),
  perRoomDay: env('META_BUDGET_ROOM_DAY_USD', 1.5),
});
const PRICE = { input: 1.25 / 1e6, output: 4.25 / 1e6, search: 2.5 / 1000, image: 0.04, voiceMinute: 0.01 };

/** Why Meta work is waiting: a calm sentence for people, never an error code. */
export class Resting extends Error {
  constructor(public why: 'background' | 'all' | 'room') {
    super(
      why === 'background'
        ? 'Group OS will read these a little later.'
        : why === 'room'
          ? 'Group OS has done a lot in this group today and will pick up again soon. Everything already worked out still works.'
          : 'Group OS is resting for a bit. Everything already worked out (chat, money, settle-up) still works.'
    );
  }
}

let db: DatabaseSync | null = null;
function open() {
  if (db) return db;
  const file = process.env.GROUP_OS_DB || path.resolve(process.cwd(), 'data/groupos.db');
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('CREATE TABLE IF NOT EXISTS meta_spend (at INTEGER NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, room TEXT, endpoint TEXT, usd REAL NOT NULL)');
  return db;
}
export function resetBudget(file = ':memory:') {
  db?.close();
  db = null;
  process.env.GROUP_OS_DB = file;
}

const today = () => new Date().toISOString().slice(0, 10);
const total = () => (open().prepare('SELECT COALESCE(SUM(usd), 0) AS s FROM meta_spend').get() as { s: number }).s;
const roomToday = (room: string) => (open().prepare('SELECT COALESCE(SUM(usd), 0) AS s FROM meta_spend WHERE room = ? AND day = ?').get(room, today()) as { s: number }).s;

/** Throws Resting when this piece of work should wait. */
export function check(w: Work | undefined = work.getStore()) {
  const { soft, hard, perRoomDay } = limits();
  const spent = total();
  if (spent >= hard) throw new Resting('all');
  if (spent >= soft && w?.kind === 'background') throw new Resting('background');
  if (w?.roomId && roomToday(w.roomId) >= perRoomDay) throw new Resting('room');
}

export function record(endpoint: string, usd: number, w: Work | undefined = work.getStore()) {
  if (!(usd > 0)) return;
  open().prepare('INSERT INTO meta_spend (at, day, kind, room, endpoint, usd) VALUES (?, ?, ?, ?, ?, ?)').run(Date.now(), today(), w?.kind ?? 'interactive', w?.roomId ?? null, endpoint, usd);
}

/** What a Meta response cost, from its own usage numbers. */
export function costOf(endpoint: string, json: any): number {
  const u = json?.usage ?? {};
  const input = u.prompt_tokens ?? u.input_tokens ?? 0;
  const output = u.completion_tokens ?? u.output_tokens ?? 0;
  let usd = input * PRICE.input + output * PRICE.output;
  if (/\/responses/.test(endpoint)) usd += (json?.output ?? []).filter((o: any) => o?.type === 'web_search_call').length * PRICE.search;
  if (/\/images\//.test(endpoint)) usd += PRICE.image;
  if (/\/asr\//.test(endpoint)) usd += ((Number(json?.audioDurationMs) || 60_000) / 60_000) * PRICE.voiceMinute;
  return usd;
}

export function spendReport() {
  const rows = open().prepare('SELECT day, kind, ROUND(SUM(usd), 4) AS usd, COUNT(*) AS calls FROM meta_spend GROUP BY day, kind ORDER BY day DESC').all();
  const rooms = open().prepare('SELECT room, ROUND(SUM(usd), 4) AS usd FROM meta_spend WHERE day = ? AND room IS NOT NULL GROUP BY room ORDER BY usd DESC LIMIT 10').all(today());
  return { total: Math.round(total() * 100) / 100, limits: limits(), byDay: rows, topRoomsToday: rooms };
}

/**
 * Every call the server makes to Meta's API goes through here: checked before, counted after. Installed once; other
 * requests (WhatsApp, the web) pass straight through.
 */
export function guardMetaCalls(base = () => process.env.META_API_BASE || 'https://api.meta.ai/v1') {
  const g = globalThis as any;
  if (g.__groupOsMetaGuard) return;
  g.__groupOsMetaGuard = true;
  const plain = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (!url.startsWith(base().replace(/\/$/, ''))) return plain(input, init);
    if (!work.getStore()?.started) check();
    const res = await plain(input, init);
    if (res.ok) {
      res
        .clone()
        .json()
        .then(json => record(new URL(url).pathname, costOf(url, json)))
        .catch(() => undefined);
    }
    return res;
  }) as typeof fetch;
}
