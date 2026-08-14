# Launch & Env

## Commands

```bash
make prod    # 42AI host (Linux) — network_mode: host, .env.prod
make localMac   # Docker Desktop (Mac) — published ports, .env.localMac
```

```bash
make down` stops both containers
make logs` tails both.
``` 
Full mapping to `docker compose`: see `Makefile`.

Behind the scenes, mode = which compose files + which env file get combined:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml     --env-file .env.prod     up -d --build
docker compose -f docker-compose.yml -f docker-compose.localmac.yml --env-file .env.localMac up -d --build
```

`docker-compose.yml` is the shared base (build, volumes, `environment:` substitution). `docker-compose.prod.yml` adds `network_mode: host` to both services; `docker-compose.localmac.yml` adds `ports:` publishing instead — Docker Desktop's `network_mode: host` only reaches its own internal VM, never the Mac's real `localhost`.

## Variables

All variables live in `.env.prod` / `.env.localMac` (both committed — no secrets, just ports/URLs/model names) and are injected into both containers via `docker-compose.yml`'s `environment:` blocks.

### Backend

| Variable | Used in | Purpose |
|---|---|---|
| `PORT` | consumed by `fastify start -P app.js` (fastify-cli); also read by `frontend/vite.config.js` to build the proxy target | port the Fastify server listens on |
| `CORS_ORIGIN` | `backend/plugins/cors.js:12` | single allowed origin for CORS checks |
| `OLLAMA_BASE_URL` | `backend/services/ollama.service.js:3` | Ollama host reachable from the backend container (`localhost` in prod, `host.docker.internal` on local Mac) |
| `OLLAMA_GENERATION_MODEL` | `backend/services/ollama.service.js:4` | LLM model name for answer generation |
| `OLLAMA_EMBEDDING_MODEL` | `backend/services/ollama.service.js:5` | embedding model name for retrieval |

### Frontend

| Variable | Used in | Purpose |
|---|---|---|
| `FRONTEND_PORT` | `frontend/vite.config.js` (`server.port`), `frontend/Dockerfile` (`CMD --port`), `docker-compose.localmac.yml` (ports mapping) | port the Vite dev server listens on |
| `BACKEND_HOST` | `frontend/vite.config.js` — combined with `PORT` into the proxy target (`http://${BACKEND_HOST}:${PORT}`) for `/chat`, `/archiviste`, `/archiviste/documents` | host the frontend container reaches the backend on (`localhost` in prod, `host.docker.internal` on local Mac) |
| `VITE_ALLOWED_HOSTS` | `frontend/vite.config.js` (`server.allowedHosts`) | comma-separated hostnames Vite's dev server accepts requests for (public domain in prod, `localhost` on local Mac) |
| `VITE_API_URL` | `frontend/src/services/chatApi.js:1`, `frontend/src/services/archivisteApi.js:1` | escape hatch to call a different backend URL directly; left empty in both modes so the relative-path Vite proxy is used instead |
