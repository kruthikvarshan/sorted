import { GroupIntelligenceState, Message } from '../types/groupOs';
import { formatMoney } from './ledger';
import type { Panel } from './panel';

/**
 * "Group Wrapped": a recap of the group, every number counted in code from the chat and its results. Muse Image only
 * paints the background; it never writes the numbers.
 */

export interface Wrapped {
  title: string;
  span: string;
  messages: number;
  people: number;
  topics: { title: string; count: number }[];
  decided: number;
  disagreements: number;
  settled: number;
  spend: string;
  chattiest?: { name: string; count: number };
  nightOwl?: { name: string; count: number };
  bankOf?: { name: string; amount: string };
  savedBySayingNo?: string;
  artPrompt: string;
}

const month = (ms: number) => new Date(ms).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });

export function computeWrapped(title: string, messages: Message[], state: GroupIntelligenceState, panel: Panel): Wrapped {
  const people = messages.filter(m => m.speakerId !== 'groupos');
  const count = (pred: (m: Message) => boolean) => {
    const by = new Map<string, number>();
    people.filter(pred).forEach(m => by.set(m.speakerName, (by.get(m.speakerName) ?? 0) + 1));
    const top = [...by.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? { name: top[0], count: top[1] } : undefined;
  };
  const night = (m: Message) => {
    const h = new Date(m.createdAt).getHours();
    return h >= 23 || h < 4;
  };

  // Who fronted the most money for the group: the person most owed across bills.
  const owed = new Map<string, { amount: number; currency: string }>();
  panel.owes.forEach(o => {
    const cur = owed.get(o.to) ?? { amount: 0, currency: o.currency };
    cur.amount += o.amount;
    owed.set(o.to, cur);
  });
  const bank = [...owed.entries()].sort((a, b) => b[1].amount - a[1].amount)[0];

  // Money not spent because the group said no (costs still waiting, never agreed).
  const saved = panel.topics.flatMap(t => t.waiting).filter(w => w.eachAmount).sort((a, b) => (b.eachAmount ?? 0) - (a.eachAmount ?? 0))[0];

  const topics = panel.topics
    .filter(t => t.messageCount > 0)
    .sort((a, b) => b.messageCount - a.messageCount)
    .slice(0, 3)
    .map(t => ({ title: t.title, count: t.messageCount }));
  const kinds = new Set(panel.topics.map(t => t.kind));
  const scene = kinds.has('trip')
    ? 'a group of young Indian friends laughing on a beach at sunset, scooters and a small villa in the background'
    : kinds.has('bills')
    ? 'young Indian flatmates on a cosy balcony in Hyderabad at night, fairy lights, chai'
    : 'a group of young Indian friends celebrating together, warm evening light';

  const first = people[0]?.createdAt;
  const last = people[people.length - 1]?.createdAt;
  return {
    title,
    span: first && last ? (month(first) === month(last) ? month(first) : `${month(first)} – ${month(last)}`) : '',
    messages: people.length,
    people: new Set(people.map(m => m.speakerName)).size,
    topics,
    decided: state.decisions.filter(d => d.status === 'confirmed').length,
    disagreements: state.conflicts.length,
    settled: state.conflicts.filter(c => c.status !== 'open').length,
    spend: panel.spend,
    chattiest: count(() => true),
    nightOwl: count(night),
    bankOf: bank ? { name: bank[0], amount: formatMoney(bank[1].amount, bank[1].currency) } : undefined,
    savedBySayingNo: saved ? `${formatMoney(saved.eachAmount!, saved.currency ?? '₹')} each not spent on ${saved.topic}` : undefined,
    artPrompt: `A joyful, colourful flat illustration of ${scene}. No text, no letters, no words, no logos.`,
  };
}
