/**
 * One forwarder for Meta's API, used by both the Vite dev server and the production server.
 * - If MODEL_API_KEY is set on the server, it is injected here and the browser never sees it.
 * - Otherwise the key the user typed in Settings is passed through.
 * - Only the endpoints the app uses are allowed, and server-key traffic is rate limited so a public
 *   deployment cannot be used to burn credits.
 * Request and response bodies and the key are never logged.
 */

export const ALLOWED_PATHS = new Set(['chat/completions', 'images/generations', 'images/edits', 'asr/transcribe', 'models']);

export interface ProxyRequest {
  method: string;
  path: string;
  search?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: Uint8Array;
  ip: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface ProxyOptions {
  upstream?: string;
  serverKey?: string;
  fetchImpl?: typeof fetch;
  rateLimit?: { max: number; windowMs: number };
  now?: () => number;
}

const json = (status: number, message: string): ProxyResponse => ({
  status,
  headers: { 'content-type': 'application/json' },
  body: new TextEncoder().encode(JSON.stringify({ error: { message } })),
});

const header = (headers: ProxyRequest['headers'], name: string) => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

export function createForwarder(options: ProxyOptions) {
  const upstream = (options.upstream || 'https://api.meta.ai/v1').replace(/\/$/, '');
  const doFetch = options.fetchImpl || fetch;
  const limit = options.rateLimit || { max: 120, windowMs: 60_000 };
  const now = options.now || Date.now;
  const hits = new Map<string, number[]>();

  const overLimit = (ip: string) => {
    const t = now();
    const recent = (hits.get(ip) || []).filter(x => t - x < limit.windowMs);
    recent.push(t);
    hits.set(ip, recent);
    return recent.length > limit.max;
  };

  return async function forward(req: ProxyRequest): Promise<ProxyResponse> {
    const path = req.path.replace(/^\/+/, '');
    if (path.includes('..') || !ALLOWED_PATHS.has(path)) return json(404, `Endpoint not allowed: ${path || '/'}`);

    let authorization: string | undefined;
    if (options.serverKey) {
      if (overLimit(req.ip)) return json(429, 'Too many requests. Slow down and try again shortly.');
      authorization = `Bearer ${options.serverKey}`;
    } else {
      authorization = header(req.headers, 'authorization');
      if (!authorization) {
        return json(401, 'No API key. Set MODEL_API_KEY on the server, or paste a key in Settings.');
      }
    }

    const headers: Record<string, string> = { authorization };
    const contentType = header(req.headers, 'content-type');
    const accept = header(req.headers, 'accept');
    if (contentType) headers['content-type'] = contentType;
    if (accept) headers.accept = accept;

    try {
      const hasBody = !['GET', 'HEAD'].includes(req.method.toUpperCase());
      const upstreamResponse = await doFetch(`${upstream}/${path}${req.search || ''}`, {
        method: req.method,
        headers,
        body: hasBody && req.body && req.body.length > 0 ? (req.body as unknown as BodyInit) : undefined,
      });
      return {
        status: upstreamResponse.status,
        headers: { 'content-type': upstreamResponse.headers.get('content-type') || 'application/json' },
        body: new Uint8Array(await upstreamResponse.arrayBuffer()),
      };
    } catch {
      return json(502, 'Could not reach the Meta API.');
    }
  };
}
