# Launch & Env

## Commands

```bash
make prod    # 42AI host (Linux) — network_mode: host, .env.prod + .env.lab
make localMac   # Docker Desktop (Mac) — published ports, .env.localMac + .env.lab
```

```bash
make down` stops all containers
make logs` tails all.
make db-migrate` / `make db-seed` / `make psql`  — DB helpers (backend/postgres container running)
``` 
Full mapping to `docker compose`: see `Makefile`.

Behind the scenes, mode = which compose files + which env files get combined (`.env.lab` is always the second `--env-file` — it carries the only secrets):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml     --env-file .env.prod     --env-file .env.lab up -d --build
docker compose -f docker-compose.yml -f docker-compose.localmac.yml --env-file .env.localMac --env-file .env.lab up -d --build
```

`docker-compose.yml` is the shared base (build, volumes, `environment:` substitution). `docker-compose.prod.yml` adds `network_mode: host` to both services; `docker-compose.localmac.yml` adds `ports:` publishing instead — Docker Desktop's `network_mode: host` only reaches its own internal VM, never the Mac's real `localhost`.

## Variables

Non-secret variables live in `.env.prod` / `.env.localMac` (both committed — ports/URLs/model names) and are injected via `docker-compose.yml`'s `environment:` blocks. **Secrets** live in **`.env.lab`** (git-ignored; copy from the committed `.env.lab.example` and fill in): `POSTGRES_PASSWORD`, `LAB_LOGIN`, `LAB_PASSWORD`, `LAB_JWT_SECRET`. `make localMac` / `make prod` pass it as a second `--env-file`.

### Backend

| Variable | Used in | Purpose |
|---|---|---|
| `PORT` | consumed by `fastify start -P app.js` (fastify-cli); also read by `frontend/vite.config.js` to build the proxy target | port the Fastify server listens on |
| `CORS_ORIGIN` | `backend/plugins/cors.js:12` | single allowed origin for CORS checks |
| `OLLAMA_BASE_URL` | `backend/services/ollama.service.js:3` | Ollama host reachable from the backend container (`localhost` in prod, `host.docker.internal` on local Mac) |
| `OLLAMA_GENERATION_MODEL` | `backend/services/ollama.service.js:4` | LLM model name for answer generation |
| `OLLAMA_EMBEDDING_MODEL` | `backend/services/ollama.service.js:5` | embedding model name for retrieval |
| `POSTGRES_HOST` / `POSTGRES_PORT` | `backend/db/config.js` | Postgres address — `postgres` / `5432` (bridge, local Mac) vs `localhost` / `5442` (loopback, prod `network_mode: host`) |
| `POSTGRES_USER` / `POSTGRES_DB` | `backend/db/config.js`, `postgres` service | role + database name (`boby42` / `boby42`) |
| `POSTGRES_HOST_PORT` | `docker-compose.yml` (`postgres` ports) | host-side port for the loopback publish (`127.0.0.1:5442:5432`) |
| `POSTGRES_PASSWORD` | `postgres` service, `backend/db/config.js` | **secret — `.env.lab`**, no default |
| `LAB_LOGIN` / `LAB_PASSWORD` | `backend/db/seed.js` (`seedLabUser`, at boot + `make db-seed`) | the single `/lab` account. **`.env.lab`** — empty ⇒ no user seeded ⇒ `/auth/lab/*` return 404 |
| `LAB_JWT_SECRET` | `backend/services/labAuth.service.js` | signs the `/lab` session JWT. **`.env.lab`** — unset ⇒ `/auth/lab/*` return 404 |

### Frontend

| Variable | Used in | Purpose |
|---|---|---|
| `FRONTEND_PORT` | `frontend/vite.config.js` (`server.port`), `frontend/Dockerfile` (`CMD --port`), `docker-compose.localmac.yml` (ports mapping) | port the Vite dev server listens on |
| `BACKEND_HOST` | `frontend/vite.config.js` — combined with `PORT` into the proxy target (`http://${BACKEND_HOST}:${PORT}`) for `/chat`, `/archiviste`, `/archiviste/documents` | host the frontend container reaches the backend on (`localhost` in prod, `host.docker.internal` on local Mac) |
| `VITE_ALLOWED_HOSTS` | `frontend/vite.config.js` (`server.allowedHosts`) | comma-separated hostnames Vite's dev server accepts requests for (public domain in prod, `localhost` on local Mac) |
| `VITE_API_URL` | `frontend/src/services/chatApi.js:1`, `frontend/src/services/archivisteApi.js:1` | escape hatch to call a different backend URL directly; left empty in both modes so the relative-path Vite proxy is used instead |

## Deploying to a new host (or first run after T13)

`.env.lab` is **git-ignored** — it is not pulled with the repo and must be created on each host:

```bash
cp .env.lab.example .env.lab
$EDITOR .env.lab          # POSTGRES_PASSWORD=…  LAB_LOGIN=42wiz  LAB_PASSWORD=…  LAB_JWT_SECRET=$(openssl rand -hex 48)
make prod                 # (or make localMac) — aborts early if .env.lab is missing
```

The backend applies migrations **and seeds the `/lab` user** automatically at boot (`plugins/sequelize.js` → `seedLabUser`), so no separate step is needed; `make db-seed` stays for a manual re-seed after changing `LAB_PASSWORD`.

⚠️ **`POSTGRES_PASSWORD` is only read on the first init of the `postgres_data` volume.** If a `make prod` ever ran with an empty/wrong `.env.lab`, the database keeps the password from that first run and the backend logs `[db] not reachable … password authentication failed`. Recovery: `docker compose down -v` (**destroys the DB data**) then `make prod`, or fix it in place with `make psql` → `ALTER USER boby42 PASSWORD '…';`.

**Quick health check on a host:**

```bash
docker compose ps                                   # 3 containers, postgres healthy
docker compose logs backend | grep -iE "\[db\]|\[lab\]|\[seed\]|migrat|listening"
docker compose exec backend node -e "require('./models').sequelize.authenticate().then(()=>console.log('DB reachable')).catch(e=>{console.error(e.message);process.exit(1)})"
docker compose exec postgres psql -U boby42 -d boby42 -c "SELECT id, login FROM users;"
```
