# ChillaWiki

A lightweight, self-hosted project tracker — a small and simple alternative to Jira.

- **Tasks** — per-project to-do lists
- **Kanban** — the same tasks as a board with custom columns
- **Wiki** — Markdown pages per project, linked to tasks
- **REST API** with OpenAPI docs — ready for a mobile client
- **MCP server** — let AI agents read and update your projects

> Status: early development (phase 0 — project skeleton).

## Quick start (Docker)

```bash
cp .env.example .env   # then set POSTGRES_PASSWORD
docker compose up -d --build
```

Open http://localhost:8080. API docs live at http://localhost:8080/api/docs.

## Development

Requirements: Node.js 22+ and pnpm (via `corepack enable`). Docker is optional —
without `DATABASE_URL` the API uses an embedded [PGlite](https://pglite.dev) database.

```bash
pnpm install
pnpm dev          # API on :3000, web on :5173 (proxies /api to the API)
pnpm test         # unit + integration tests with coverage
pnpm lint && pnpm typecheck
```

## Repository layout

```
apps/api         Fastify + Drizzle ORM (PostgreSQL / PGlite), OpenAPI, MCP
apps/web         React + Vite web client
packages/shared  zod schemas and types shared by every client
docker/          Caddy config for the web image
```

## Roadmap

1. Accounts, projects and members with roles
2. Tasks: list view, kanban board, comments, filters
3. Wiki: page tree, Markdown editor, versions, `[[links]]` and task references
4. MCP server and personal API tokens
5. Production release: one-command Docker deploy, documentation
6. Later: mobile app, realtime updates, attachments, notifications

## License

[MIT](LICENSE)
