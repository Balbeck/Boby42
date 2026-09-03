# Boby 42 — frontend

The single-page React app of Boby 42, a RAG chatbot for 42 students. Three
routes: `/chat` (ask a question, get a sourced answer), `/archiviste` (search the
document base without the LLM — also the landing page), and `/lab`, a
password-gated maintenance page (usage dashboard, DB inspector, Ollama console).

## Running it

This frontend is **not** started on its own in normal use. From the repository
root:

```bash
make localMac   # Docker Desktop on macOS
make prod       # the 42AI host
```

Either way the container serves the app on **port 8421**, and in both modes it
currently runs `npm run dev` — the Vite dev server, not a static build. That is
also what makes the backend reachable: `vite.config.js` proxies the API paths
server-side, so the browser only ever talks to this origin.

Environment variables and per-host setup: `Launch&EnvReadme.md` at the
repository root.

## Scripts

```bash
npm run dev     # Vite dev server on 8421
npm run lint    # ESLint over the project
npm run build   # production build — a compile check for now, nothing serves it
```
