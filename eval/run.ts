/**
 * Live evaluation: run every scenario through Meta's models and score the result against the known answers.
 *
 *   npm run eval                      all scenarios, one run each
 *   npm run eval -- --runs=3          repeat to measure run-to-run stability
 *   npm run eval -- adversarial       only the named scenario(s)
 *   npm run eval -- --oracle          no network: score each scenario's perfect answer (checks this harness)
 *
 * Needs MODEL_API_KEY in .env.local (never printed). Writes eval/last-run.json.
 */
import { config } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { SCENARIOS, Scenario } from '../src/data/scenarios';
import { applyProposals, Proposal } from '../src/engine/eventReducer';
import { itemsOf, scoreScenario } from '../src/engine/scenarioEval';
import { MetaModelService } from '../src/services/metaModelService';
import { extractWithMeta, TUNING } from '../src/services/metaToolPipeline';
import { GroupIntelligenceState, Message } from '../src/types/groupOs';

config({ path: ['.env.local', '.env'], quiet: true });

const args = process.argv.slice(2);
const oracleMode = args.includes('--oracle');
const verbose = args.includes('--verbose');
const runs = Number(args.find(a => a.startsWith('--runs='))?.split('=')[1]) || 1;
const only = args.filter(a => !a.startsWith('--'));
const model = process.env.EVAL_MODEL || MetaModelService.DEFAULT_MODEL;
const key = process.env.MODEL_API_KEY?.trim();

if (!oracleMode && !key) {
  console.error('MODEL_API_KEY is not set. Put it in .env.local (gitignored), or run with --oracle to test the harness offline.');
  process.exit(1);
}
MetaModelService.baseUrl = process.env.META_API_BASE || 'https://api.meta.ai/v1';
if (process.env.EVAL_EFFORT) TUNING.base.effort = process.env.EVAL_EFFORT as typeof TUNING.base.effort;

const toMessages = (s: Scenario): Message[] =>
  s.messages.map((m, i) => ({
    id: m.id, conversationId: s.id, speakerId: `u_${m.speaker.toLowerCase()}`, speakerName: m.speaker, timestamp: m.time,
    content: m.text, type: m.type === 'voice_transcript' ? 'voice_transcript' : m.type === 'system' ? 'system' : 'text', createdAt: i,
  }));

const empty = (): GroupIntelligenceState => ({ decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [] });
const pct = (x: number) => `${Math.round(x * 100)}%`;
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));

interface RunResult {
  scenario: string;
  recall: number;
  matched: number;
  expected: number;
  violations: { id: string; item: string }[];
  missed: string[];
  fabricationsCaught: number;
  proposals: number;
  rounds: number;
  mode: string;
  tokens: number;
  seconds: number;
  /** What the model actually produced, so a miss can be judged as a model error or a bad expectation. */
  items?: string[];
  /** The verified proposals the model made, kept only for --record. Never written to last-run.json. */
  proposalList?: Proposal[];
  error?: string;
}

async function evaluate(s: Scenario): Promise<RunResult> {
  const messages = toMessages(s);
  const started = Date.now();
  const base = { scenario: s.id, expected: s.expect.length };
  try {
    let proposals: Proposal[];
    let rejected = 0;
    let rounds = 0;
    let mode = 'oracle';
    let tokens = 0;
    if (oracleMode) {
      proposals = s.oracle;
    } else {
      const res = await extractWithMeta(key!, messages, [], { model });
      proposals = res.proposals;
      rejected = res.rejected.length;
      rounds = res.rounds;
      mode = res.mode;
      tokens = res.tokens.prompt + res.tokens.completion;
    }
    const { state, results } = applyProposals(empty(), proposals, { conversationId: s.id, messages, actor: 'model', actorLabel: oracleMode ? 'oracle' : `Meta ${model}`, now: '9:00 AM' });
    const score = scoreScenario(s, state);
    return {
      ...base,
      recall: score.recall,
      matched: score.matched.length,
      violations: score.violations.map(v => ({ id: v.id, item: v.item })),
      missed: score.missed.map(m => m.id),
      fabricationsCaught: rejected + results.filter(r => !r.accepted).length,
      proposals: proposals.length,
      rounds, mode, tokens,
      seconds: (Date.now() - started) / 1000,
      items: itemsOf(state).map(i => `${i.kind} [${i.status}] ${i.text}`),
      proposalList: proposals,
    };
  } catch (err: any) {
    return { ...base, recall: 0, matched: 0, violations: [], missed: s.expect.map(e => e.id), fabricationsCaught: 0, proposals: 0, rounds: 0, mode: 'error', tokens: 0, seconds: (Date.now() - started) / 1000, error: err.message };
  }
}

async function main() {
  const chosen = SCENARIOS.filter(s => only.length === 0 || only.includes(s.id));
  if (chosen.length === 0) {
    console.error(`No scenario matches. Available: ${SCENARIOS.map(s => s.id).join(', ')}`);
    process.exit(1);
  }
  console.log(`\nSorted evaluation | ${oracleMode ? 'ORACLE (offline, checks the harness)' : `model ${model}`} | ${chosen.length} scenario(s) x ${runs} run(s)\n`);
  console.log(`${pad('scenario', 22)}${pad('recall', 9)}${pad('traps hit', 11)}${pad('rejected', 10)}${pad('rounds', 8)}${pad('tokens', 9)}secs`);

  const all: RunResult[] = [];
  for (const s of chosen) {
    const mine: RunResult[] = [];
    for (let i = 0; i < runs; i++) {
      const r = await evaluate(s);
      mine.push(r);
      all.push(r);
      console.log(
        `${pad(i === 0 ? s.id : '', 22)}${pad(r.error ? 'ERROR' : pct(r.recall), 9)}${pad(String(r.violations.length), 11)}${pad(String(r.fabricationsCaught), 10)}${pad(String(r.rounds), 8)}${pad(String(r.tokens), 9)}${r.seconds.toFixed(1)}`
      );
      if (r.error) console.log(`   error: ${r.error}`);
      r.missed.forEach(id => console.log(`   missed: ${id}`));
      r.violations.forEach(v => console.log(`   TRAP ${v.id}: ${v.item}`));
      if (verbose) (r.items || []).forEach(i => console.log(`      > ${i}`));
    }
    if (runs > 1) {
      const recalls = mine.map(r => r.recall);
      console.log(`${pad('', 22)}stability: recall ${pct(Math.min(...recalls))} to ${pct(Math.max(...recalls))} across ${runs} runs`);
    }
  }

  const ok = all.filter(r => !r.error);
  const matched = ok.reduce((a, r) => a + r.matched, 0);
  const expected = ok.reduce((a, r) => a + r.expected, 0);
  const traps = ok.reduce((a, r) => a + r.violations.length, 0);
  const caught = ok.reduce((a, r) => a + r.fabricationsCaught, 0);
  console.log(`\nOVERALL  expected items found: ${matched}/${expected} (${pct(expected ? matched / expected : 1)})  | traps triggered: ${traps}  | model outputs rejected by the validator: ${caught}  | errors: ${all.length - ok.length}\n`);

  writeFileSync(
    'eval/last-run.json',
    JSON.stringify({ at: new Date().toISOString(), mode: oracleMode ? 'oracle' : model, runs, results: all.map(({ proposalList: _p, ...rest }) => rest) }, null, 2)
  );

  if (!oracleMode && (all.length - ok.length > 0)) process.exitCode = 2;
}

main();
