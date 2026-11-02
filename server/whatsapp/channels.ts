import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';

/**
 * Two ways WhatsApp messages reach Sorted, turned into one shape:
 *  - Meta WhatsApp Cloud API (your own test or business number), JSON webhooks.
 *  - Twilio WhatsApp Sandbox (an official Meta partner's shared number), form-encoded webhooks.
 * Everything after this file is the same for both.
 */

export type Channel = 'cloud' | 'twilio';

export interface InboundMedia {
  /** Cloud API media id, or Twilio media URL. */
  ref: string;
  contentType: string;
  filename?: string;
}

export interface Inbound {
  channel: Channel;
  /** Digits only, with country code. */
  from: string;
  profileName?: string;
  text: string;
  media: InboundMedia[];
  /** Message id from WhatsApp, to ignore repeats. */
  id: string;
  /** The business number the person wrote to; replies go out from the same one. */
  replyFrom?: string;
}

/**
 * WhatsApp settings. During development they are read from .env.local again whenever that file changes, so a new
 * access token works without restarting the server; in production (no such file) they come from the environment.
 */
let fileCache: { mtime: number; values: Record<string, string> } | undefined;
function fileEnv(): Record<string, string> {
  const file = path.resolve(process.cwd(), '.env.local');
  // Tests never read the real file, so they can never send a real message.
  if (process.env.VITEST || !existsSync(file)) return {};
  const mtime = statSync(file).mtimeMs;
  if (fileCache?.mtime !== mtime) fileCache = { mtime, values: parse(readFileSync(file)) };
  return fileCache.values;
}
export const env = (k: string) => (fileEnv()[k] ?? process.env[k] ?? '').trim();
const GRAPH = () => `https://graph.facebook.com/${env('WHATSAPP_GRAPH_VERSION') || 'v23.0'}`;

/* ---------------- Meta Cloud API ---------------- */

/** Meta checks the webhook once with GET ...?hub.mode=subscribe&hub.verify_token=...&hub.challenge=... */
export function verifyCloudWebhook(query: URLSearchParams): { ok: boolean; challenge?: string } {
  const expected = env('WHATSAPP_VERIFY_TOKEN');
  if (!expected) return { ok: false };
  const ok = query.get('hub.mode') === 'subscribe' && query.get('hub.verify_token') === expected;
  return ok ? { ok, challenge: query.get('hub.challenge') ?? '' } : { ok: false };
}

/** Every POST from Meta is signed with the app secret (X-Hub-Signature-256). Required when the secret is set. */
export function cloudSignatureOk(rawBody: Buffer, header: string | undefined): boolean {
  const secret = env('WHATSAPP_APP_SECRET');
  if (!secret) return true;
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function parseCloud(body: any): Inbound[] {
  const out: Inbound[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      const names = new Map<string, string>((value?.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]));
      for (const m of value?.messages ?? []) {
        const media: InboundMedia[] = [];
        let text = '';
        if (m.type === 'text') text = m.text?.body ?? '';
        else if (m.type === 'audio') media.push({ ref: m.audio.id, contentType: m.audio.mime_type ?? 'audio/ogg' });
        else if (m.type === 'document') {
          media.push({ ref: m.document.id, contentType: m.document.mime_type ?? '', filename: m.document.filename });
          text = m.document.caption ?? '';
        } else if (m.type === 'interactive') text = m.interactive?.list_reply?.id ?? m.interactive?.button_reply?.id ?? '';
        else if (m.type === 'button') text = m.button?.text ?? '';
        out.push({ channel: 'cloud', from: String(m.from), profileName: names.get(m.from), text, media, id: m.id });
      }
    }
  }
  return out;
}

async function sendCloud(to: string, text: string) {
  const res = await fetch(`${GRAPH()}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text, preview_url: false } }),
  });
  if (!res.ok) throw new Error(`WhatsApp Cloud API ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * A message Sorted starts (not a reply) must use a template Meta approved, unless the person wrote to the number in
 * the last 24 hours. Template values cannot hold line breaks, tabs or long runs of spaces.
 */
export async function sendCloudTemplate(to: string, name: string, values: string[], language = env('WHATSAPP_TEMPLATE_LANG') || 'en') {
  const clean = (v: string) => v.replace(/[\n\t]+/g, ' · ').replace(/ {4,}/g, ' ').trim().slice(0, 900);
  const res = await fetch(`${GRAPH()}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: { name, language: { code: language }, components: [{ type: 'body', parameters: values.map(v => ({ type: 'text', text: clean(v) })) }] },
    }),
  });
  if (!res.ok) throw new Error(`WhatsApp Cloud API ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function downloadCloud(id: string): Promise<Buffer> {
  const auth = { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}` };
  const meta = await fetch(`${GRAPH()}/${id}`, { headers: auth });
  if (!meta.ok) throw new Error(`media lookup ${meta.status}`);
  const { url } = (await meta.json()) as { url: string };
  const file = await fetch(url, { headers: auth });
  if (!file.ok) throw new Error(`media download ${file.status}`);
  return Buffer.from(await file.arrayBuffer());
}

/* ---------------- Twilio WhatsApp Sandbox ---------------- */

/**
 * Twilio signs each webhook: base64(HMAC-SHA1(auth token, the exact URL it called + every POST field name and value,
 * sorted)). The URL is the one Twilio called: PUBLIC_URL when set, or the address the request arrived on. Either way
 * only someone holding the auth token can produce a valid signature.
 */
export function twilioSignatureOk(path: string, params: URLSearchParams, header: string | undefined, host?: string): boolean {
  const token = env('TWILIO_AUTH_TOKEN');
  if (!token || !header) return false;
  const keys = Array.from(new Set(params.keys())).sort();
  const fields = keys.map(k => k + params.getAll(k).join('')).join('');
  const bases = [env('PUBLIC_URL').replace(/\/$/, ''), host ? `https://${host}` : ''].filter(Boolean);
  const given = Buffer.from(header);
  return bases.some(base => {
    const expected = Buffer.from(createHmac('sha1', token).update(base + path + fields).digest('base64'));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

export function parseTwilio(params: URLSearchParams): Inbound | null {
  const from = (params.get('From') ?? '').replace(/^whatsapp:/, '').replace(/\D/g, '');
  if (!from) return null;
  const media: InboundMedia[] = [];
  const count = Number(params.get('NumMedia') ?? 0);
  for (let i = 0; i < count; i++) {
    const ref = params.get(`MediaUrl${i}`);
    if (ref) media.push({ ref, contentType: params.get(`MediaContentType${i}`) ?? '' });
  }
  return {
    channel: 'twilio',
    from,
    profileName: params.get('ProfileName') ?? undefined,
    text: params.get('Body') ?? '',
    media,
    id: params.get('MessageSid') ?? '',
    replyFrom: params.get('To') ?? undefined,
  };
}

async function sendTwilio(to: string, text: string, from?: string) {
  const sid = env('TWILIO_ACCOUNT_SID');
  const form = new URLSearchParams({ From: from || env('TWILIO_WHATSAPP_FROM'), To: `whatsapp:+${to}`, Body: text });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64')}` },
    body: form,
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

async function downloadTwilio(url: string): Promise<Buffer> {
  const sid = env('TWILIO_ACCOUNT_SID');
  const res = await fetch(url, { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${env('TWILIO_AUTH_TOKEN')}`).toString('base64')}` } });
  if (!res.ok) throw new Error(`media download ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ---------------- shared ---------------- */

/** WhatsApp caps a message (Twilio at 1,600 characters), so long replies go out in parts, split at line breaks. */
export function splitForWhatsApp(text: string, limit = 1500): string[] {
  const parts: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if ((current + '\n' + line).length > limit && current) {
      parts.push(current);
      current = line;
    } else current = current ? `${current}\n${line}` : line;
  }
  if (current) parts.push(current);
  return parts.flatMap(p => (p.length <= limit ? [p] : p.match(new RegExp(`[\\s\\S]{1,${limit}}`, 'g')) ?? []));
}

export async function sendText(channel: Channel, to: string, text: string, from?: string) {
  for (const part of splitForWhatsApp(text)) {
    if (channel === 'cloud') await sendCloud(to, part);
    else await sendTwilio(to, part, from);
  }
}

export const downloadMedia = (channel: Channel, ref: string) => (channel === 'cloud' ? downloadCloud(ref) : downloadTwilio(ref));

export const channelReady = (channel: Channel) =>
  channel === 'cloud'
    ? !!(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID'))
    : !!(env('TWILIO_ACCOUNT_SID') && env('TWILIO_AUTH_TOKEN') && env('TWILIO_WHATSAPP_FROM'));
