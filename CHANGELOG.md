# Changelog

## 0.3.0

- One-container image `ghcr.io/vogster/chilladesk` for a single `docker run`: the API serves the
  web app, the data is in one folder (embedded database unless `DATABASE_URL` is set),
  `PUID`/`PGID` choose who owns it.
- `deploy/docker-compose.yml` installs the full stack with PostgreSQL from the published
  images, without the source code.
- Screenshots in the README; the app is wider, so a board with four columns fits.
- Sign-up by invitation only: `REGISTRATION_ENABLED=invite` lets people sign up only through an
  invite link, which also puts them into its project. The first account of a new server
  needs no invite.

## 0.2.0

The project is now called **ChillaDesk** (it was ChillaWiki). An existing installation keeps
its data: the Docker Compose project and the database keep their old name.

### Tasks and boards

- Labels, checklists, links between tasks (blocks, duplicates, subtask, relates), milestones
  with progress, and a history of every change of a task.
- Watching tasks; @mentions in descriptions, comments and wiki pages; notifications in the
  app and, with SMTP set up, by email in the language of the recipient.
- The task list sorts, keeps saved filters and changes or deletes many tasks at once.
- Files attached to tasks and wiki pages; pictures are shown in the text.
- Cards move between columns with the keyboard in one press, and the move is announced.

### Working together

- Live updates: boards, tasks and pages refresh as teammates change them, also across
  several API replicas.
- Invite links, and people are told when their access to a project changes.
- "My tasks" and search across all projects.
- A Russian interface with a language switcher; the language is kept on the account.

### Accounts

- A profile page: name, language, notification emails, password, a new email address, and
  deleting the account.
- Email confirmation and password reset when SMTP is set up. Signing up and adding members
  then answer the same whether or not an address has an account, so neither can be used
  to find out who is registered.
- Limits on logins and account emails are kept in the database.

### Integrations

- Webhooks for task, comment and wiki events in JSON (signed), Slack, Discord or Telegram
  format, with retries and protection against calls into the server's own network.
- Import of tasks from CSV (our own, Jira) and Trello; export of tasks to CSV and the wiki to
  a ZIP of Markdown files.
- More MCP tools: milestones, checklists, links, labels, watching and notifications.

### Running it

- Docker images on `ghcr.io/vogster/chilladesk-api` and `-web` for every version tag;
  `docker compose pull` installs without building.
- New settings: `WEBHOOKS_ALLOW_PRIVATE`, `AUTH_RATE_LIMIT_MAX`, `MAX_UPLOAD_MB`,
  `PROJECT_FILES_MB`, `FILES_DIR`, and `SMTP_URL`, `MAIL_FROM`, `PUBLIC_URL` for email.
- The web app loads a third less on the first visit.
- Browser tests (Playwright) and an end-to-end check of the whole stack run in CI.
- Fixed: deleting a board column while tasks moved into it could fail with an error.

## 0.1.0

The first usable release: projects with members and roles, tasks with a list and a kanban
board, a Markdown wiki with versions and links, personal API tokens, an MCP server for AI
assistants, and a Docker Compose setup.
