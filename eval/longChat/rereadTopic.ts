/**
 * Re-reads one topic of a demo group with the current pipeline (all windows, then the payment sweep), replacing that
 * topic's results only. For checking a fix without reading the whole group again.
 *
 *   npx tsx eval/longChat/rereadTopic.ts --group=trio --topic="IPL bets"
 */
import { config } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import { analyzeGroup, mergeTopic } from '../../src/services/groupAnalyzer';
import { MetaModelService } from '../../src/services/metaModelService';
import { guardMetaCalls } from '../../server/live/budget';
import { Message } from '../../src/types/groupOs';

config({ path: ['.env.local', '.env'], quiet: true });
const key = process.env.MODEL_API_KEY!.trim();
MetaModelService.baseUrl = process.env.META_API_BASE || 'https://api.meta.ai/v1';
// Our own runs spend from the same Meta credit, so they are counted on the same spend page.
guardMetaCalls();
const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const id = arg('group')!;
const title = arg('topic')!;
const data = JSON.parse(readFileSync(`src/data/longChat/${id}.json`, 'utf8'));
const file = `src/data/longChat/${id}.state.json`;
const state = JSON.parse(readFileSync(file, 'utf8'));
const topic = state.topics.find((t: any) => t.title === title);
if (!topic) throw new Error(`No topic "${title}"`);
const all: Message[] = data.messages.map((m: any, i: number) => ({ id: `m${i + 1}`, conversationId: id, speakerId: `p_${m.speaker.toLowerCase().replace(/\W+/g, '_')}`, speakerName: m.speaker, timestamp: m.at.slice(11, 16), content: m.text, type: 'text', createdAt: new Date(m.at).getTime() }));
const ids = new Set(topic.messageIds);
const msgs = all.filter(m => ids.has(m.id));
// Read the topic's messages as a group of their own (one topic), then put the results back under the original topic.
analyzeGroup(msgs, undefined, { apiKey: key, groupId: id }).then(({ state: s, report }) => {
  const one = { ...s, decisions: s.decisions.map(d => ({ ...d, topicId: topic.id })), commitments: s.commitments.map(c => ({ ...c, topicId: topic.id })), conflicts: s.conflicts.map(c => ({ ...c, topicId: topic.id })) };
  const next = mergeTopic(state, topic.id, one);
  writeFileSync(file, JSON.stringify(next));
  console.log(`${title}: ${msgs.length} messages re-read · ${report.calls} calls · ${report.tokens.toLocaleString()} tokens · ${s.commitments.length} commitments`);
});
