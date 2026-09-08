/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// BACKEND_HOST + PORT come from the container environment (see docker-compose.yml
// and .env.localMac / .env.prod) — "localhost" in prod (network_mode: host),
// "host.docker.internal" in local Mac dev (Docker Desktop's own network namespace).
//
// Both are unset when a documented host command runs (`npm run build`,
// `npm run dev` from frontend/ — see frontend/CLAUDE.md → Commands), which used
// to build the proxy target `http://undefined:undefined` in silence. Defaults +
// a named warning rather than a throw: throwing would break those two commands.
const DEFAULT_BACKEND_HOST = 'localhost'
const DEFAULT_BACKEND_PORT = '8420'

if (!process.env.BACKEND_HOST) {
  console.warn(`[vite] BACKEND_HOST is not set — proxying to ${DEFAULT_BACKEND_HOST}`)
}
if (!process.env.PORT) {
  console.warn(`[vite] PORT is not set — proxying to port ${DEFAULT_BACKEND_PORT}`)
}

const backendHost = process.env.BACKEND_HOST || DEFAULT_BACKEND_HOST
const backendPort = process.env.PORT || DEFAULT_BACKEND_PORT
const backendTarget = `http://${backendHost}:${backendPort}`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vitest (F10). Lives here rather than in a vitest.config.js so the tests run
  // through this same config — a separate file would silently shadow it.
  // `jsdom` because most suites render components or hooks; `globals` stays off
  // so every test file imports what it uses (ESLint sees no unknown global).
  // `setupFiles` carries the cleanup hook plus the jsdom gaps the components
  // trip over (matchMedia, ResizeObserver, scrollIntoView, recharts' sizing).
  test: {
    environment: 'jsdom',
    // Only tests/unittests/** — integration and e2e get their own folders and
    // their own scripts when they land, and must never be folded into the unit
    // run (see "Tests" in CLAUDE.md). tests/{setup,fetchStub,fixtures}.js sit at
    // the tests/ root: the harness is shared by all three levels, not unit-only.
    include: ['tests/unittests/**/*.test.{js,jsx}'],
    setupFiles: ['./tests/setup.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      // `include` is the load-bearing part: it puts every source file in the
      // denominator, so an untested module reports 0 % instead of being absent
      // from the report entirely. Same trap as node's
      // --experimental-test-coverage on the backend, where a route nobody
      // loaded simply did not appear and the percentage described a subset.
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        // JSDoc typedefs — no runtime code at all.
        'src/types/types.js',
        // The composition root: createRoot().render() with the router tree.
        // Mounting it is an integration test by definition (it renders the whole
        // app), and integration is deliberately deferred — see "Tests" in
        // CLAUDE.md. Mirrors the backend excluding app.js.
        'src/main.jsx',
      ],
      // Lines only, like the backend. Branches and functions are reported but
      // not enforced — raising those is a separate, much more expensive call.
      //
      // 100, reached 2026-09-08. Never lower it to make a run pass: a file that
      // cannot be covered is either dead code to delete or a design to change —
      // `DataGrid`'s DEFAULT_KIND was the former and was folded into the search
      // list rather than exempted.
      thresholds: { lines: 100 },
    },
  },
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
      // Visitor history for the drawer (GET only). No page at /conversations —
      // plain proxy, no bypass.
      '/conversations': backendTarget,
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
