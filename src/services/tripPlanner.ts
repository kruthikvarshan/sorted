import { GroupIntelligenceState, Topic } from '../types/groupOs';
import { MetaModelService } from './metaModelService';

/**
 * Trip ideas for a trip the group is planning, from Muse Spark with Meta's built-in web search. It is given what the
 * group already decided (dates, place, budget, how many people) and suggests stays, travel and things to do. Only links
 * that the search itself returned are shown (the pages each search found, citations, opened pages), so no link is made
 * up; the ones the answer names come first. Prices are what the sources say, labelled as typical, not live: nothing is
 * booked and no account is used.
 */

export interface TripIdeas {
  text: string;
  sources: { title: string; url: string }[];
  tokens?: number;
}

/** What the planner must know before it searches. Anything the chat does not say, it asks for; it never assumes. */
export interface TripFacts {
  to?: string;
  from?: string;
  dates?: string;
  budget?: string;
  people?: string;
}
export type TripFactKey = keyof TripFacts;
export const TRIP_FACTS: { key: TripFactKey; label: string }[] = [
  { key: 'to', label: 'Where to' },
  { key: 'from', label: 'Starting from' },
  { key: 'dates', label: 'Dates' },
  { key: 'budget', label: 'Budget per person' },
  { key: 'people', label: 'How many people' },
];

/** The trip's decisions (every part of the same plan: "Manali trip: stay", "Manali trip: travel", …). */
function planDecisions(topic: Topic, state: GroupIntelligenceState) {
  const plan = topic.title.split(':')[0].trim().toLowerCase();
  const inPlan = new Set((state.topics ?? []).filter(t => t.id === topic.id || t.title.split(':')[0].trim().toLowerCase() === plan).map(t => t.id));
  return state.decisions.filter(d => d.topicId && inPlan.has(d.topicId) && d.status !== 'rejected');
}

/**
 * What the chat already says about the trip, found in code from its decisions, each with the quote it came from.
 * A fact the chat does not state is left out, so the person is asked for it.
 */
export function tripFacts(topic: Topic, state: GroupIntelligenceState): { facts: TripFacts; quotes: Partial<Record<TripFactKey, string>> } {
  const facts: TripFacts = {};
  const quotes: Partial<Record<TripFactKey, string>> = {};
  // Only what the group agreed or proposed: a disputed or postponed value is not a fact.
  const decisions = planDecisions(topic, state)
    .filter(d => d.status === 'confirmed' || d.status === 'proposed')
    .sort((a, b) => (a.status === 'confirmed' ? -1 : 1) - (b.status === 'confirmed' ? -1 : 1));
  const quoteOf = (ids: string[]) => state.evidenceMap[ids[0]]?.quote;
  const take = (key: TripFactKey, re: RegExp) => {
    const d = decisions.find(x => re.test(x.topic));
    if (d && !facts[key]) {
      facts[key] = String(d.currentValue).slice(0, 80);
      quotes[key] = quoteOf(d.supportingEvidenceIds);
    }
  };
  // Dates: an agreed start and end together ("Dec 19 morning – Dec 25 evening"), else the trip's dates.
  const start = decisions.find(d => /\b(start|departure|leaving|outbound) (date|day|time)\b|\bstart date\b/i.test(d.topic));
  const end = decisions.find(d => /\b(end|return|coming back) (date|day|time)\b|\bend date\b/i.test(d.topic));
  if (start && end) {
    facts.dates = `${start.currentValue} – ${end.currentValue}`.slice(0, 80);
    quotes.dates = quoteOf(start.supportingEvidenceIds);
  }
  take('dates', /\b(trip dates|travel dates|dates)\b/i);
  take('budget', /\bbudget\b/i);
  take('from', /\b(start(ing)? (point|city)|departure city|leaving from|origin|from city)\b/i);
  // A decided route names the starting city: "Hyderabad to Chandigarh flight then taxi".
  if (!facts.from) {
    const route = decisions.find(d => /\broute\b|\bhow to (go|reach)\b|\btravel plan\b/i.test(d.topic) && /^\s*[A-Z][\p{L}]+(\s[A-Z][\p{L}]+)?\s+to\s+/u.test(String(d.currentValue)));
    if (route) {
      facts.from = String(route.currentValue).match(/^\s*([A-Z][\p{L}]+(?:\s[A-Z][\p{L}]+)?)\s+to\s+/u)![1];
      quotes.from = quoteOf(route.supportingEvidenceIds);
    }
  }
  take('to', /\b(destination|where to|place to go)\b/i);
  take('people', /\b(people|headcount|how many|group size)\b/i);
  // The trip's name usually is the place ("Manali trip, Dec" → Manali).
  if (!facts.to) {
    const place = topic.title.split(':')[0].replace(/\b(trip|travel|plan|tour|outing|vacation|holiday)\b/gi, '').replace(/,.*$/, '').replace(/[^\p{L}\s'-]/gu, '').trim();
    if (place && !/^(reunion|weekend|home|office|team|family|group)$/i.test(place)) facts.to = place;
  }
  return { facts, quotes };
}

/** The brief for Meta's web search: only what the group decided or the person confirmed. */
export function tripBrief(topic: Topic, state: GroupIntelligenceState, facts: Required<TripFacts>): string {
  const decided = planDecisions(topic, state);
  // Each decision with the part of the trip it belongs to, so "5:30 cab" reads as the cab to the airport, not a
  // cab after landing.
  const titles = new Map((state.topics ?? []).map(t => [t.id, t.title]));
  const notes = decided.map(d => `- [${titles.get(d.topicId ?? '') ?? 'trip'}] ${d.topic}: ${d.currentValue} (${d.status})`).join('\n') || '- nothing else decided yet';
  return `A group of ${facts.people} people is planning a trip.
Where to: ${facts.to}
Starting from: ${facts.from}
Dates: ${facts.dates}
Budget per person: ${facts.budget}
Other things they have discussed:
${notes}

Using web search, suggest for this exact trip (respect their dates, place, budget and group size; say so if something they decided looks off):
1. Three places to stay that fit a group this size, with typical price per night.
2. Two or three ways to get there from ${facts.from}, with typical fares and travel time.
3. Four things to do there on those dates, with typical cost per person.
4. Two or three spots there that people post about on Instagram (cafés, viewpoints, food), each with its public instagram.com page from the search.
5. One money tip for this trip: where the costs add up, or how to save on them. This group already tracks and splits its costs in Group OS, so do not recommend any app or service for splitting or tracking expenses.
Be brief: one line per item. Mention the source for each item. Do not invent links; prices are typical, not live.
Format: plain text, a short heading on its own line before each section (Stay, Getting there, Things to do, Seen on Instagram, Money tip), no asterisks or markdown. Start anything that looks off in their plan with "⚠️ Heads-up:" and only say it is off when the decisions above clearly show it.`;
}

/** Expense-splitting apps: Group OS is that, for this group, so trip ideas never point elsewhere. */
const SPLIT_APPS = /\b(splitwise|tricount|settle ?up|splid|walnut|spliit|kittysplit|billr|evenly)\b/i;

export function parseResponses(json: any): TripIdeas {
  const parts: string[] = [];
  const sources = new Map<string, string>();
  const host = (u: string) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return u;
    }
  };
  const add = (url: unknown, title?: unknown) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return;
    const t = typeof title === 'string' && title.trim() ? title.trim() : undefined;
    if (!sources.has(url) || (t && sources.get(url) === host(url))) sources.set(url, t ?? host(url));
  };
  for (const out of json?.output ?? []) {
    if (out?.type === 'web_search_call') {
      // Pages each search found (asked for with "include"), and pages it opened.
      for (const r of out.results ?? []) add(r?.url, r?.title);
      for (const r of out.action?.sources ?? []) add(r?.url);
      if (out.action?.type === 'open_page') add(out.action.url);
    }
    if (out?.type !== 'message') continue;
    for (const c of out?.content ?? []) {
      // "Commentary" messages are the model thinking out loud ("I'll research…"); only the answer is shown.
      if (typeof c?.text === 'string' && out.phase !== 'commentary') parts.push(c.text);
      for (const a of c?.annotations ?? []) if (a?.type === 'url_citation') add(a.url, a.title);
    }
  }
  if (!parts.length && typeof json?.output_text === 'string') parts.push(json.output_text);
  // Links written into the text are reduced to their label; the sources list holds the real ones. A line that sends
  // the group to another expense-splitting app is dropped: the group already splits its costs in Group OS.
  const text = parts
    .join('\n')
    .split('\n')
    .filter(line => !SPLIT_APPS.test(line))
    // Bold that does not close on the same line ("*Stay in Old Manali" … "Money tip:*") would show as stray stars.
    .map(line => ((line.match(/\*/g) ?? []).length % 2 ? line.replace(/\*/g, '') : line))
    .map(line => line.replace(/\bOFF-?CHECK\b:?/gi, '⚠️ Heads-up:'))
    .map(line => line.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_, label) => label))
    // A web address the search did not return is not shown as a link: an Instagram one becomes its @handle, any
    // other is left out (the sources list holds every real link).
    .map(line =>
      line.replace(/https?:\/\/[^\s)]+/g, u => {
        const clean = u.replace(/[.,;]+$/, '');
        if (sources.has(clean)) return clean;
        const insta = clean.match(/instagram\.com\/([A-Za-z0-9_.]+)/);
        return insta ? `@${insta[1]}` : '';
      })
    )
    .join('\n')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_, label) => label)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  // Sources the answer names ("Source: Tripoto") come first.
  const said = text.toLowerCase();
  const cited = (url: string) => (said.includes(host(url).split('.')[0]) ? 0 : 1);
  const list = [...sources.entries()].map(([url, title]) => ({ url, title: title.slice(0, 90) })).sort((a, b) => cited(a.url) - cited(b.url));
  // At most two pages per website, so one booking site does not fill the list; Instagram spots (up to three) are kept
  // apart and shown on their own.
  const per = new Map<string, number>();
  const insta = list.filter(x => /(^|\.)instagram\.com$/.test(host(x.url))).slice(0, 3);
  const varied = list.filter(x => {
    if (insta.includes(x)) return false;
    const n = (per.get(host(x.url)) ?? 0) + 1;
    per.set(host(x.url), n);
    return n <= 2;
  });
  return { text, sources: [...varied.slice(0, 10), ...insta], tokens: json?.usage?.total_tokens };
}

export async function planTrip(apiKey: string, brief: string, model: string = MetaModelService.DEFAULT_MODEL): Promise<TripIdeas> {
  const res = await fetch(`${MetaModelService.baseUrl}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: brief, tools: [{ type: 'web_search' }], include: ['web_search_call.action.sources', 'web_search_call.results'] }),
    // A search that hangs must not leave "Looking up ideas…" on screen forever.
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Meta web search error (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return parseResponses(await res.json());
}
