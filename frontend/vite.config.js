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
      '/chat': backendTarget,
      '/archiviste/documents': backendTarget,
      '/archiviste': {
        target: backendTarget,
        // '/archiviste' (no suffix) is both a React Router page and an API
        // endpoint: only proxy POST, let Vite serve the page for GET
        // (direct navigation / refresh).
        bypass: (req) => (req.method !== 'POST' ? req.url : undefined),
      },
    },
  },
})
