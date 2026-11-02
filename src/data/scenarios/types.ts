import { Proposal } from '../../engine/eventReducer';

export interface ScenarioMessage {
  id: string;
  speaker: string;
  time: string;
  text: string;
  type?: 'text' | 'voice_transcript' | 'system';
}

export type ItemKind = 'decision' | 'commitment' | 'conflict';

/** Something a correct reading of the chat must produce. `any`: lowercase words, at least one appears in the item. */
export interface Expectation {
  id: string;
  /** One kind, or several when the model may reasonably file the same thing under either. */
  kind: ItemKind | ItemKind[];
  any: string[];
  /** Optional: every one of these words must also appear. */
  all?: string[];
  status?: string[];
  why: string;
}

/** Something a correct reading must NOT produce (sarcasm, hypotheticals, injection, retractions...). */
export interface Forbidden {
  id: string;
  kind: ItemKind | ItemKind[];
  any: string[];
  all?: string[];
  status?: string[];
  why: string;
}

export interface Scenario {
  id: string;
  title: string;
  languages: string[];
  blurb: string;
  /** What this group is built to stress. */
  stresses: string[];
  messages: ScenarioMessage[];
  /** What a perfect model would call, with verbatim quotes. Used offline to prove the reducer handles each case. */
  oracle: Proposal[];
  expect: Expectation[];
  forbid: Forbidden[];
}

/** Build message ids like tf_01 and the helpers the fixtures use. */
export function scenarioKit(prefix: string) {
  const id = (n: number) => `${prefix}_${String(n).padStart(2, '0')}`;
  const rows = (list: [string, string, string?, ScenarioMessage['type']?][]): ScenarioMessage[] =>
    list.map(([speaker, text, time, type], i) => ({
      id: id(i + 1),
      speaker,
      text,
      time: time || `${9 + Math.floor(i / 6)}:${String((i * 7) % 60).padStart(2, '0')} AM`,
      type,
    }));
  return { id, rows };
}
