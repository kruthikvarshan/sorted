import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyProposals, quoteIsVerbatim, Proposal } from '../engine/eventReducer';
import { extractWithMeta, GROUP_OS_TOOLS } from '../services/metaToolPipeline';
import { DEFAULT_SPOKEN_LANGUAGES, parseLanguages } from '../state/preferences';
import { GroupIntelligenceState, Message } from '../types/groupOs';

const msg = (id: string, speakerName: string, content: string): Message => ({
  id, conversationId: 'w', speakerId: `u_${speakerName}`, speakerName, timestamp: '9:00 AM', content, type: 'text', createdAt: 0,
});

const CHAT: Message[] = [
  msg('m1', 'Ravi', 'nenu ostunna, Friday morning ki ready ga untanu'),
  msg('m2', 'Sita', 'నేను శనివారం వస్తాను, శుక్రవారం కుదరదు'),
  msg('m3', 'Kiran', 'Hotel booking cheshanu, 24000 paid ayindi'),
];

const empty = (): GroupIntelligenceState => ({ decisions: [], commitments: [], conflicts: [], evidenceMap: {}, history: [] });
const ctx = (messages: Message[]) => ({ conversationId: 'w', messages, actor: 'model' as const, actorLabel: 'test', now: '9:00 AM' });

describe('mixed-language quotes', () => {
  it('verifies romanized Telugu verbatim', () => {
    expect(quoteIsVerbatim('nenu ostunna', CHAT[0].content)).toBe(true);
    expect(quoteIsVerbatim('Nenu OSTUNNA,', CHAT[0].content)).toBe(true);
  });

  it('verifies Telugu script verbatim and still rejects an invented quote', () => {
    expect(quoteIsVerbatim('నేను శనివారం వస్తాను', CHAT[1].content)).toBe(true);
    expect(quoteIsVerbatim('నేను ఆదివారం వస్తాను', CHAT[1].content)).toBe(false);
  });

  it('rejects a model "translation" passed off as a quote', () => {
    expect(quoteIsVerbatim("I am coming, I will be ready Friday morning", CHAT[0].content)).toBe(false);
  });

  it('keeps the original quote and stores the English meaning beside it', () => {
    const proposal: Proposal = {
      kind: 'commitment',
      ownerName: 'Ravi',
      description: 'Will come on the trip, ready Friday morning',
      status: 'accepted',
      evidence: [{ messageId: 'm1', quote: 'nenu ostunna', translation: "I'm coming" }],
    };
    const { state, results } = applyProposals(empty(), [proposal], ctx(CHAT));
    expect(results[0].accepted).toBe(true);
    const ev = Object.values(state.evidenceMap)[0];
    expect(ev.quote).toBe('nenu ostunna'); // never replaced by the translation
    expect(ev.translation).toBe("I'm coming");
  });

  it('a wrong translation cannot sneak a fake quote past the validator', () => {
    const proposal: Proposal = {
      kind: 'decision', topic: 'Budget', value: '24000', status: 'confirmed',
      evidence: [{ messageId: 'm3', quote: 'Everyone agreed to 30000', translation: 'Hotel paid 24000' }],
    };
    expect(applyProposals(empty(), [proposal], ctx(CHAT)).results[0].accepted).toBe(false);
  });
});

describe('extraction request is language-aware', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tells the model about Telugu/Hindi in English letters and asks for translations', async () => {
    let body: any;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_u: string, init: any) => {
      body = JSON.parse(init.body);
      return {
        ok: true, status: 200,
        json: async () => ({
          choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'record_commitment', arguments: JSON.stringify({
            ownerName: 'Ravi', description: 'Will come', status: 'accepted',
            evidence: [{ messageId: 'm1', quote: 'nenu ostunna', translation: "I'm coming" }],
          }) } }] }, finish_reason: 'tool_calls' }],
        }),
      };
    }));

    const result = await extractWithMeta('k', CHAT, []);
    const system = body.messages[0].content as string;
    expect(system).toMatch(/Telugu/);
    expect(system).toMatch(/nenu ostunna/);
    expect(system).toMatch(/Never translate, correct or tidy a quote/);
    expect(system).toMatch(/topic, value, description and reason in English/);
    const evidenceProps = (GROUP_OS_TOOLS[0] as any).function.parameters.properties.evidence.items.properties;
    expect(evidenceProps.translation).toBeDefined();
    expect(result.proposals).toHaveLength(1);
  });
});

describe('spoken language preference', () => {
  it('defaults to English, Telugu and Hindi, not English only', () => {
    expect(DEFAULT_SPOKEN_LANGUAGES).toEqual(['English', 'Telugu', 'Hindi']);
  });
  it('parses a typed list, trims, de-duplicates and normalises case', () => {
    expect(parseLanguages(' telugu, ENGLISH ,telugu\nhindi,, ')).toEqual(['Telugu', 'English', 'Hindi']);
    expect(parseLanguages('')).toEqual([]); // empty means auto-detect
  });
});
