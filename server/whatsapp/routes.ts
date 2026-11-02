import { channelReady, cloudSignatureOk, parseCloud, parseTwilio, twilioSignatureOk, verifyCloudWebhook } from './channels';
import { handleInbound, useMetaDirectly } from './bot';
import { addTrace, listTraces } from './store';

/**
 * The WhatsApp endpoints, independent of the web framework so the dev server (Vite) and the production server
 * (Express) share them:
 *   GET  /whatsapp/cloud    Meta's one-time webhook check
 *   POST /whatsapp/cloud    messages from the Meta WhatsApp Cloud API
 *   POST /whatsapp/twilio   messages from the Twilio WhatsApp Sandbox
 *   GET  /whatsapp/trace    what came in, what Meta AI did, what went out (for judges; numbers are masked)
 * Webhooks answer at once and do the work afterwards, because reading a chat takes longer than they wait.
 */

export interface HttpIn {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}
export interface HttpOut {
  status: number;
  type: string;
  body: string;
}

const header = (h: HttpIn['headers'], k: string) => {
  const v = h[k.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};
const text = (status: number, body: string, type = 'text/plain'): HttpOut => ({ status, type, body });

let started = false;
function start() {
  if (started) return;
  started = true;
  useMetaDirectly();
}

function background(work: Promise<unknown>) {
  work.catch(err => console.error('[whatsapp]', err?.message ?? err));
}

export async function handleWhatsAppHttp(req: HttpIn): Promise<HttpOut | null> {
  if (!req.path.startsWith('/whatsapp')) return null;
  start();
  const route = req.path.replace(/\/$/, '');

  if (route === '/whatsapp/cloud' && req.method === 'GET') {
    const check = verifyCloudWebhook(req.query);
    return check.ok ? text(200, check.challenge ?? '') : text(403, 'Verification failed');
  }

  if (route === '/whatsapp/cloud' && req.method === 'POST') {
    if (!cloudSignatureOk(req.body, header(req.headers, 'x-hub-signature-256'))) return text(401, 'Bad signature');
    let body: any;
    try {
      body = JSON.parse(req.body.toString('utf8'));
    } catch {
      return text(400, 'Not JSON');
    }
    const messages = parseCloud(body);
    if (!messages.length) {
      // Delivery and read receipts. A failed one is worth recording: it carries Meta's reason.
      for (const entry of body?.entry ?? [])
        for (const change of entry?.changes ?? [])
          for (const s of change?.value?.statuses ?? [])
            if (s.status === 'failed')
              addTrace({ channel: 'cloud', direction: 'note', phone: String(s.recipient_id ?? ''), summary: `Delivery failed: ${s.errors?.[0]?.code} ${s.errors?.[0]?.title ?? ''}` });
    }
    if (!channelReady('cloud')) return text(200, 'ok');
    messages.forEach(m => background(handleInbound(m)));
    return text(200, 'ok');
  }

  if (route === '/whatsapp/twilio' && req.method === 'POST') {
    const params = new URLSearchParams(req.body.toString('utf8'));
    const host = header(req.headers, 'x-forwarded-host') ?? header(req.headers, 'host');
    if (!twilioSignatureOk('/whatsapp/twilio', params, header(req.headers, 'x-twilio-signature'), host)) {
      console.warn(`[whatsapp] Twilio request refused: signature did not match (host ${host}). Check TWILIO_AUTH_TOKEN and the webhook URL in Twilio.`);
      return text(403, '<Response></Response>', 'text/xml');
    }
    const msg = parseTwilio(params);
    if (msg && channelReady('twilio')) background(handleInbound(msg));
    return text(200, '<Response></Response>', 'text/xml');
  }

  // The trace shows group names, people and amounts: with TRACE_TOKEN set, only someone with ?key= can open it.
  if (route === '/whatsapp/trace' && req.method === 'GET') {
    const need = process.env.TRACE_TOKEN?.trim();
    if (need && req.query.get('key') !== need) return text(401, 'This page needs its key: /whatsapp/trace?key=…');
    return text(200, tracePage(), 'text/html; charset=utf-8');
  }

  return text(404, 'Not found');
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function tracePage(): string {
  const rows = listTraces(300)
    .map(
      t => `<tr class="${t.direction}"><td>${esc(new Date(t.at).toLocaleString())}</td><td>${esc(t.channel)}</td><td>${
        { in: '→ in', out: '← out', model: '◆ Meta AI', note: '! note' }[t.direction]
      }</td><td>${esc(t.who)}</td><td>${esc(t.summary)}</td></tr>`
    )
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Group OS · WhatsApp trace</title>
<style>
body{font:14px system-ui,sans-serif;margin:0;padding:16px;background:#efeae2;color:#111b21}
h1{font-size:18px;margin:0 0 4px} p{margin:0 0 12px;color:#54656f}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden}
td{padding:8px;border-bottom:1px solid #e9edef;vertical-align:top} td:nth-child(5){white-space:pre-wrap}
tr.model td{background:#f0f6ff} tr.out td{background:#f3fbf6} tr.note td{background:#fff4f2}
</style></head><body>
<h1>Group OS · WhatsApp trace</h1>
<p>Every WhatsApp message in and out, and every call to Meta AI, newest first. Phone numbers are masked. Refresh to update.</p>
<table><tbody>${rows || '<tr><td>No activity yet.</td></tr>'}</tbody></table>
</body></html>`;
}
