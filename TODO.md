# TODO

What ChillaDesk still needs, roughly in the order it would hurt a real team. Tick an item
when it is merged; move anything that turns out to be a bad idea to the bottom with a reason.

## Gaps in what already exists

- [x] **Profile** — change your name, password and language; turn notification emails off.
- [x] **Default columns in the user's language** — a new project always gets
      "To Do / In Progress / Done".
- [x] **Live events for lost access** — deleting a project or removing a member does not
      refresh the screens of the people affected.
- [x] **Invite links** — today only someone who already has an account can be added, by email.
- [x] **Email verification and password reset** — a forgotten password cannot be recovered,
      and with open registration notification emails can be aimed at someone else's address.

## Tasks

- [x] **Attachments** — files and images in tasks and wiki pages (images in Markdown are
      switched off entirely for now).
- [x] **Subtasks and checklists**; links between tasks ("blocks", "duplicates").
- [x] **Task history** — who changed the assignee, column or due date, and when. The wiki has
      history, tasks do not.
- [x] **Watching a task** — only the creator and the assignee are notified today.
- [x] **Saved filters and sorting** in the list; bulk actions on several tasks.
- [x] **Sprints or milestones** with a simple report.

- [ ] **Pasting and dropping pictures** straight into a description, comment or page (today a
      picture is attached first and its Markdown copied from the list).
- [ ] **Attachments in S3-compatible storage**, for installations with several API replicas.
- [ ] **Reordering and rewording checklist items**; checklist and link changes in the history.

## Integrations

- [ ] **Webhooks** for project events — the base for Telegram, Slack and CI.
- [x] **MCP tools** for labels, notifications and members.
- [ ] **Import and export** — CSV for tasks, a Markdown archive for the wiki, import from
      Jira or Trello.

## Quality and release

- [ ] **Publish on GitHub** — the repository is local only, CI has never run, there are no
      prebuilt Docker images.
- [ ] **Browser tests (Playwright)** — browser scenarios are checked by hand so far.
- [ ] **Smaller web bundle** — about 700 kB in one file; split it by page.
- [ ] **Dragging on a phone and with the keyboard** — not checked on real devices; moving a
      card between columns with the keyboard looked wrong in a simulation.
- [ ] **Version 0.2.0** — six large features since 0.1.0, same version and tag.
- [ ] **Several API replicas** — live events are delivered inside one process; more than one
      replica needs PostgreSQL LISTEN/NOTIFY or similar.
- [ ] **Server texts in the user's language** — error texts of the API and notification
      emails are English (confirmation and reset emails follow the account's language; the
      web app translates the error texts it knows).
- [ ] **Changing the email address** of an account, and **deleting an account**.
- [ ] **Registration tells whether an address has an account** ("already exists"); answer
      the same either way and email the owner instead.
- [ ] **Email limits in the database** — the per-account limit on confirmation and reset
      emails is kept in memory, so it resets on restart and is per API replica.
