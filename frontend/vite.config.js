import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// BACKEND_HOST + PORT come from the container environment (see docker-compose.yml
// and .env.localMac / .env.prod) — "localhost" in prod (network_mode: host),
// "host.docker.internal" in local Mac dev (Docker Desktop's own network namespace).
const backendTarget = `http://${process.env.BACKEND_HOST}:${process.env.PORT}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.FRONTEND_PORT),
    allowedHosts: (process.env.VITE_ALLOWED_HOSTS || '').split(',').filter(Boolean),
    proxy: {
      '/BaseDocumentaire': backendTarget,
      '/subjectspdf': backendTarget,
      // POST-only API, no SPA page at /feedback — plain proxy, no bypass.
      '/feedback': backendTarget,
      '/archiviste/documents': backendTarget,
      // Nested API path under /chat — must stay ABOVE the '/chat' entry, whose
      // bypass only forwards POST (same trap as '/archiviste/documents'). POST-only,
      // no SPA page collision → plain proxy.
      '/chat/documents': backendTarget,
      // /lab is an SPA page, but the auth API lives under /auth/lab (no page
      // collision) so it proxies plainly — no bypass needed.
      '/auth/lab': backendTarget,
      // db-viz inspector API. /lab-data shadows no page (/lab is the page), so
      // it proxies plainly like /auth/lab — no bypass.
      '/lab-data': backendTarget,
      // /lab 🔬 analytics dashboard API. No page at /analytics — plain proxy,
      // no bypass. Gated backend-side by fastify.verifyLab.
      '/analytics': backendTarget,
      // Transparent reverse-proxy to Ollama (test tooling, shared-key gated in
      // routes/ollama.js). No page collision — plain proxy; http-proxy streams
      // NDJSON responses through untouched.
      '/ollama': backendTarget,
      // '/chat' and '/archiviste' (no suffix) are each both a React Router
      // page and a POST-only API endpoint: only proxy POST, let Vite serve
      // the page for GET (direct navigation / refresh).
      '/chat': {
        target: backendTarget,
        bypass: (req) => (req.method !== 'POST' ? req.url : undefined),
      },
      '/archiviste': {
        target: backendTarget,
        bypass: (req) => (req.method !== 'POST' ? req.url : undefined),
      },
    },
  },
})
