# ChillaDesk

A lightweight, self-hosted project tracker — a small and simple alternative to Jira.

![The board of a project](docs/screenshots/board.png)

- **Tasks** — per-project to-do lists
- **Kanban** — the same tasks as a board with custom columns
- **Wiki** — Markdown pages per project, linked to tasks
- **Labels, search and “My tasks”** across all your projects
- **Attachments** — files on tasks and wiki pages, pictures shown right in the text
- **Checklists, links between tasks, milestones**, a history of every task, and a task list
  with sorting, saved filters and bulk actions
- **Webhooks** — tell Slack, Telegram, Discord or your CI about tasks, comments and pages
- **Import and export** — tasks from CSV (ours or Jira) and Trello boards; tasks to CSV and
  the wiki to a ZIP of Markdown files
- **Mentions and notifications** — in the app, and by email if you configure SMTP
- **Live updates** — boards, tasks and pages refresh as your teammates change them
- **English and Russian** interface, following the browser language, with a switcher
- **REST API** with OpenAPI docs — ready for a mobile client
- **MCP server** — let AI agents read and update your projects

## Screenshots

|                                                                            |                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| ![A task with its checklist, links and details](docs/screenshots/task.png) | ![The task list with filters](docs/screenshots/list.png)     |
| A task: description in Markdown, checklist, links, details                 | The list: filters, sorting, bulk actions                     |
| ![A wiki page](docs/screenshots/wiki.png)                                  | ![Milestones with progress](docs/screenshots/milestones.png) |
| The wiki: a page tree, links to pages and tasks                            | Milestones and how far along they are                        |
| ![The board in the dark theme](docs/screenshots/board-dark.png)            | ![The board in Russian](docs/screenshots/board-ru.png)       |
| A dark theme that follows the system                                       | The interface in Russian                                     |

> Status: 0.2.0. Everything listed above works; see [CHANGELOG.md](CHANGELOG.md) for what is
> new. Expect rough edges, and back up your data before upgrading.

## Install

Three ways, from the quickest to the most complete. Each opens on http://localhost:8080: sign
up there, and whoever creates a project owns it. API docs live at `/api/docs`. Images are on
`ghcr.io/vogster` for amd64 and arm64; add a version (`:0.3.0`) instead of `:latest` to pin one.

### One container

Everything in one image, with the data in one folder: the quickest way to try ChillaDesk,
and enough for a small team. It uses an embedded database (PGlite) unless you give it
`DATABASE_URL` of a PostgreSQL server.

```bash
docker run \
  --detach \
  --name=chilladesk \
  --restart unless-stopped \
  --volume ./chilladesk:/data \
  --env REGISTRATION_ENABLED=true \
  --publish 8080:3000 \
  ghcr.io/vogster/chilladesk:latest
```

The same as a `docker-compose.yml`:

```yaml
services:
  chilladesk:
    container_name: chilladesk
    image: ghcr.io/vogster/chilladesk:latest
    restart: unless-stopped
    ports:
      - '8080:3000'
    volumes:
      - ./chilladesk:/data
    environment:
      - REGISTRATION_ENABLED=true
      # - PUBLIC_URL=https://desk.example.com
```

`./chilladesk` holds the database and attached files: back it up, and keep it when you
update (`docker pull ghcr.io/vogster/chilladesk:latest`, then recreate the container). The
folder is given to user 1000:1000 on start; set `PUID` and `PGID` to use another.

### With PostgreSQL

Three containers (PostgreSQL, the API, and Caddy serving the web app), from the published
images, without the source code:

```bash
mkdir chilladesk && cd chilladesk
curl -fsSLO https://raw.githubusercontent.com/vogster/ChillaDesk/main/deploy/docker-compose.yml
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
docker compose up -d
```

The data is in the `postgres` and `files` volumes. Settings are the environment variables of
the `api` service in [deploy/docker-compose.yml](deploy/docker-compose.yml).

### From source

```bash
git clone https://github.com/vogster/ChillaDesk.git && cd ChillaDesk
cp .env.example .env   # then set POSTGRES_PASSWORD
docker compose pull    # released images; skip it to build the checkout
docker compose up -d   # or: docker compose up -d --build
```

This starts the same three containers (data in the `db-data` and `api-data` volumes), with
every setting in `.env`. Pin a version with `CHILLADESK_VERSION=0.3.0` there. Database
migrations run when the API starts, whichever way it is installed.

### Running it for a team

- **HTTPS.** The compose file serves plain HTTP on one port. Put your own HTTPS reverse proxy
  (Caddy, nginx, Traefik, a cloud load balancer) in front of it and set `COOKIE_SECURE=true`,
  so the session cookie never travels unencrypted.
  Live updates use server-sent events (`/api/events`), a long-lived response: the proxy
  must not buffer it (nginx: `proxy_buffering off` for that path).
- **Inviting people.** An owner adds someone by email, or creates an invite link on the
  members page: whoever opens it within a week, signs in or signs up, joins the project.
  Removing a member revokes every link of the project.
- **Sign-ups.** Anyone who can reach the site can register. To let in only the people you
  invite, set `REGISTRATION_ENABLED=invite` and restart: signing up then works only through
  an invite link, and puts the newcomer straight into its project (with email set up, once
  they confirm the address). On a new server the very first person still signs up without an
  invite, to have someone who can send them. `REGISTRATION_ENABLED=false` closes sign-up
  entirely.
- **Several API replicas.** With PostgreSQL, live updates travel between replicas through
  `LISTEN/NOTIFY`, and per-account limits, notification emails and webhook deliveries are
  kept in the database. Two things are still per replica: the per-address request limits
  (`RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`) and attached files, which need a disk all
  replicas share.
- **Backups.** Everything but attached files is in PostgreSQL; the files are in the
  `api-data` volume (`/data/files` in the API container), so copy that as well:

  ```bash
  docker compose exec -T db pg_dump -U chillawiki chillawiki > chilladesk-backup.sql
  ```

  To restore into an empty database:
  `docker compose exec -T db psql -U chillawiki chillawiki < chilladesk-backup.sql`.

- **Upgrading.** Back up, then `git pull`, `docker compose pull` and `docker compose up -d`
  (or `docker compose up -d --build` when you build from source). Migrations run on start.
- **Checking an installation.** `pnpm --filter @chilladesk/api stack-check http://localhost:8080`
  drives a running instance end to end (it creates and removes throwaway data, so use it on
  a test instance).

### Configuration

| Variable                 | Default         | Purpose                                                                      |
| ------------------------ | --------------- | ---------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`      | — (required)    | Password of the bundled PostgreSQL (URL-safe characters)                     |
| `CHILLADESK_PORT`        | `8080`          | Host port of the web UI                                                      |
| `COOKIE_SECURE`          | `auto`          | `true` behind an HTTPS proxy, so the session cookie is HTTPS-only            |
| `REGISTRATION_ENABLED`   | `true`          | `invite`: sign-up only with an invite link; `false`: nobody                  |
| `RATE_LIMIT_MAX`         | `600`           | Requests per minute from one address (a shared NAT counts as one)            |
| `DATABASE_URL`           | embedded PGlite | PostgreSQL connection string (set by compose)                                |
| `TRUST_PROXY`            | `false`         | Number of reverse proxies in front of the API (compose: `1`)                 |
| `LOG_LEVEL`              | `info`          | `fatal` … `trace`, or `silent`                                               |
| `MAX_UPLOAD_MB`          | `10`            | Largest file that can be attached to a task or a wiki page                   |
| `PROJECT_FILES_MB`       | `1024`          | Room all the files of one project may take up together                       |
| `FILES_DIR`              | `./.data/files` | Where attached files are kept (compose: the `api-data` volume)               |
| `SMTP_URL`               | — (no email)    | `smtp://user:password@host:587`; turns notification emails on                |
| `MAIL_FROM`              | —               | Sender of the emails, e.g. `ChillaDesk <wiki@example.com>`                   |
| `PUBLIC_URL`             | —               | Address people open ChillaDesk at; links in emails and webhooks              |
| `WEBHOOKS_ALLOW_PRIVATE` | `false`         | Let webhooks reach private addresses (a CI server in your network)           |
| `WEB_DIR`                | —               | The built web app, served by the API itself (set in the one-container image) |
| `PUID`, `PGID`           | `1000`          | One-container image: the user that owns `/data` and runs the server          |

### Import and export

Project owners find both on the **Settings** page.

- **Export:** all tasks as CSV (opens in Excel, LibreOffice and Google Sheets), and the wiki
  as a ZIP of Markdown files — a page is `Title.md`, the pages under it are in `Title/`.
  Through the API (`GET /api/projects/{id}/export/tasks.csv`, `…/export/wiki.zip`) any
  member can export.
- **Import of tasks** (up to 1000 per file, 5 MB): CSV exported by ChillaDesk or Jira, or any
  sheet with a `Title` (or `Summary`) column, separated by commas, semicolons or tabs; or
  a Trello board exported as JSON. Statuses are matched by name, then by meaning
  (`Done`, `In Progress`), and otherwise added as new columns; missing labels and
  milestones are created; assignees are found by email or name among the members. Rows that
  cannot become tasks are listed with the reason. Nobody is notified about imported tasks.
  Comments, attachments and history are not imported.

### Webhooks

Project owners add webhooks on the **Settings** page and choose the events: tasks created,
changed (including moves between columns) or deleted, comments added, wiki pages created,
edited or deleted. Each webhook writes in one of three formats:

- **JSON** — the whole event (`event`, `project`, `actor`, `task` with the `changes`,
  `comment` or `page`, and a `url` into the app when `PUBLIC_URL` is set), for your own
  services and CI;
- **Slack** — a message to a Slack incoming webhook (Discord takes it at its webhook address
  ending in `/slack`);
- **Telegram** — a message from your bot: use
  `https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat>` as the address.

Every delivery is signed. The secret is shown once, when the webhook is added. Check
`X-ChillaDesk-Signature: sha256=<hex>`: it is the HMAC-SHA256 of
`<X-ChillaDesk-Timestamp>.<body>`, computed with that secret. Refuse old timestamps.

Deliveries go out within seconds. A failed one is retried after 1, 4, 16, 64 and 256
minutes, and then given up. The settings show how the last delivery went, and **Send test**
sends a test message. A delivery may arrive twice (after a crash mid-send); use the
`X-ChillaDesk-Delivery` id to tell. At most 500 deliveries wait for one webhook, and a
webhook stops when whoever added it no longer owns the project. Addresses are shown
masked, as Slack, Discord and Telegram addresses carry a key.

Webhooks cannot reach private addresses (the server itself, its networks) unless
`WEBHOOKS_ALLOW_PRIVATE=true`, and never cloud metadata addresses. They use ports 80, 443
and 1024 and above, wait at most 5 seconds for an answer, and do not follow redirects.

### Mentions and notifications

Write `@` in a task description, a comment or a wiki page and pick a project member; the
text keeps their email (`@ann@example.com`) and readers see `@Ann`. You get a notification
when someone assigns you a task, mentions you, or comments on or moves a task you watch. You
watch the tasks you created, are assigned to or commented on, and any other you choose to;
you can stop watching any of them. Notifications are listed under the bell in the header.

### Email

Email is optional: set `SMTP_URL`, `MAIL_FROM` and `PUBLIC_URL` together. Then

- **signing up is finished from the email**: the sign-up form answers "check your email"
  whether or not the address already has an account, so it cannot be used to find out who
  is registered. A free address gets a link that, with the password chosen at sign-up,
  confirms it and signs in; the owner of a taken address gets a note instead. The link
  alone confirms nothing, so nobody can claim someone else's address;
- an older account confirms its address from the profile, and **"Forgot your password?"**
  appears on the login page. A reset ends every session and revokes the account's API
  tokens;
- **adding a member by email sends an invite link** to the address instead of adding at
  once, and the answer is the same whether or not the address has an account; they join
  when they open the link;
- **notifications** that were not read in the app are also emailed — only to confirmed
  addresses, at most 30 an hour per person, and not to people who turned them off in
  their profile.

Without these settings nothing is sent, and a forgotten password cannot be recovered.
Accounts created before email was turned on are unconfirmed until their owner asks for the
confirmation email on the profile page. Emails are written in the language of the account.

### Your account

The profile page changes the name, language, notification emails and password, moves the
account to another email address and deletes it. With email set up, a new address gets a
link that makes the change when its owner opens it signed in, and the old address is told.
Deleting the account removes the projects only you are in; in shared projects your tasks,
pages and comments stay, shown as "deleted user". A project with other members needs
another owner first.

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

| Tool                                                      | What it does                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `list_projects`, `get_project`                            | Projects, their columns, labels, open milestones and members               |
| `list_tasks`, `get_task`                                  | Tasks with filters; one task with its checklist, links, files and comments |
| `my_tasks`, `search`                                      | Your tasks, and search, across every project                               |
| `create_task`, `update_task`                              | Create, edit, assign, move and plan tasks (write tokens)                   |
| `add_comment`                                             | Comment on a task (write tokens)                                           |
| `add_checklist_item`, `check_checklist_item`              | Build and tick off the checklist of a task (write tokens)                  |
| `link_tasks`, `watch_task`                                | Link tasks (blocks, duplicates, subtask…); follow a task (write tokens)    |
| `list_milestones`, `create_milestone`, `update_milestone` | Milestones and their progress                                              |
| `create_label`                                            | Add a label to a project (write tokens)                                    |
| `list_notifications`, `mark_notifications_read`           | The token owner's own notifications                                        |
| `list_wiki_pages`, `get_wiki_page`                        | List, search and read wiki pages                                           |
| `create_wiki_page`, `update_wiki_page`                    | Write wiki pages, keeping history (write tokens)                           |

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
pnpm e2e          # browser tests (Playwright) against a fresh API and web app
```

The browser tests start their own API (on an empty embedded database) and web app. The
first time, install a browser with `pnpm --filter @chilladesk/e2e exec playwright install
chromium`, or use one you have: `PW_CHANNEL=msedge pnpm e2e` (or `chrome`).

The screenshots in `docs/screenshots` come from
`node apps/e2e/scripts/screenshots.mjs http://localhost:8090`, run against an empty,
throwaway installation: it signs up demo accounts and fills in a demo project first.

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
