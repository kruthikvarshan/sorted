/**
 * Scores the long-chat pipeline on the 2,000-message test group.
 *
 *   npx tsx eval/longChat/evaluate.ts                 read the whole chat in 3 increments (like a live group)
 *   npx tsx eval/longChat/evaluate.ts --limit=600     only the first 600 messages (faster)
 *
 * Topic accuracy: for each real thread, the topic that holds most of its messages, how much of the thread it holds
 * (coverage) and how clean it is (purity). Facts: each known fact must be found, under the right topic.
 */
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeGroup } from '../../src/services/groupAnalyzer';
import { MetaModelService } from '../../src/services/metaModelService';
import { GroupIntelligenceState, Message, Topic } from '../../src/types/groupOs';
import { EXPECT } from './story';

config({ path: ['.env.local', '.env'], quiet: true });
const key = process.env.MODEL_API_KEY?.trim();
if (!key) throw new Error('MODEL_API_KEY is not set');
MetaModelService.baseUrl = process.env.META_API_BASE || 'https://api.meta.ai/v1';
const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1]) || Infinity;

const data = JSON.parse(readFileSync('src/data/longChat/flat402.json', 'utf8')) as { messages: { at: string; speaker: string; text: string; topic: string }[] };
const rows = data.messages.slice(0, limit);
const messages: Message[] = rows.map((m, i) => ({
  id: `m${i + 1}`, conversationId: 'flat402', speakerId: m.speaker, speakerName: m.speaker, timestamp: m.at.slice(11, 16),
  content: m.text, type: 'text', createdAt: new Date(m.at).getTime(),
}));
const truth = new Map(messages.map((m, i) => [m.id, rows[i].topic]));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const norm = (s: string) => s.toLowerCase().replace(/(\d),(\d)/g, '$1$2');

async function main() {
  let state: GroupIntelligenceState | undefined;
  const cuts = [Math.floor(messages.length * 0.7), Math.floor(messages.length * 0.85), messages.length];
  let tokens = 0, calls = 0, ms = 0;
  const corrections: string[] = [];
  for (const cut of cuts) {
    const res = await analyzeGroup(messages.slice(0, cut), state, {
      apiKey: key!, groupId: 'flat402', onProgress: p => process.stdout.write(`\r  ${cut} msgs: ${p.stage} ${p.done}/${p.total} ${p.label ?? ''}`.padEnd(90)),
    });
    state = res.state;
    tokens += res.report.tokens; calls += res.report.calls; ms += res.report.ms;
    corrections.push(...res.report.corrections);
    console.log(`\n  read ${res.report.newMessages} new messages: ${res.report.batches} batches, ${res.report.topicsCreated.length} new topics, ${res.report.topicsUpdated.length} updated, ${Math.round(res.report.ms / 1000)}s${res.report.failedTopics.length ? `, FAILED: ${res.report.failedTopics.map(f => f.title).join(', ')}` : ''}`);
  }
  const topics = state!.topics ?? [];

  // Topic accuracy
  const realTopics = [...new Set(rows.map(r => r.topic))].filter(t => t !== 'chat');
  const holder = (t: Topic) => {
    const counts = new Map<string, number>();
    t.messageIds.forEach(id => counts.set(truth.get(id)!, (counts.get(truth.get(id)!) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  };
  console.log('\nTopics found:');
  topics.forEach(t => console.log(`  ${t.status === 'open' ? '●' : '○'} ${t.title} (${t.messageIds.length})  ← mostly "${holder(t)?.[0]}"`));
  console.log('\nThread              coverage  purity  split into');
  const topicScores = realTopics.map(real => {
    const size = rows.filter(r => r.topic === real).length;
    const holders = topics.map(t => ({ t, n: t.messageIds.filter(id => truth.get(id) === real).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n);
    const best = holders[0];
    const coverage = best ? best.n / size : 0;
    const purity = best ? best.n / best.t.messageIds.length : 0;
    const split = holders.filter(h => h.n >= size * 0.1).length;
    console.log(`  ${real.padEnd(18)}${pct(coverage).padEnd(10)}${pct(purity).padEnd(8)}${split}`);
    return { real, coverage, purity, split, best: best?.t.id };
  });
  const chatLeak = rows.filter((r, i) => r.topic === 'chat' && topics.some(t => t.messageIds.includes(messages[i].id))).length / Math.max(1, rows.filter(r => r.topic === 'chat').length);
  const lostToChat = rows.filter((r, i) => r.topic !== 'chat' && !topics.some(t => t.messageIds.includes(messages[i].id))).length / Math.max(1, rows.filter(r => r.topic !== 'chat').length);

  // Facts
  const s = state!;
  const textOf = {
    decision: s.decisions.map(d => ({ topicId: d.topicId, status: d.status, text: norm(`${d.topic} ${d.currentValue} ${d.split?.perPerson ?? ''} ${d.split?.total ?? ''}`) })),
    commitment: s.commitments.map(c => ({ topicId: c.topicId, status: c.status, text: norm(`${c.ownerName} ${c.description} ${c.amount ?? ''} ${c.dueAt ?? ''}`) })),
    conflict: s.conflicts.map(c => ({ topicId: c.topicId, status: c.status, text: norm(`${c.topic} ${c.description}`) })),
  };
  const bestFor = new Map(topicScores.map(t => [t.real, t.best]));
  const present = EXPECT.filter(e => rows.some(r => r.topic === e.topic));
  console.log('\nFacts:');
  const facts = present.map(e => {
    const hits = textOf[e.kind].filter(x => e.any.some(k => x.text.includes(norm(k))) && (!e.status || e.status.includes(x.status)));
    const rightTopic = hits.some(h => h.topicId === bestFor.get(e.topic));
    console.log(`  ${hits.length ? (rightTopic ? '✓' : '~') : '✗'} ${e.id.padEnd(20)} ${e.why}${hits.length && !rightTopic ? '  (found, under another topic)' : ''}`);
    return { id: e.id, found: hits.length > 0, rightTopic };
  });

  const found = facts.filter(f => f.found).length;
  const placed = facts.filter(f => f.rightTopic).length;
  const avg = (k: 'coverage' | 'purity') => topicScores.reduce((a, t) => a + t[k], 0) / Math.max(1, topicScores.length);
  console.log(`\nSUMMARY  ${messages.length} messages · ${topics.length} topics for ${realTopics.length} real threads`);
  console.log(`  topic coverage ${pct(avg('coverage'))} · purity ${pct(avg('purity'))} · small talk pulled into topics ${pct(chatLeak)} · thread messages lost to small talk ${pct(lostToChat)}`);
  console.log(`  facts found ${found}/${facts.length} (${pct(found / Math.max(1, facts.length))}) · under the right topic ${placed}/${facts.length}`);
  console.log(`  ${calls} Meta calls · ${tokens.toLocaleString()} tokens · ${Math.round(ms / 1000)}s · ${corrections.length} tag corrections by code`);
  // The sample group in the live app opens with these results instead of reading 2,000 messages on the spot.
  if (process.argv.includes('--save-state')) writeFileSync('src/data/longChat/flat402.state.json', JSON.stringify(state));
  writeFileSync('eval/longChat/last-run.json', JSON.stringify({ at: new Date().toISOString(), messages: messages.length, topics: topics.map(t => ({ title: t.title, n: t.messageIds.length, status: t.status })), topicScores, facts, chatLeak, lostToChat, calls, tokens, ms, corrections: corrections.slice(0, 50) }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
