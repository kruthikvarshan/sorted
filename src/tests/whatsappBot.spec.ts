import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCENARIOS, toWhatsAppExport } from '../data/scenarios';
import type { Proposal } from '../engine/eventReducer';

// WhatsApp and Meta are replaced with fakes: these tests check what Group OS does with a message, not the network.
const sent: { to: string; text: string }[] = [];
vi.mock('../../server/whatsapp/channels', async importOriginal => ({
  ...(await importOriginal<typeof import('../../server/whatsapp/channels')>()),
  sendText: vi.fn(async (_c: string, to: string, text: string) => void sent.push({ to, text })),
  downloadMedia: vi.fn(async () => Buffer.from('')),
}));

const flat = SCENARIOS.find(s => s.id === 'hinglish_flat')!;
// The scenario's perfect answer, with its message ids renamed to the ids an imported export gets.
const spoken = flat.messages.filter(m => m.type !== 'system');
const importedId = (id: string) => `m_imp_${spoken.findIndex(m => m.id === id) + 1}`;
const oracle: Proposal[] = flat.oracle.map(p => ({ ...p, evidence: p.evidence.map(e => ({ ...e, messageId: importedId(e.messageId) })) }) as Proposal);

// Topic tagging puts the whole sample chat into one topic (the topic logic has its own tests).
vi.mock('../services/topicTagger', () => ({
  tagBatch: vi.fn(async (_k: string, topics: { id: string }[], _b: unknown, batch: { id: string }[]) => ({
    newTopics: topics.length ? [] : [{ key: 'n1', title: 'Rent', kind: 'bills' }],
    assign: Object.fromEntries(batch.map(m => [m.id, topics[0]?.id ?? 'n1'])),
  })),
}));
vi.mock('../services/metaToolPipeline', () => ({
  extractWithMeta: vi.fn(async () => ({ proposals: oracle, rejected: [], rounds: 1, mode: 'tools', model: 'muse-spark-1.3', tokens: { prompt: 100, completion: 50 } })),
}));
const ask = vi.fn(async () => ({ success: true, data: 'You owe 9,000 for rent.', modelUsed: 'muse-spark-1.3', timestamp: '' }));
vi.mock('../services/metaModelService', () => ({ MetaModelService: { baseUrl: '', askPrivateAssistantWithMeta: (...a: unknown[]) => ask(...(a as [])), transcribeAudioWithMeta: vi.fn() } }));

const { resetStore, listGroups, getPerson, listTraces } = await import('../../server/whatsapp/store');
const { handleInbound } = await import('../../server/whatsapp/bot');
const { parseCloud, parseTwilio, twilioSignatureOk, splitForWhatsApp, verifyCloudWebhook, cloudSignatureOk } = await import('../../server/whatsapp/channels');

const PHONE = '919800000001';
let n = 0;
const say = (text: string) => handleInbound({ channel: 'twilio', from: PHONE, text, media: [], id: `m${n++}` });
const last = () => sent[sent.length - 1]?.text ?? '';

beforeEach(() => {
  resetStore(':memory:');
  sent.length = 0;
  process.env.MODEL_API_KEY = 'test-key';
});

describe('Group OS over WhatsApp', () => {
  it('greets a new person and explains how to bring in a group, without posting anywhere else', async () => {
    await say('hi');
    expect(last()).toMatch(/Export chat/);
    expect(sent.every(s => s.to === PHONE)).toBe(true);
  });

  it('reads a pasted group chat with Meta AI and reports decisions and who owes whom, then asks who you are', async () => {
    await say('hi');
    await say(toWhatsAppExport(flat));
    const all = sent.map(s => s.text).join('\n---\n');
    expect(all).toMatch(/Reading it with Meta AI/);
    expect(all).toMatch(/Decided/);
    expect(all).toMatch(/9,?000/);
    expect(last()).toMatch(/Which one is you/);
    expect(listGroups(PHONE)).toHaveLength(1);
  });

  it('after you say who you are, money is worked out for you, in code', async () => {
    await say('hi');
    await say(toWhatsAppExport(flat));
    const names = listGroups(PHONE)[0].workspace.participants.map(p => p.name);
    await say(String(names.indexOf('Neha') + 1));
    expect(last()).toMatch(/you are \*Neha\*/);
    await say('money');
    expect(last()).toMatch(/You owe:/);
    expect(last()).toMatch(/Each group is counted on its own/);
  });

  it('answers a free question with Meta AI, sending only results, never the chat text', async () => {
    await say('hi');
    await say(toWhatsAppExport(flat));
    await say('1');
    await say('how much do I owe overall?');
    expect(last()).toBe('You owe 9,000 for rent.');
    const context = JSON.stringify(ask.mock.calls.at(-1));
    expect(context).not.toMatch(/bhej deti hoon/); // a raw chat line
  });

  it('lets you choose which groups it reads, forget one, and delete everything', async () => {
    await say('hi');
    await say(toWhatsAppExport(flat));
    await say('1');
    await say('groups');
    expect(last()).toMatch(/1\. ✅/);
    await say('use 1');
    expect(getPerson(PHONE)?.scope).toHaveLength(1);
    await say('forget 1');
    expect(listGroups(PHONE)).toHaveLength(0);
    await say('delete my data');
    expect(getPerson(PHONE)).toBeUndefined();
  });

  it('ignores the same WhatsApp message delivered twice', async () => {
    await handleInbound({ channel: 'twilio', from: PHONE, text: 'hi', media: [], id: 'dup' });
    await handleInbound({ channel: 'twilio', from: PHONE, text: 'hi', media: [], id: 'dup' });
    expect(sent).toHaveLength(1);
  });

  it('never shows full phone numbers on the trace page', async () => {
    await say('hi');
    expect(listTraces().every(t => !t.who.includes('919800') && !t.summary.includes('919800000001'))).toBe(true);
  });
});

describe('the two ways messages arrive', () => {
  it('reads a Meta Cloud API webhook (text, voice note, document)', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: {
        contacts: [{ wa_id: PHONE, profile: { name: 'Neha' } }],
        messages: [
          { from: PHONE, id: 'a', type: 'text', text: { body: 'money' } },
          { from: PHONE, id: 'b', type: 'audio', audio: { id: 'media1', mime_type: 'audio/ogg; codecs=opus' } },
          { from: PHONE, id: 'c', type: 'document', document: { id: 'media2', filename: 'WhatsApp Chat with Flat 7B.zip', mime_type: 'application/zip' } },
        ],
      } }] }],
    };
    const out = parseCloud(body);
    expect(out.map(m => [m.text, m.media[0]?.ref])).toEqual([['money', undefined], ['', 'media1'], ['', 'media2']]);
    expect(out[0].profileName).toBe('Neha');
  });

  it('a delivery-status webhook (like a failed send) carries no messages', () => {
    expect(parseCloud({ entry: [{ changes: [{ value: { statuses: [{ status: 'failed' }] } }] }] })).toEqual([]);
  });

  it('checks Meta\'s webhook verification and signature', () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'groupos-verify';
    expect(verifyCloudWebhook(new URLSearchParams('hub.mode=subscribe&hub.verify_token=groupos-verify&hub.challenge=42'))).toEqual({ ok: true, challenge: '42' });
    expect(verifyCloudWebhook(new URLSearchParams('hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42')).ok).toBe(false);
    process.env.WHATSAPP_APP_SECRET = 's3cret';
    const raw = Buffer.from('{"a":1}');
    const sig = `sha256=${createHmac('sha256', 's3cret').update(raw).digest('hex')}`;
    expect(cloudSignatureOk(raw, sig)).toBe(true);
    expect(cloudSignatureOk(raw, 'sha256=00')).toBe(false);
    delete process.env.WHATSAPP_APP_SECRET;
  });

  it('reads a Twilio webhook and checks its signature against the public URL', () => {
    process.env.PUBLIC_URL = 'https://example.test';
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    const params = new URLSearchParams({ From: `whatsapp:+${PHONE}`, Body: 'hi', NumMedia: '0', MessageSid: 'SM1' });
    const data = 'https://example.test/whatsapp/twilio' + [...params.keys()].sort().map(k => k + params.get(k)).join('');
    const sig = createHmac('sha1', 'tok').update(data).digest('base64');
    expect(twilioSignatureOk('/whatsapp/twilio', params, sig)).toBe(true);
    expect(twilioSignatureOk('/whatsapp/twilio', params, 'forged')).toBe(false);
    expect(parseTwilio(params)).toMatchObject({ from: PHONE, text: 'hi', channel: 'twilio' });
  });

  it('splits long replies at line breaks to fit WhatsApp', () => {
    const long = Array.from({ length: 100 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n');
    const parts = splitForWhatsApp(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every(p => p.length <= 1500)).toBe(true);
    expect(parts.join('\n')).toBe(long);
  });
});
