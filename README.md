# ChillaWiki

A lightweight, self-hosted project tracker — a small and simple alternative to Jira.

- **Tasks** — per-project to-do lists
- **Kanban** — the same tasks as a board with custom columns
- **Wiki** — Markdown pages per project, linked to tasks
- **REST API** with OpenAPI docs — ready for a mobile client
- **MCP server** — let AI agents read and update your projects

> Status: early development. Everything listed above works; a packaged release is next
> (see the roadmap).

## Quick start (Docker)

```bash
cp .env.example .env   # then set POSTGRES_PASSWORD
docker compose up -d --build
```

Open http://localhost:8080. API docs live at http://localhost:8080/api/docs.

The compose file serves plain HTTP. For anything beyond your own machine, put an HTTPS
reverse proxy in front of it and set `COOKIE_SECURE=true`.

### Configuration

| Variable               | Default         | Purpose                                                           |
| ---------------------- | --------------- | ----------------------------------------------------------------- |
| `POSTGRES_PASSWORD`    | — (required)    | Password of the bundled PostgreSQL (URL-safe characters)          |
| `CHILLAWIKI_PORT`      | `8080`          | Host port of the web UI                                           |
| `COOKIE_SECURE`        | `auto`          | `true` behind an HTTPS proxy, so the session cookie is HTTPS-only |
| `REGISTRATION_ENABLED` | `true`          | Set to `false` once your team has signed up                       |
| `DATABASE_URL`         | embedded PGlite | PostgreSQL connection string (set by compose)                     |
| `TRUST_PROXY`          | `false`         | Number of reverse proxies in front of the API (compose: `1`)      |
| `LOG_LEVEL`            | `info`          | `fatal` … `trace`, or `silent`                                    |

## API and authentication

Every endpoint is described in the OpenAPI document at `/api/docs`. Log in with
`POST /api/auth/login`: browsers get an HTTP-only session cookie, and other clients
(mobile apps, scripts) send the returned token as `Authorization: Bearer <token>`.
Errors always have the shape `{ "error": { "code", "message", "details"? } }`.

### API tokens

For scripts and AI assistants, create a personal token on the **API tokens** page and send it
as `Authorization: Bearer cw_pat_…`. A token acts as you, with one of two access levels:

- **Read only** — can look at everything you can, and change nothing.
- **Read and write** — can also work with tasks, comments, columns and wiki pages.

No token can manage tokens, change who is in a project, or delete a project; those need a
signed-in session, so a leaked token cannot outlive its own revocation.

## AI assistants (MCP)

ChillaWiki is a [Model Context Protocol](https://modelcontextprotocol.io) server, so an
assistant such as Claude can read and update your projects. Create an API token, then add the
server to your MCP client (the tokens page shows this snippet filled in):

```json
{
  "mcpServers": {
    "chillawiki": {
      "type": "http",
      "url": "https://your-chillawiki.example.com/api/mcp",
      "headers": { "Authorization": "Bearer cw_pat_…" }
    }
  }
}
```

Tools address things by name: projects by key (`CHL`), tasks by key (`CHL-12`), statuses by
name, people by email and wiki pages by title.

| Tool                                   | What it does                                       |
| -------------------------------------- | -------------------------------------------------- |
| `list_projects`, `get_project`         | Projects, their board statuses and members         |
| `list_tasks`, `get_task`               | Tasks with filters; one task with its comments     |
| `create_task`, `update_task`           | Create, edit, assign and move tasks (write tokens) |
| `add_comment`                          | Comment on a task (write tokens)                   |
| `list_wiki_pages`, `get_wiki_page`     | List, search and read wiki pages                   |
| `create_wiki_page`, `update_wiki_page` | Write wiki pages, keeping history (write tokens)   |

The endpoint is stateless Streamable HTTP. An assistant reads whatever project members wrote,
so give it a read-only token unless it needs to make changes.

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

- [x] Accounts, projects and members with roles
- [x] Tasks: list view, kanban board, comments, filters
- [x] Wiki: page tree, Markdown editor, versions, `[[links]]` and task references
- [x] MCP server and personal API tokens
- [ ] Production release: verified Docker images, deployment guide
- [ ] Later: task labels, mobile app, realtime updates, attachments, notifications

## License

[MIT](LICENSE)
