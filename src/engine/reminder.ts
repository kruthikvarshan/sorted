import type { Panel } from './panel';
import type { Commitment } from '../types/groupOs';
import { formatMoney } from './ledger';
import { sameName } from './receiptVerifier';

/**
 * The WhatsApp reminder one person gets about one group: what they owe (per person, netted inside the group, with the
 * bills behind it), what they promised, and payments to them waiting for their confirmation. Written in code from what
 * Group OS already worked out, never by the model, so every amount matches the group's panel.
 */

export interface Reminder {
  /** The full message, for a plain WhatsApp text. */
  text: string;
  /** One line, for the approved template (no line breaks allowed there). */
  short: string;
  count: number;
}

const OPEN = ['proposed', 'accepted', 'in_progress'];

export function buildReminder(opts: { panel: Panel; commitments: Commitment[]; person: string; group: string; from: string; link: string }): Reminder | null {
  const { panel, commitments, person, group, from, link } = opts;
  const is = (n?: string) => !!n && sameName(n, person) === true;

  // What they owe each person, netted across this group's topics (never across groups).
  const owe = new Map<string, { to: string; amount: number; currency: string; why: string[] }>();
  for (const t of panel.topics) {
    for (const m of t.money) {
      if (!is(m.from) && !is(m.to)) continue;
      const other = is(m.from) ? m.to : m.from;
      const key = `${other.toLowerCase()}|${m.currency}`;
      const cur = owe.get(key) ?? { to: other, amount: 0, currency: m.currency, why: [] };
      cur.amount += is(m.from) ? m.amount : -m.amount;
      if (is(m.from)) cur.why.push(t.title);
      owe.set(key, cur);
    }
  }
  const debts = [...owe.values()].filter(d => d.amount >= 0.5).map(d => ({ ...d, amount: Math.round(d.amount * 100) / 100 }));

  // Only promises with a due date, and not about money (that is already in "You owe"): chatter like "I'll bring the
  // ball" is not something to send a friend a reminder about.
  const promises = commitments.filter(c => is(c.ownerName) && OPEN.includes(c.status) && !c.amount && !c.payee && !!c.dueAt && !/\b(pay|paise|bhej|send|transfer)\b/i.test(c.description)).slice(0, 4);
  const confirm = commitments.filter(c => c.status === 'needs_clarification' && is(c.payee) && c.verification?.state !== 'disputed').slice(0, 4);

  const count = debts.length + promises.length + confirm.length;
  if (!count) return null;

  const lines = [`Hi ${person} 👋 Group OS here, from "${group}". ${from} asked me to send you a reminder.`];
  if (debts.length) {
    lines.push('', '💸 You owe:');
    debts.forEach(d => lines.push(`• ${d.to} ${formatMoney(d.amount, d.currency)}${d.why.length ? ` (${[...new Set(d.why)].slice(0, 3).join(', ')})` : ''}`));
  }
  if (promises.length) {
    lines.push('', '🤝 You said you would:');
    promises.forEach(c => lines.push(`• ${c.description}${c.dueAt ? ` (by ${c.dueAt})` : ''}`));
  }
  if (confirm.length) {
    lines.push('', '✅ Waiting for you to confirm:');
    confirm.forEach(c => lines.push(`• ${c.ownerName} says they paid you${c.amount ? ` ${formatMoney(c.amount, c.currency || '₹')}` : ''}. Did you get it?`));
  }
  lines.push('', `See the messages behind each one: ${link}`);

  const parts = [
    ...debts.map(d => `you owe ${d.to} ${formatMoney(d.amount, d.currency)}`),
    ...(promises.length ? [`${promises.length} promise${promises.length === 1 ? '' : 's'} still open`] : []),
    ...(confirm.length ? [`${confirm.length} payment${confirm.length === 1 ? '' : 's'} to you waiting for your confirmation`] : []),
  ];
  return { text: lines.join('\n'), short: parts.join('; '), count };
}
