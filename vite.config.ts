import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import {createForwarder} from './server/proxy';

// Dev server uses the same forwarder as production, so the key can stay out of the browser here too.
function metaProxy(serverKey: string | undefined, env: Record<string, string>): Plugin {
  const forward = createForwarder({serverKey: process.env.ALLOW_PUBLIC_PROXY === '1' ? serverKey : undefined});
  return {
    name: 'group-os-meta-proxy',
    configureServer(server) {
      // The WhatsApp side runs in this same server during development, with the same handlers as production.
      for (const [k, v] of Object.entries(env)) if (/^(MODEL_API_KEY|META_API_BASE|WHATSAPP_|TWILIO_|PUBLIC_URL|GROUP_OS_DB)/.test(k)) process.env[k] = v;
      // Live rooms (the multi-phone group with Group OS as a member), same handler as production.
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/live/api/')) return next();
        const {handleLive} = await server.ssrLoadModule('/server/live/http.ts');
        if (!(await handleLive(req, res))) next();
      });
      server.middlewares.use('/whatsapp', async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const [pathname, search = ''] = (req.originalUrl || req.url || '/').split('?');
        const {handleWhatsAppHttp} = await server.ssrLoadModule('/server/whatsapp/routes.ts');
        const out = await handleWhatsAppHttp({method: req.method || 'GET', path: pathname, query: new URLSearchParams(search), headers: req.headers, body: Buffer.concat(chunks)});
        res.statusCode = out?.status ?? 404;
        res.setHeader('content-type', out?.type ?? 'text/plain');
        res.end(out?.body ?? 'Not found');
      });
      server.middlewares.use('/api/config', async (_req, res) => {
        res.setHeader('content-type', 'application/json');
        // The public address (tunnel or deployment) is what phones can open, so invites use it.
        res.end(JSON.stringify({serverKey: !!serverKey, publicUrl: (await server.ssrLoadModule('/server/whatsapp/channels.ts')).env('PUBLIC_URL') || null}));
      });

      server.middlewares.use('/meta-proxy', async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const [pathname, ...rest] = (req.url || '/').split('?');
        const result = await forward({
          method: req.method || 'GET',
          path: pathname,
          search: rest.length ? `?${rest.join('?')}` : '',
          headers: req.headers,
          body: Buffer.concat(chunks),
          ip: req.socket.remoteAddress || 'unknown',
        });
        res.statusCode = result.status;
        Object.entries(result.headers).forEach(([k, v]) => res.setHeader(k, v));
        res.end(Buffer.from(result.body));
      });
    },
  };
}

export default defineConfig(({mode}) => {
  // Read from .env / .env.local on the server side only. Not prefixed VITE_, so it never reaches the bundle.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss(), metaProxy(env.MODEL_API_KEY?.trim() || undefined, env)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // Lets a Cloudflare quick tunnel reach the dev server, so WhatsApp webhooks can arrive while developing.
      allowedHosts: ['.trycloudflare.com'],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      // eval/ and private/ hold generated results and raw exports: writing there must never reload the page.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/eval/**', '**/private/**', '**/data/**'] },
    },
  };
});
