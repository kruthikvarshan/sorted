import express from 'express';
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createForwarder } from './proxy';
import { handleWhatsAppHttp } from './whatsapp/routes';
import { handleLive } from './live/http';

// Production server: serves the built app and forwards Meta API calls with the key held server-side.
config({ path: ['.env.local', '.env'], quiet: true });

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../dist');
const serverKey = process.env.MODEL_API_KEY?.trim() || undefined;
// The forwarder only lends the server's Meta key when that is explicitly allowed; the live app never needs it.
const forward = createForwarder({ serverKey: process.env.ALLOW_PUBLIC_PROXY === '1' ? serverKey : undefined, upstream: process.env.META_API_BASE });

// A stray failed promise (a Meta call that errors in the background) is logged; it never takes the server down.
process.on('unhandledRejection', err => console.error('[sorted] background error:', err));

const app = express();

app.get('/api/config', (_req, res) => {
  res.json({ serverKey: !!serverKey, publicUrl: process.env.PUBLIC_URL || null });
});

app.use('/meta-proxy', express.raw({ type: () => true, limit: '40mb' }), async (req, res) => {
  const [pathname, ...rest] = req.url.split('?');
  const result = await forward({
    method: req.method,
    path: pathname,
    search: rest.length ? `?${rest.join('?')}` : '',
    headers: req.headers,
    body: Buffer.isBuffer(req.body) ? req.body : undefined,
    ip: req.ip || 'unknown',
  });
  res.status(result.status);
  Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
  res.send(Buffer.from(result.body));
});

// Live rooms: the multi-phone group with Sorted as a member (reads its own request bodies).
app.use(async (req, res, next) => {
  if (!(await handleLive(req, res))) next();
});

// WhatsApp webhooks (Meta Cloud API and Twilio sandbox) and the trace page.
app.use('/whatsapp', express.raw({ type: () => true, limit: '20mb' }), async (req, res) => {
  const out = await handleWhatsAppHttp({
    method: req.method,
    path: req.baseUrl + req.path,
    query: new URLSearchParams(req.url.split('?')[1] ?? ''),
    headers: req.headers,
    body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
  });
  if (!out) return res.status(404).end();
  res.status(out.status).type(out.type).send(out.body);
});

app.use(express.static(dist));
app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));

const port = Number(process.env.PORT) || 8080;
app.listen(port, () => {
  console.log(`Sorted on http://localhost:${port} (${serverKey ? 'Meta key held on the server' : 'no server key: users paste their own in Settings'})`);
});
