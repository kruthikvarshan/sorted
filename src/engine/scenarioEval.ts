import { GroupIntelligenceState } from '../types/groupOs';
import { Scenario } from '../data/scenarios/types';

interface Item {
  kind: 'decision' | 'commitment' | 'conflict';
  text: string;
  status: string;
}

export function itemsOf(state: GroupIntelligenceState): Item[] {
  return [
    ...state.decisions.map(d => ({ kind: 'decision' as const, text: `${d.topic} ${d.currentValue}`, status: d.status })),
    ...state.commitments.map(c => ({ kind: 'commitment' as const, text: `${c.ownerName} ${c.description}`, status: c.status })),
    ...state.conflicts.map(c => ({ kind: 'conflict' as const, text: `${c.topic} ${c.description}`, status: c.status })),
  ];
}

const matches = (item: Item, rule: { kind: string | string[]; any: string[]; all?: string[]; status?: string[] }) => {
  const text = item.text.toLowerCase();
  const kinds = Array.isArray(rule.kind) ? rule.kind : [rule.kind];
  return (
    kinds.includes(item.kind) &&
    rule.any.some(word => text.includes(word.toLowerCase())) &&
    (rule.all ?? []).every(word => text.includes(word.toLowerCase())) &&
    (!rule.status || rule.status.includes(item.status))
  );
};

export interface ScenarioScore {
  matched: string[];
  missed: { id: string; why: string }[];
  violations: { id: string; why: string; item: string }[];
  recall: number;
}

/** Score a final state against a scenario's expectations and traps. */
export function scoreScenario(scenario: Scenario, state: GroupIntelligenceState): ScenarioScore {
  const items = itemsOf(state);
  const matched: string[] = [];
  const missed: ScenarioScore['missed'] = [];
  for (const e of scenario.expect) {
    if (items.some(i => matches(i, e))) matched.push(e.id);
    else missed.push({ id: e.id, why: e.why });
  }
  const violations: ScenarioScore['violations'] = [];
  for (const f of scenario.forbid) {
    items.filter(i => matches(i, f)).forEach(i => violations.push({ id: f.id, why: f.why, item: `${i.kind}: ${i.text} [${i.status}]` }));
  }
  return { matched, missed, violations, recall: scenario.expect.length ? matched.length / scenario.expect.length : 1 };
}
