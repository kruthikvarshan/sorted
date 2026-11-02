// Group OS service worker: only one job, receiving images shared from the phone's share menu (Android).
// The shared image is kept in this phone's cache until the person picks a group; then it is removed.
const SHARE_CACHE = 'groupos-share';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/live/share') {
    event.respondWith(
      (async () => {
        const form = await event.request.formData();
        const file = form.get('image');
        const cache = await caches.open(SHARE_CACHE);
        if (file && typeof file !== 'string') await cache.put('/shared-image', new Response(file, { headers: { 'content-type': file.type || 'image/jpeg' } }));
        else await cache.delete('/shared-image');
        const text = [form.get('title'), form.get('text')].filter(Boolean).join(' ');
        const path = `/live/share${text ? `?text=${encodeURIComponent(String(text).slice(0, 500))}` : ''}`;
        return Response.redirect(new URL(path, self.location.origin).href, 303);
      })()
    );
  }
});
