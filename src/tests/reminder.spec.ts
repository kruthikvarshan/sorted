import { describe, expect, it } from 'vitest';
import { buildReminder } from '../engine/reminder';
import type { Panel } from '../engine/panel';

const panel = (money: Panel['topics'][number]['money'][], titles: string[]) =>
  ({ topics: money.map((m, i) => ({ id: `t${i}`, title: titles[i], money: m })) }) as unknown as Panel;

const base = { group: 'Flat 7B', from: 'Kruthik', link: 'https://x/live/abc' };

describe('WhatsApp reminder', () => {
  it('lists what the person owes, netted per person inside the group, with the topics behind it', () => {
    const r = buildReminder({
      ...base,
      person: 'Aniket',
      commitments: [],
      panel: panel(
        [
          [{ from: 'Aniket', to: 'Kruthik', amount: 6000, currency: '₹', reasons: [], pending: false }],
          [{ from: 'Kruthik', to: 'Aniket', amount: 1000, currency: '₹', reasons: [], pending: false }, { from: 'Aniket', to: 'Swapnil', amount: 1000, currency: '₹', reasons: [], pending: false }],
        ],
        ['New AC for the hall', 'Diwali deep cleaning'],
      ),
    })!;
    expect(r.text).toContain('Hi Aniket');
    expect(r.text).toMatch(/Kruthik ₹5,000 \(New AC for the hall\)/);
    expect(r.text).toMatch(/Swapnil ₹1,000 \(Diwali deep cleaning\)/);
    expect(r.text).toContain('https://x/live/abc');
    expect(r.short).toBe('you owe Kruthik ₹5,000; you owe Swapnil ₹1,000');
    expect(r.short).not.toContain('\n');
  });

  it('includes open promises and payments waiting for their confirmation; nothing open means no reminder', () => {
    const commitments = [
      { id: 'c1', ownerName: 'Aniket', description: 'book the Manali cottage', status: 'accepted', dueAt: 'Nov 20', evidenceIds: [] },
      { id: 'c2', ownerName: 'Swapnil', payee: 'Aniket', amount: 10000, currency: '₹', description: 'paid back', status: 'needs_clarification', evidenceIds: [] },
    ] as any;
    const r = buildReminder({ ...base, person: 'Aniket', commitments, panel: panel([], []) })!;
    expect(r.text).toContain('book the Manali cottage (by Nov 20)');
    // Chatter without a due date is not sent.
    const chatter = buildReminder({ ...base, person: 'Aniket', commitments: [{ id: 'x', ownerName: 'Aniket', description: 'bring the ball', status: 'accepted', evidenceIds: [] }] as any, panel: panel([], []) });
    expect(chatter).toBeNull();
    expect(r.text).toContain('Swapnil says they paid you ₹10,000');
    expect(r.count).toBe(2);
    expect(buildReminder({ ...base, person: 'Kruthik', commitments: [], panel: panel([], []) })).toBeNull();
  });
});
