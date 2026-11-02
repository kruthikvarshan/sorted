import { describe, expect, it } from 'vitest';
import { parseResponses, tripBrief, tripFacts } from '../services/tripPlanner';

describe('trip ideas from web search', () => {
  const json = {
    output: [
      { type: 'message', phase: 'commentary', content: [{ type: 'output_text', text: "I'll research Goa stays first.", annotations: [] }] },
      { type: 'web_search_call', action: { type: 'search', query: 'goa villas' } },
      { type: 'web_search_call', action: { type: 'open_page', url: 'https://www.goibibo.com/hotels/goa' } },
      { type: 'message', content: [{ type: 'output_text', text: 'Flights from ₹3,523 one way [Kayak](https://www.kayak.co.in/x).', annotations: [{ type: 'url_citation', url: 'https://www.kayak.co.in/x', title: 'Cheap flights Hyderabad to Goa' }] }] },
    ],
    usage: { total_tokens: 2000 },
  };

  it('shows only the answer, not the model thinking out loud', () => {
    const r = parseResponses(json);
    expect(r.text).toBe('Flights from ₹3,523 one way Kayak.');
    expect(r.text).not.toMatch(/research/);
  });

  it('lists only links the search returned or opened, and never one written into the text alone', () => {
    const r = parseResponses({ ...json, output: [...json.output, { type: 'message', content: [{ type: 'output_text', text: 'See [made up](https://fake.example/deal)', annotations: [] }] }] });
    expect(r.sources.map(s => s.url).sort()).toEqual(['https://www.goibibo.com/hotels/goa', 'https://www.kayak.co.in/x']);
    expect(r.text).toMatch(/See made up/);
  });

  it('uses the pages each search found, with titles, and puts the sources the answer names first', () => {
    const r = parseResponses({
      output: [
        { type: 'web_search_call', action: { type: 'search', query: 'anjuna', sources: [{ type: 'url', url: 'https://www.elivaas.com/a' }, { type: 'url', url: 'https://tripoto.com/b' }] }, results: [{ type: 'text_result', title: 'Anjuna guide', url: 'https://www.elivaas.com/a' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'Flea market on Wednesdays (Source: Tripoto)', annotations: [] }] },
      ],
    });
    expect(r.sources).toEqual([
      { url: 'https://tripoto.com/b', title: 'tripoto.com' },
      { url: 'https://www.elivaas.com/a', title: 'Anjuna guide' },
    ]);
  });
});

describe('the trip planner asks instead of assuming', () => {
  const topic = (id: string, title: string) => ({ id, title, kind: 'trip' as const, status: 'open' as const, messageIds: [], people: [], firstAt: 0, lastAt: 0 });
  const dec = (topicId: string, t: string, value: string, ev: string) => ({ id: `d_${t}`, conversationId: 'g', topic: t, currentValue: value, status: 'confirmed', supportingEvidenceIds: [ev], contradictingEvidenceIds: [], confidence: 1, lastUpdatedAt: '', updatedBy: '', history: [], topicId });
  const state: any = {
    topics: [topic('t1', 'Manali trip: stay'), topic('t2', 'Manali trip: dates')],
    decisions: [
      dec('t2', 'Trip start date', 'Dec 19 morning', 'e1'),
      dec('t2', 'Trip end date', 'Dec 25 evening', 'e1'),
      { ...dec('t2', 'Trip dates', 'Dec 18-23', 'e1'), status: 'conflicted' },
      dec('t1', 'Budget per person', '25,000', 'e2'),
      dec('t1', 'Outbound travel route', 'Hyderabad to Chandigarh flight then taxi', 'e3'),
    ],
    commitments: [], conflicts: [], history: [],
    evidenceMap: { e1: { messageId: 'm1', quote: 'Dec 19 to 25 final' }, e2: { messageId: 'm2', quote: '25k each max' }, e3: { messageId: 'm3', quote: 'Hyderabad se Chandigarh flight' } },
  };

  it('fills in what the chat says, across every part of the plan, with the quote, and leaves the rest empty', () => {
    const { facts, quotes } = tripFacts(state.topics[0], state);
    // A disputed "Dec 18-23" is never used; the agreed start and end are.
    expect(facts).toEqual({ to: 'Manali', dates: 'Dec 19 morning – Dec 25 evening', budget: '25,000', from: 'Hyderabad' });
    expect(quotes.dates).toBe('Dec 19 to 25 final');
    expect(facts.people).toBeUndefined();
  });

  it('builds the search brief only from confirmed facts, never a default city', () => {
    const brief = tripBrief(state.topics[0], state, { to: 'Manali', from: 'Pune', dates: 'Dec 19 to 25', budget: '₹25,000', people: '3' });
    expect(brief).toContain('Starting from: Pune');
    expect(brief).toContain('ways to get there from Pune');
    expect(brief).not.toMatch(/friends from/);
  });
});

describe('trip ideas never send the group to another splitting app', () => {
  it('drops a suggestion to use Splitwise or similar', () => {
    const r = parseResponses({ output: [{ type: 'message', content: [{ type: 'output_text', text: '1. Stay: goSTOPS Old Manali\n4. Money: Make one Splitwise group for 3 and log all cabs\n5. Book the taxi early', annotations: [] }] }] });
    expect(r.text).not.toMatch(/splitwise/i);
    expect(r.text).toContain('Book the taxi early');
  });
});

describe('trip ideas read cleanly in the chat', () => {
  it('removes bold that does not close on its line and turns OFF-CHECK into a heads-up', () => {
    const r = parseResponses({ output: [{ type: 'message', content: [{ type: 'output_text', text: '*Stay in Old Manali — heater extra:\n1. Zostel\nMoney tip:*\nOFF-CHECK: return is not booked\n*Things to do*', annotations: [] }] }] });
    expect(r.text).toContain('Stay in Old Manali');
    expect(r.text).not.toMatch(/^\*Stay|tip:\*/m);
    expect(r.text).toContain('⚠️ Heads-up: return is not booked');
    expect(r.text).toContain('*Things to do*');
  });
});

describe('Instagram spots in trip ideas', () => {
  it('keeps up to three public Instagram pages apart from the other sources', () => {
    const r = parseResponses({ output: [{ type: 'web_search_call', action: { type: 'search', sources: [
      { type: 'url', url: 'https://www.instagram.com/cafe1974manali/' },
      { type: 'url', url: 'https://www.instagram.com/oldmanalidiaries/' },
      { type: 'url', url: 'https://www.makemytrip.com/a' },
    ] } }, { type: 'message', content: [{ type: 'output_text', text: 'Seen on Instagram\nCafe 1974', annotations: [] }] }] });
    expect(r.sources.filter(s => s.url.includes('instagram.com'))).toHaveLength(2);
    expect(r.sources.some(s => s.url.includes('makemytrip'))).toBe(true);
  });
});

describe('no link the search did not return', () => {
  it('turns an Instagram address written by the model into a plain @handle and drops other made-up links', () => {
    const r = parseResponses({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Cafe 1947 https://www.instagram.com/cafe1947 and https://example.com/x', annotations: [] }] }] });
    expect(r.text).toContain('Cafe 1947 @cafe1947');
    expect(r.text).not.toMatch(/https?:/);
  });
});
