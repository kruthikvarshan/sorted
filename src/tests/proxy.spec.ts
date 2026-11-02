import { describe, expect, it, vi } from 'vitest';
import { createForwarder, ProxyRequest } from '../../server/proxy';

// A fresh Response per call: a body can only be read once.
const upstreamOk = () =>
  vi.fn().mockImplementation(
    async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  );

const req = (over: Partial<ProxyRequest> = {}): ProxyRequest => ({
  method: 'POST',
  path: '/chat/completions',
  search: '',
  headers: { 'content-type': 'application/json' },
  body: new TextEncoder().encode('{"model":"muse-spark-1.3"}'),
  ip: '1.1.1.1',
  ...over,
});

const sentHeaders = (fetchImpl: ReturnType<typeof vi.fn>) => fetchImpl.mock.calls[0][1].headers as Record<string, string>;

describe('meta forwarder', () => {
  it('injects the server key and ignores whatever key the browser sent', async () => {
    const fetchImpl = upstreamOk();
    const forward = createForwarder({ serverKey: 'SERVER_SECRET', fetchImpl });
    await forward(req({ headers: { authorization: 'Bearer browser-key', 'content-type': 'application/json' } }));
    expect(sentHeaders(fetchImpl).authorization).toBe('Bearer SERVER_SECRET');
    expect(JSON.stringify(fetchImpl.mock.calls[0])).not.toContain('browser-key');
  });

  it('passes the browser key through only when the server has none', async () => {
    const fetchImpl = upstreamOk();
    const forward = createForwarder({ fetchImpl });
    await forward(req({ headers: { authorization: 'Bearer typed-in-settings' } }));
    expect(sentHeaders(fetchImpl).authorization).toBe('Bearer typed-in-settings');
  });

  it('refuses with 401 and never calls Meta when there is no key anywhere', async () => {
    const fetchImpl = upstreamOk();
    const res = await createForwarder({ fetchImpl })(req({ headers: {} }));
    expect(res.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('only allows the endpoints the app uses', async () => {
    const fetchImpl = upstreamOk();
    const forward = createForwarder({ serverKey: 'K', fetchImpl });
    for (const path of ['/fine_tuning/jobs', '/files', '/../admin', '/chat/completions/../../x', '/']) {
      expect((await forward(req({ path }))).status).toBe(404);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
    for (const path of ['/chat/completions', '/images/generations', '/asr/transcribe', '/models']) {
      expect((await forward(req({ path, method: path === '/models' ? 'GET' : 'POST' }))).status).toBe(200);
    }
  });

  it('forwards the body, content type, query string and upstream status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"error":{"message":"bad"}}', { status: 400 }));
    const res = await createForwarder({ serverKey: 'K', fetchImpl, upstream: 'https://example.test/v1/' })(
      req({ path: '/asr/transcribe', search: '?sessionId=s1', headers: { 'content-type': 'multipart/form-data; boundary=x' } })
    );
    expect(fetchImpl.mock.calls[0][0]).toBe('https://example.test/v1/asr/transcribe?sessionId=s1');
    expect(sentHeaders(fetchImpl)['content-type']).toBe('multipart/form-data; boundary=x');
    expect(res.status).toBe(400);
    expect(new TextDecoder().decode(res.body)).toContain('bad');
  });

  it('rate limits server-key traffic per client and recovers after the window', async () => {
    let t = 0;
    const forward = createForwarder({ serverKey: 'K', fetchImpl: upstreamOk(), rateLimit: { max: 3, windowMs: 1000 }, now: () => t });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await forward(req())).status);
    expect(statuses).toEqual([200, 200, 200, 429, 429]);
    expect((await forward(req({ ip: '2.2.2.2' }))).status).toBe(200); // another client is unaffected
    t = 5000;
    expect((await forward(req())).status).toBe(200);
  });

  it('turns a network failure into a 502 that does not expose the key', async () => {
    const forward = createForwarder({ serverKey: 'SERVER_SECRET', fetchImpl: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED SERVER_SECRET')) });
    const res = await forward(req());
    expect(res.status).toBe(502);
    expect(new TextDecoder().decode(res.body)).not.toContain('SERVER_SECRET');
  });
});
