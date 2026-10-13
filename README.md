# ChillaDesk

A lightweight, self-hosted project tracker — a small and simple alternative to Jira.

- **Tasks** — per-project to-do lists
- **Kanban** — the same tasks as a board with custom columns
- **Wiki** — Markdown pages per project, linked to tasks
- **Labels, search and “My tasks”** across all your projects
- **Mentions and notifications** — in the app, and by email if you configure SMTP
- **Live updates** — boards, tasks and pages refresh as your teammates change them
- **English and Russian** interface, following the browser language, with a switcher
- **REST API** with OpenAPI docs — ready for a mobile client
- **MCP server** — let AI agents read and update your projects

> Status: 0.1.0, the first usable release. Everything listed above works. Expect rough
> edges, and back up your data before upgrading.

## Quick start (Docker)

```bash
cp .env.example .env   # then set POSTGRES_PASSWORD
docker compose up -d --build
```

Open http://localhost:8080 and sign up; whoever creates a project owns it. API docs live at
http://localhost:8080/api/docs.

This starts three containers: PostgreSQL (data in the `db-data` volume), the API, and Caddy
serving the web app and proxying `/api`. Database migrations run when the API starts.

### Running it for a team

- **HTTPS.** The compose file serves plain HTTP on one port. Put your own HTTPS reverse proxy
  (Caddy, nginx, Traefik, a cloud load balancer) in front of it and set `COOKIE_SECURE=true`,
  so the session cookie never travels unencrypted.
  Live updates use server-sent events (`/api/events`), a long-lived response: the proxy
  must not buffer it (nginx: `proxy_buffering off` for that path).
- **Sign-ups.** Anyone who can reach the site can register. Once your team is in, set
  `REGISTRATION_ENABLED=false` and restart.
- **Backups.** Everything is in PostgreSQL:

  ```bash
  docker compose exec -T db pg_dump -U chillawiki chillawiki > chilladesk-backup.sql
  ```

  To restore into an empty database:
  `docker compose exec -T db psql -U chillawiki chillawiki < chilladesk-backup.sql`.

- **Upgrading.** Back up, pull the new version, then `docker compose up -d --build`.
- **Checking an installation.** `pnpm --filter @chilladesk/api stack-check http://localhost:8080`
  drives a running instance end to end (it creates and removes throwaway data, so use it on
  a test instance).

### Configuration

| Variable               | Default         | Purpose                                                           |
| ---------------------- | --------------- | ----------------------------------------------------------------- |
| `POSTGRES_PASSWORD`    | — (required)    | Password of the bundled PostgreSQL (URL-safe characters)          |
| `CHILLADESK_PORT`      | `8080`          | Host port of the web UI                                           |
| `COOKIE_SECURE`        | `auto`          | `true` behind an HTTPS proxy, so the session cookie is HTTPS-only |
| `REGISTRATION_ENABLED` | `true`          | Set to `false` once your team has signed up                       |
| `RATE_LIMIT_MAX`       | `600`           | Requests per minute from one address (a shared NAT counts as one) |
| `DATABASE_URL`         | embedded PGlite | PostgreSQL connection string (set by compose)                     |
| `TRUST_PROXY`          | `false`         | Number of reverse proxies in front of the API (compose: `1`)      |
| `LOG_LEVEL`            | `info`          | `fatal` … `trace`, or `silent`                                    |
| `SMTP_URL`             | — (no email)    | `smtp://user:password@host:587`; turns notification emails on     |
| `MAIL_FROM`            | —               | Sender of the emails, e.g. `ChillaDesk <wiki@example.com>`        |
| `PUBLIC_URL`           | —               | Address people open ChillaDesk at; links in emails point there    |

### Mentions and notifications

Write `@` in a task description, a comment or a wiki page and pick a project member; the
text keeps their email (`@ann@example.com`) and readers see `@Ann`. You get a notification
when someone assigns you a task, mentions you, or comments on a task you created or are
assigned to. They are listed under the bell in the header.

Emails are optional: set `SMTP_URL`, `MAIL_FROM` and `PUBLIC_URL` together and the API
sends each notification that has not been read in the app yet. Without them nothing is sent.
Accounts are not verified by email, so anyone who can register can make the server write to
an address of their choosing: close sign-ups (`REGISTRATION_ENABLED=false`) before turning
email on. One person gets at most 30 emails an hour; the rest wait for them in the app.

## API and authentication

Every endpoint is described in the OpenAPI document at `/api/docs`. Log in with
`POST /api/auth/login`: browsers get an HTTP-only session cookie, and other clients
(mobile apps, scripts) send the returned token as `Authorization: Bearer <token>`.
Errors always have the shape `{ "error": { "code", "message", "details"? } }`.

`GET /api/events` is a server-sent event stream that says in which project something
changed (`{"type":"project_changed","projectId":"…","resource":"tasks"}`), so a client knows
what to reload; `{"type":"access_changed"}` says that the set of projects you can see has
changed. One user can hold ten streams open.
Events are delivered by the API process a client is connected to, so run a single API
container (as the compose file does) if you rely on them.

### API tokens

For scripts and AI assistants, create a personal token on the **API tokens** page and send it
as `Authorization: Bearer cw_pat_…`. A token acts as you, with one of two access levels:

- **Read only** — can look at everything you can, and change nothing.
- **Read and write** — can also work with tasks, comments, columns and wiki pages.

No token can manage tokens, change who is in a project, or delete a project; those need a
signed-in session, so a leaked token cannot outlive its own revocation.

## AI assistants (MCP)

ChillaDesk is a [Model Context Protocol](https://modelcontextprotocol.io) server, so an
assistant such as Claude can read and update your projects. Create an API token, then add the
server to your MCP client (the tokens page shows this snippet filled in):

```json
{
  "mcpServers": {
    "chilladesk": {
      "type": "http",
      "url": "https://your-chilladesk.example.com/api/mcp",
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
| `my_tasks`, `search`                   | Your tasks, and search, across every project       |
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

### Translating the interface

Texts live in `apps/web/src/i18n`: `en/*.ts` is the source and every other language is a
folder of files typed against it, so a missing or extra text does not compile. To add a
language, copy `ru/`, translate it, and register it in `messages.ts`. The API answers in
English; `ru/serverText.ts` shows how its error texts are translated in the browser.

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
- [x] Docker release with a verified stack
- [x] Task labels, “My tasks”, search, mentions and notifications
- [x] Live updates over server-sent events
- [x] Russian interface
- [ ] Later: more languages, mobile app, attachments

## License

[MIT](LICENSE)
