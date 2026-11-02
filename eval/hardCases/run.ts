/**
 * Runs every hard money case through the real Sorted pipeline (Muse Spark reading, code checking) and compares the
 * balances with the expected ones, to the rupee.
 *
 *   npx tsx eval/hardCases/run.ts            all cases
 *   npx tsx eval/hardCases/run.ts loan two   only cases whose id contains "loan" or "two"
 */
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'node:fs';
import { analyzeGroup } from '../../src/services/groupAnalyzer';
import { buildPanel } from '../../src/engine/panel';
import { MetaModelService } from '../../src/services/metaModelService';
import { guardMetaCalls } from '../../server/live/budget';
import { CASES, HardCase } from './cases';

config({ path: ['.env.local', '.env'], quiet: true });
const key = process.env.MODEL_API_KEY!.trim();
MetaModelService.baseUrl = process.env.META_API_BASE || 'https://api.meta.ai/v1';
guardMetaCalls();

const debug = process.argv.includes('--debug');
const only = process.argv.slice(2).filter(a => a !== '--debug');
const cases = only.length ? CASES.filter(c => only.some(o => c.id.includes(o))) : CASES;

async function run(c: HardCase) {
  const start = Date.UTC(2026, 9, 1, 10);
  const messages = c.chat.map(([speaker, text], i) => ({ id: `m${i + 1}`, conversationId: c.id, speakerId: `p_${speaker.toLowerCase().replace(/\W+/g, '_')}`, speakerName: speaker, timestamp: '', content: text, type: 'text' as const, createdAt: start + i * 120_000 }));
  const { state } = await analyzeGroup(messages, undefined, { apiKey: key, groupId: c.id });
  const ws = { id: c.id, title: c.id, category: 'Live', description: '', participants: c.people.map(n => ({ id: n, name: n, avatarColor: '' })), unreadCount: 0, lastActivity: '', iconName: '' };
  const got = buildPanel(ws as any, state, messages as any, { defaultCurrency: c.currency === 'USD' ? '$' : '₹' }).owes.map(o => [o.from, o.to, Math.round(o.amount)] as [string, string, number]);
  if (debug) {
    console.log(`\n=== ${c.id}`);
    state.decisions.forEach(d => console.log('  D', d.topic, '=', d.currentValue, d.status, JSON.stringify(d.split ?? null)));
    state.commitments.forEach(x => console.log('  C', x.ownerName, '→', x.payee, x.amount, x.status, x.verification?.state ?? '', '|', x.description, '|', x.evidenceIds.map(e => state.evidenceMap[e]?.messageId).join(',')));
    state.conflicts.forEach(x => console.log('  X', x.topic, x.status));
  }
  const norm = (rows: [string, string, number][]) => rows.map(r => r.join('|')).sort().join(', ');
  return { id: c.id, trap: c.trap, pass: norm(got) === norm(c.expect), expect: norm(c.expect) || 'settled', got: norm(got) || 'settled' };
}

(async () => {
  const results: Awaited<ReturnType<typeof run>>[] = [];
  const queue = [...cases];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const c = queue.shift()!;
        try {
          results.push(await run(c));
        } catch (err: any) {
          results.push({ id: c.id, trap: c.trap, pass: false, expect: '', got: `error: ${err.message}` });
        }
      }
    })
  );
  results.sort((a, b) => CASES.findIndex(c => c.id === a.id) - CASES.findIndex(c => c.id === b.id));
  const passed = results.filter(r => r.pass).length;
  console.log(`Hard cases: ${passed}/${results.length} exact`);
  for (const r of results) console.log(`  ${r.pass ? '✓' : '✗'} ${r.id.padEnd(22)} ${r.pass ? '' : `expected ${r.expect} · got ${r.got}`}`);
  mkdirSync('eval/results', { recursive: true });
  writeFileSync('eval/results/hardCases.json', JSON.stringify({ at: new Date().toISOString(), passed, total: results.length, results }, null, 2));
})();
