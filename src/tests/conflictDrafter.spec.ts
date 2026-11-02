import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDraftPrompt, draftConflictMessage, DraftContext, findUngroundedFigures } from '../services/conflictDrafter';

const ctx: DraftContext = {
  groupTitle: 'Araku Trip',
  senderName: 'Ravi',
  conflict: {
    topic: 'Train departure',
    description: 'Anji suggests going Saturday morning because of rain; the Friday 9:40 tickets are booked',
    incumbentValue: 'Friday night 9:40 train',
    challengerValue: 'Saturday morning',
  },
  evidence: [
    { speaker: 'Anji', quote: 'Friday night plan cancel cheddam, rain forecast undi', translation: "let's cancel Friday night, rain is forecast" },
    { speaker: 'Ravi', quote: 'tickets already book ayyayi, Friday ne veldam' },
  ],
  relatedDecisions: [{ topic: 'Budget per head', currentValue: '₹4,000', status: 'confirmed' }],
};

describe('draft prompt', () => {
  const [system, user] = buildDraftPrompt(ctx);

  it('gives the model only the cited quotes, verbatim, with their meaning', () => {
    expect(user.content).toContain('"Friday night plan cancel cheddam, rain forecast undi"');
    expect(user.content).toContain("(meaning: let's cancel Friday night, rain is forecast)");
    expect(user.content).toContain('Option A (keep the plan): Friday night 9:40 train');
    expect(user.content).toContain('Option B (change it): Saturday morning');
  });

  it('forbids invention, asks for the group\'s own language, and keeps the decision with the group', () => {
    expect(system.content).toMatch(/Never invent an amount, date, time, price, name or deadline/);
    expect(system.content).toMatch(/language and style the group uses/);
    expect(system.content).toMatch(/Do not decide for the group/);
    expect(system.content).toContain('Ravi');
  });

  it('copes with a conflict that has no ready-made options', () => {
    const [, u] = buildDraftPrompt({ ...ctx, conflict: { topic: 'Visa', description: 'Priya cannot attend' }, evidence: [] });
    expect(u.content).toMatch(/no ready-made pair of options/);
    expect(u.content).toMatch(/no quotes available/);
  });
});

describe('ungrounded figure guard', () => {
  it('passes figures that came from the conflict details, in any formatting', () => {
    expect(findUngroundedFigures('The Friday 9:40 tickets are booked and the budget is ₹4000.', ctx)).toEqual([]);
    expect(findUngroundedFigures('Budget per head stays Rs 4,000', ctx)).toEqual([]);
  });

  it('flags an invented amount or time', () => {
    expect(findUngroundedFigures('Changing will cost ₹2,500 extra and we must decide by 6 PM', ctx)).toEqual(['₹2,500']);
  });

  it('ignores single digits such as list numbering and "2 options"', () => {
    expect(findUngroundedFigures('Two options: 1) keep Friday 2) go Saturday', ctx)).toEqual([]);
  });
});

describe('drafting call', () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (content: string) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }] }) });

  it('returns the draft text with any ungrounded figures flagged, and never posts anything', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('"Anji suggests Saturday because of rain. Tickets for Friday 9:40 are booked, and a change may cost ₹3,000. Which one do we go with?"'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await draftConflictMessage('k', ctx);
    expect(res.success).toBe(true);
    expect(res.data?.text.startsWith('Anji suggests')).toBe(true); // surrounding quotes stripped
    expect(res.data?.ungroundedFigures).toEqual(['₹3,000']);
    expect(fetchMock).toHaveBeenCalledTimes(1); // one model call, no side effects
  });

  it('reports a failed model call instead of inventing a draft', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => JSON.stringify({ error: { message: 'bad key' } }) }));
    const res = await draftConflictMessage('k', ctx);
    expect(res).toMatchObject({ success: false, error: 'bad key' });
  });
});
