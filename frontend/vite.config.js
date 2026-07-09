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

      // * * * [ Prod ] * * *
      '/chat': 'http://localhost:8420',

      // // // * * * [ Dev ]
      // '/chat': 'http://host.docker.internal:8420',

    },
  },
})
