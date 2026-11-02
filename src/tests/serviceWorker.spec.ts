import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

/** Runs public/sw.js with a fake service-worker environment and sends it what Android's share menu sends. */
function loadWorker() {
  const handlers: Record<string, (e: any) => void> = {};
  const store = new Map<string, Response>();
  const caches = { open: async () => ({ put: async (k: string, v: Response) => void store.set(k, v), delete: async (k: string) => store.delete(k) }) };
  const self = { location: { origin: 'http://localhost' }, addEventListener: (t: string, f: (e: any) => void) => (handlers[t] = f), skipWaiting: () => undefined, clients: { claim: async () => undefined } };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, caches, Response, URL, encodeURIComponent, String });
  return { handlers, store };
}

describe('receiving a share from the phone (service worker)', () => {
  it('keeps the shared image on the phone and opens the picker with the shared text', async () => {
    const { handlers, store } = loadWorker();
    const form = new FormData();
    form.append('image', new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }));
    form.append('text', 'fridge filter');
    let reply: Promise<Response> | undefined;
    handlers.fetch({ request: new Request('http://localhost/live/share', { method: 'POST', body: form }), respondWith: (p: Promise<Response>) => (reply = p) });
    const res = await reply!;
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('http://localhost/live/share?text=fridge%20filter');
    expect(store.has('/shared-image')).toBe(true);
  });

  it('leaves every other request alone', () => {
    const { handlers } = loadWorker();
    let touched = false;
    handlers.fetch({ request: new Request('http://localhost/live/api/rooms', { method: 'POST', body: '{}' }), respondWith: () => (touched = true) });
    handlers.fetch({ request: new Request('http://localhost/live/share'), respondWith: () => (touched = true) });
    expect(touched).toBe(false);
  });
});
