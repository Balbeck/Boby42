import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 8421,
    allowedHosts: ['42gpt.42ai.net'],
    proxy: {
      // Le backend tourne en network_mode: host sur la machine hôte ; ce container
      // partage donc la même stack réseau (voir docker-compose.yml) et localhost:8420
      // le joint directement, sans passer par un second tunnel Cloudflare.

      // // * * * [ Prod ] * * *
      // '/chat': 'http://localhost:8420',
      // // Déclaré avant '/archiviste' : plus spécifique, donc toujours proxyfié
      // // (GET /archiviste/documents/:name est un vrai appel API, pas une navigation).
      // '/archiviste/documents': 'http://localhost:8420',
      // '/archiviste': {
      //   target: 'http://localhost:8420',
      //   // '/archiviste' (sans suffixe) est à la fois une route React Router (page) et un
      //   // endpoint API : ne proxyfier que les POST, laisser Vite servir la page pour les GET
      //   // (navigation directe / refresh).
      //   bypass: (req) => (req.method !== 'POST' ? req.url : undefined),
      // },

      // // * * * [ Dev ]
      '/chat': 'http://host.docker.internal:8420',
      '/archiviste/documents': 'http://host.docker.internal:8420',
      '/archiviste': {
        target: 'http://host.docker.internal:8420',
        bypass: (req) => (req.method !== 'POST' ? req.url : undefined),
      },

    },
  },
})
