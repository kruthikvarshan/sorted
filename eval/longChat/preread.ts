/**
 * Reads a demo group with the real pipeline (Muse Spark topics + extraction), all but its latest messages, and saves
 * the results, so the demo phone opens with groups that were "already read" and the newest messages are read live.
 *
 *   npx tsx eval/longChat/preread.ts --group=raofamily --leave=25
 */
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeGroup } from '../../src/services/groupAnalyzer';
import { MetaModelService } from '../../src/services/metaModelService';
import { guardMetaCalls } from '../../server/live/budget';
import { Message } from '../../src/types/groupOs';

config({ path: ['.env.local', '.env'], quiet: true });
const key = process.env.MODEL_API_KEY?.trim();
if (!key) throw new Error('MODEL_API_KEY is not set');
MetaModelService.baseUrl = process.env.META_API_BASE || 'https://api.meta.ai/v1';
// Our own runs spend from the same Meta credit, so they are counted on the same spend page.
guardMetaCalls();

const id = process.argv.find(a => a.startsWith('--group='))?.split('=')[1] ?? 'flat402';
const leave = Number(process.argv.find(a => a.startsWith('--leave='))?.split('=')[1] ?? 25);

const data = JSON.parse(readFileSync(`src/data/longChat/${id}.json`, 'utf8')) as { messages: { at: string; speaker: string; text: string }[] };
// Same ids and speaker ids as the live rooms give these messages (server/live/http.ts).
const messages: Message[] = data.messages.map((m, i) => ({
  id: `m${i + 1}`, conversationId: id, speakerId: `p_${m.speaker.toLowerCase().replace(/\W+/g, '_')}`, speakerName: m.speaker,
  timestamp: m.at.slice(11, 16), content: m.text, type: 'text', createdAt: new Date(m.at).getTime(),
}));
const upTo = Math.max(0, messages.length - leave);

const started = Date.now();
analyzeGroup(messages.slice(0, upTo), undefined, {
  apiKey: key,
  groupId: id,
  onProgress: p => process.stdout.write(`\r  ${id}: ${p.stage} ${p.done}/${p.total} ${p.label ?? ''}`.padEnd(100)),
})
  .then(({ state, report }) => {
    // The real numbers from this read travel with the results, so the app can show how they were made.
    const readBy = { model: MetaModelService.DEFAULT_MODEL, at: Date.now(), messages: upTo, calls: report.calls, tokens: report.tokens, ms: Date.now() - started };
    writeFileSync(`src/data/longChat/${id}.state.json`, JSON.stringify({ ...state, readBy }));
    console.log(`\n${id}: read ${upTo} of ${messages.length} messages (${leave} left for live reading) · ${state.topics?.length} topics · ${report.calls} calls · ${report.tokens.toLocaleString()} tokens · ${Math.round((Date.now() - started) / 1000)}s${report.failedTopics.length ? ` · failed: ${report.failedTopics.map(f => f.title).join(', ')}` : ''}`);
  })
  .catch(err => {
    console.error(`\n${id}: ${err.message}`);
    process.exit(1);
  });
