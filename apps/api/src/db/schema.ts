import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  date,
  doublePrecision,
  index,
  integer,
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
  ],
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
