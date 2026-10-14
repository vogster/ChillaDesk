import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

export const projectRole = pgEnum('project_role', ['owner', 'member', 'viewer'])
export const statusCategory = pgEnum('status_category', ['todo', 'in_progress', 'done'])
export const taskPriority = pgEnum('task_priority', ['low', 'medium', 'high', 'urgent'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Always stored lowercased. */
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  /** `en` or `ru`; null until an interface has reported the user's language. */
  locale: text('locale'),
  emailNotifications: boolean('email_notifications').notNull().default(true),
  /** When the user proved the address is theirs; null until then. */
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  /**
   * Set while a sign-up made with email on is unfinished: the address is not confirmed yet
   * and nobody can sign in to the account. Null for every account in use.
   */
  pendingSince: timestamp('pending_since', { withTimezone: true }),
  createdAt: createdAt(),
})

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 of the session token; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)],
)

/** Single-use links sent by email: confirming an address, choosing a new password. */
export const emailTokens = pgTable(
  'email_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** `verify`, `reset` or `change` (of the address). */
    kind: text('kind').notNull(),
    /** For `change`: the address the link was sent to, which becomes the account's. */
    newEmail: text('new_email'),
    /** SHA-256 of the token in the link; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('email_tokens_user_id_idx').on(table.userId)],
)

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  /** Number given to the most recently created task; task numbers are never reused. */
  taskCounter: integer('task_counter').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const projectMembers = pgTable(
  'project_members',
  {
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: projectRole('role').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.projectId, table.userId] }),
    index('project_members_user_id_idx').on(table.userId),
  ],
)

/** A link that lets whoever opens it join a project. */
export const projectInvites = pgTable(
  'project_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** `member` or `viewer`; never `owner`. */
    role: projectRole('role').notNull(),
    /** SHA-256 of the token in the link; the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('project_invites_project_id_idx').on(table.projectId)],
)

/** A board column. */
export const statuses = pgTable(
  'statuses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    category: statusCategory('category').notNull(),
    position: integer('position').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('statuses_project_id_idx').on(table.projectId, table.position)],
)

/** A point the project works towards; tasks are put on it. */
export const milestones = pgTable(
  'milestones',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    dueDate: date('due_date', { mode: 'string' }),
    /** Set when the milestone was closed; null while it is open. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('milestones_project_name_idx').on(table.projectId, table.name)],
)

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    // A status that still has tasks cannot be deleted; the API asks to move them first.
    statusId: uuid('status_id')
      .notNull()
      .references(() => statuses.id, { onDelete: 'restrict' }),
    priority: taskPriority('priority').notNull().default('medium'),
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    dueDate: date('due_date', { mode: 'string' }),
    milestoneId: uuid('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
    /** Sort key within the status column; gaps let a move touch a single row. */
    position: doublePrecision('position').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('tasks_project_number_idx').on(table.projectId, table.number),
    index('tasks_board_idx').on(table.projectId, table.statusId, table.position),
    // Column lookups (end of column, neighbours, "is this status in use") filter by status only.
    index('tasks_status_position_idx').on(table.statusId, table.position),
    index('tasks_assignee_id_idx').on(table.assigneeId),
    index('tasks_milestone_id_idx').on(table.milestoneId),
  ],
)

/** A file attached to a task or a wiki page; its bytes are in the file store. */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** Exactly one of the next two is set. */
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    wikiPageId: uuid('wiki_page_id').references(() => wikiPages.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    /** Name of the file in the store: random, never derived from what the user sent. */
    storageKey: text('storage_key').notNull().unique(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    index('attachments_task_idx').on(table.taskId),
    index('attachments_wiki_page_idx').on(table.wikiPageId),
    check('attachments_one_owner', sql`(${table.taskId} is null) <> (${table.wikiPageId} is null)`),
  ],
)

/** A named set of task-list filters; each person has their own per project. */
export const savedFilters = pgTable(
  'saved_filters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** The query string of the list, as the web app builds it. */
    query: text('query').notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('saved_filters_name_idx').on(table.userId, table.projectId, table.name)],
)

/** One line of a task's checklist. */
export const checklistItems = pgTable(
  'checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    done: boolean('done').notNull().default(false),
    /** Order within the task; new items go to the end. */
    position: integer('position').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('checklist_items_task_idx').on(table.taskId, table.position)],
)

/** What the source task is to the target task. */
export const taskLinkKind = pgEnum('task_link_kind', [
  'blocks',
  'duplicates',
  'subtask_of',
  'relates_to',
])

/** A link between two tasks of one project. */
export const taskLinks = pgTable(
  'task_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceTaskId: uuid('source_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    targetTaskId: uuid('target_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    kind: taskLinkKind('kind').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('task_links_pair_idx').on(table.sourceTaskId, table.targetTaskId),
    index('task_links_target_idx').on(table.targetTaskId),
  ],
)

/** People who follow a task and are told about its comments and moves. */
export const taskWatchers = pgTable(
  'task_watchers',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.userId] }),
    index('task_watchers_user_id_idx').on(table.userId),
  ],
)

/** The history of a task: one row per thing that changed. */
export const taskEvents = pgTable(
  'task_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Keeps entries written in the same instant in the order they were written. */
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** A `TaskChange` from the shared package. */
    change: jsonb('change').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('task_events_task_idx').on(table.taskId, table.createdAt)],
)

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('comments_task_id_idx').on(table.taskId, table.createdAt)],
)

export const wikiPages = pgTable(
  'wiki_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    // The API moves children up before deleting a page; SET NULL is the safety net.
    parentId: uuid('parent_id').references((): AnyPgColumn => wikiPages.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    content: text('content').notNull().default(''),
    /** Grows by one with every saved change to the title or content. */
    version: integer('version').notNull().default(1),
    updatedById: uuid('updated_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // `[[Title]]` links are resolved by title, so a title is unique per project, ignoring case.
    uniqueIndex('wiki_pages_project_title_idx').on(table.projectId, sql`lower(${table.title})`),
    index('wiki_pages_parent_id_idx').on(table.parentId),
  ],
)

/** Every saved state of a page, including the current one. */
export const wikiPageVersions = pgTable(
  'wiki_page_versions',
  {
    pageId: uuid('page_id')
      .notNull()
      .references(() => wikiPages.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.pageId, table.version] })],
)

export const apiTokenScope = pgEnum('api_token_scope', ['read', 'write'])

/** Personal access tokens for scripts and AI agents (MCP). */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** SHA-256 of the token; the token itself is shown once and never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    scope: apiTokenScope('scope').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index('api_tokens_user_id_idx').on(table.userId)],
)

export const labelColor = pgEnum('label_color', [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'blue',
  'purple',
  'pink',
])

export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: labelColor('color').notNull().default('gray'),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('labels_project_name_idx').on(table.projectId, sql`lower(${table.name})`),
  ],
)

export const taskLabels = pgTable(
  'task_labels',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.labelId] }),
    index('task_labels_label_id_idx').on(table.labelId),
  ],
)

export const notificationType = pgEnum('notification_type', [
  'task_assigned',
  'task_commented',
  'mentioned',
  'task_moved',
])

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The recipient. */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationType('type').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    wikiPageId: uuid('wiki_page_id').references(() => wikiPages.id, { onDelete: 'cascade' }),
    excerpt: text('excerpt').notNull().default(''),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** Set once the email went out, or once it was decided not to send one. */
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    /** Whether an email really went out; counted to cap how many one person gets. */
    emailSent: boolean('email_sent').notNull().default(false),
    emailAttempts: integer('email_attempts').notNull().default(0),
    /** While sending: nobody else tries before this. After a failure: when to retry. */
    emailNextAttemptAt: timestamp('email_next_attempt_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index('notifications_user_idx').on(table.userId, table.createdAt),
    // The mail worker looks for rows that still need an email.
    index('notifications_outbox_idx')
      .on(table.createdAt)
      .where(sql`${table.emailedAt} is null`),
  ],
)

export const webhookFormat = pgEnum('webhook_format', ['json', 'slack', 'telegram'])

/** An address told about what happens in a project. */
export const webhooks = pgTable(
  'webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    format: webhookFormat('format').notNull().default('json'),
    /** Names of the events it is told about, such as `task.created`. */
    events: text('events').array().notNull(),
    /** Deliveries are signed with it, so the receiver can tell them from forgeries. */
    secret: text('secret').notNull(),
    active: boolean('active').notNull().default(true),
    /** The owner who added it; deliveries stop once they no longer own the project. */
    createdById: uuid('created_by_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [index('webhooks_project_id_idx').on(table.projectId)],
)

export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', [
  'pending',
  'delivered',
  'failed',
])

/** An event waiting to be sent to a webhook, or how sending it went. */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    /** The event as it was when it happened; written out in the webhook's format when sent. */
    payload: jsonb('payload').notNull(),
    status: webhookDeliveryStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** While sending: nobody else tries before this. After a failure: when to retry. */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    responseStatus: integer('response_status'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (table) => [
    index('webhook_deliveries_webhook_idx').on(table.webhookId, table.createdAt),
    // The delivery worker looks for rows that are still to be sent.
    index('webhook_deliveries_outbox_idx')
      .on(table.nextAttemptAt)
      .where(sql`${table.status} = 'pending'`),
  ],
)

/**
 * Counts of attempts per key in fixed windows: logins per account, emails per account.
 * Kept in the database so the limits hold across restarts and API replicas.
 */
export const attemptCounters = pgTable(
  'attempt_counters',
  {
    /** What is counted, hashed: it may hold an email address. */
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('attempt_counters_reset_at_idx').on(table.resetAt)],
)
