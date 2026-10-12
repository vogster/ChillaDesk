import {
  commentRequestSchema,
  createTaskRequestSchema,
  createWikiPageRequestSchema,
  dueDateSchema,
  taskListQuerySchema,
  taskPrioritySchema,
  updateTaskRequestSchema,
  updateWikiPageRequestSchema,
  wikiListQuerySchema,
  type Status,
  type Task,
  type WikiPage,
} from '@chillawiki/shared'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { AppError, forbidden, invalid } from '../../errors'
import { loggableError } from '../../http/error-handler'
import type { AuthContext } from '../auth/service'
import { listLabels } from '../labels/service'
import { listMembers, listProjects } from '../projects/service'
import { addComment, listComments } from '../tasks/comments.service'
import { createTask, listTasks, moveTask, updateTask } from '../tasks/service'
import { listStatuses } from '../tasks/statuses.service'
import { createPage, listPages, updatePage } from '../wiki/service'
import {
  labelsByName,
  memberByEmail,
  projectByKey,
  statusByName,
  taskByKey,
  wikiPageByTitle,
} from './resolve'

export interface ToolContext {
  db: Db
  auth: AuthContext
}

export interface ToolDefinition {
  name: string
  title: string
  description: string
  /** Read tools are open to read-only tokens; the rest need write access. */
  readOnly: boolean
  inputSchema: z.ZodRawShape
  run(input: never, context: ToolContext): Promise<unknown>
}

function tool<Shape extends z.ZodRawShape>(definition: {
  name: string
  title: string
  description: string
  readOnly: boolean
  inputSchema: Shape
  run(input: z.infer<z.ZodObject<Shape>>, context: ToolContext): Promise<unknown>
}): ToolDefinition {
  return definition as ToolDefinition
}

/**
 * Checks tool input against the schema the REST API uses for the same operation, so both
 * doors accept exactly the same data and a model gets a message it can act on.
 */
function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const problems = result.error.issues
    .map((issue) => [issue.path.join('.'), issue.message].filter(Boolean).join(': '))
    .join('; ')
  throw invalid(`Invalid input: ${problems}`)
}

const project = z.string().describe('Project key, e.g. "CHL". Use list_projects to see them.')
const taskKey = z.string().describe('Task key: project key, dash, number, e.g. "CHL-12".')

const statusName = (statuses: Status[], statusId: string) =>
  statuses.find((status) => status.id === statusId)?.name ?? 'Unknown'

/** A task as an agent needs it: names instead of ids, nothing internal. */
function describeTask(task: Task, statuses: Status[]) {
  return {
    key: task.key,
    title: task.title,
    status: statusName(statuses, task.statusId),
    priority: task.priority,
    assignee: task.assignee?.email ?? null,
    reporter: task.reporter?.email ?? null,
    dueDate: task.dueDate,
    labels: task.labels.map((label) => label.name),
    description: task.description,
    updatedAt: task.updatedAt,
  }
}

const describePage = (page: WikiPage) => ({
  title: page.title,
  version: page.version,
  content: page.content,
  updatedBy: page.updatedBy?.email ?? null,
  updatedAt: page.updatedAt,
})

export const TOOLS: ToolDefinition[] = [
  tool({
    name: 'list_projects',
    title: 'List projects',
    description: 'Projects the token owner belongs to, with the role they have in each.',
    readOnly: true,
    inputSchema: {},
    run: async (_input, { db, auth }) =>
      (await listProjects(db, auth.user.id)).map(({ key, name, description, role }) => ({
        key,
        name,
        description,
        role,
      })),
  }),

  tool({
    name: 'get_project',
    title: 'Get project',
    description:
      'A project with its board statuses (columns, left to right), labels and members. ' +
      'Call this before creating or moving tasks to learn the valid status names, label names and assignee emails.',
    readOnly: true,
    inputSchema: { project },
    run: async (input, { db, auth }) => {
      const found = await projectByKey(db, auth.user.id, input.project)
      const [statuses, members, labels] = await Promise.all([
        listStatuses(db, auth.user.id, found.id),
        listMembers(db, auth.user.id, found.id),
        listLabels(db, auth.user.id, found.id),
      ])
      return {
        key: found.key,
        name: found.name,
        description: found.description,
        yourRole: found.role,
        statuses: statuses.map(({ name, category }) => ({ name, category })),
        labels: labels.map((label) => label.name),
        members: members.map(({ name, email, role }) => ({ name, email, role })),
      }
    },
  }),

  tool({
    name: 'list_tasks',
    title: 'List tasks',
    description:
      'Tasks of a project in board order, optionally filtered. Descriptions are left out; use get_task for one task in full.',
    readOnly: true,
    inputSchema: {
      project,
      status: z.string().optional().describe('Only tasks in the status with this name.'),
      assignee: z
        .string()
        .optional()
        .describe('Email of the assignee, or "none" for unassigned tasks.'),
      priority: taskPrioritySchema.optional(),
      label: z.string().optional().describe('Only tasks that carry the label with this name.'),
      query: z.string().optional().describe('Text to look for in titles and descriptions.'),
      limit: z.number().int().min(1).max(200).default(50),
    },
    run: async (input, { db, auth }) => {
      const userId = auth.user.id
      const found = await projectByKey(db, userId, input.project)
      const statuses = await listStatuses(db, userId, found.id)
      const assigneeId =
        input.assignee === undefined || input.assignee === 'none'
          ? input.assignee
          : (await memberByEmail(db, userId, found.id, input.assignee)).userId
      const filters = validate(taskListQuerySchema, {
        limit: input.limit,
        offset: 0,
        ...(input.status
          ? { statusId: (await statusByName(db, userId, found.id, input.status)).id }
          : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(input.priority ? { priority: input.priority } : {}),
        ...(input.label
          ? { labelId: (await labelsByName(db, userId, found.id, [input.label]))[0]?.id }
          : {}),
        ...(input.query?.trim() ? { q: input.query.trim() } : {}),
      })
      const list = await listTasks(db, userId, found.id, filters)
      return {
        total: list.total,
        tasks: list.items.map((task) => {
          const { description: _description, ...summary } = describeTask(task, statuses)
          return summary
        }),
      }
    },
  }),

  tool({
    name: 'get_task',
    title: 'Get task',
    description: 'One task in full, with its Markdown description and comments.',
    readOnly: true,
    inputSchema: { key: taskKey },
    run: async (input, { db, auth }) => {
      const userId = auth.user.id
      const { project: found, task } = await taskByKey(db, userId, input.key)
      const [statuses, comments] = await Promise.all([
        listStatuses(db, userId, found.id),
        listComments(db, userId, found.id, task.id),
      ])
      return {
        ...describeTask(task, statuses),
        comments: comments.map((comment) => ({
          author: comment.author?.email ?? null,
          body: comment.body,
          createdAt: comment.createdAt,
        })),
      }
    },
  }),

  tool({
    name: 'create_task',
    title: 'Create task',
    description: 'Creates a task at the end of a status column (the first column by default).',
    readOnly: false,
    inputSchema: {
      project,
      title: z.string().min(1).max(200),
      description: z.string().max(20_000).optional().describe('Markdown.'),
      status: z.string().optional().describe('Status name; see get_project.'),
      priority: taskPrioritySchema.optional(),
      assignee: z.string().optional().describe('Email of a project member.'),
      dueDate: dueDateSchema.optional().describe('YYYY-MM-DD'),
      labels: z.array(z.string()).optional().describe('Names of existing labels; see get_project.'),
    },
    run: async (input, { db, auth }) => {
      const userId = auth.user.id
      const found = await projectByKey(db, userId, input.project)
      const status = input.status
        ? await statusByName(db, userId, found.id, input.status)
        : undefined
      const assignee = input.assignee
        ? await memberByEmail(db, userId, found.id, input.assignee)
        : undefined
      const request = validate(createTaskRequestSchema, {
        title: input.title,
        description: input.description,
        priority: input.priority,
        assigneeId: assignee?.userId ?? null,
        dueDate: input.dueDate ?? null,
        statusId: status?.id,
        labelIds: (await labelsByName(db, userId, found.id, input.labels ?? [])).map(
          (label) => label.id,
        ),
      })
      const task = await createTask(db, userId, found.id, request)
      return describeTask(task, await listStatuses(db, userId, found.id))
    },
  }),

  tool({
    name: 'update_task',
    title: 'Update task',
    description:
      'Changes the given fields of a task and leaves the rest. Setting `status` moves the task to the end of that column.',
    readOnly: false,
    inputSchema: {
      key: taskKey,
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(20_000).optional().describe('Markdown; replaces the old text.'),
      status: z.string().optional().describe('Status name; see get_project.'),
      priority: taskPrioritySchema.optional(),
      assignee: z
        .string()
        .nullable()
        .optional()
        .describe('Email of a project member, or null to unassign.'),
      dueDate: dueDateSchema.nullable().optional().describe('YYYY-MM-DD, or null to clear.'),
      labels: z
        .array(z.string())
        .optional()
        .describe('The complete new set of label names; an empty list removes all labels.'),
    },
    run: async (input, { db, auth }) => {
      const userId = auth.user.id
      const { project: found, task } = await taskByKey(db, userId, input.key)
      const assigneeId =
        input.assignee === undefined || input.assignee === null
          ? input.assignee
          : (await memberByEmail(db, userId, found.id, input.assignee)).userId
      const changes = {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(assigneeId !== undefined ? { assigneeId } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.labels !== undefined
          ? {
              labelIds: (await labelsByName(db, userId, found.id, input.labels)).map(
                (label) => label.id,
              ),
            }
          : {}),
      }

      // Everything is checked before the first write, so a bad status name cannot leave
      // the task half updated.
      const status =
        input.status !== undefined
          ? await statusByName(db, userId, found.id, input.status)
          : undefined
      const patch =
        Object.keys(changes).length > 0 ? validate(updateTaskRequestSchema, changes) : undefined

      let updated = task
      if (patch) updated = await updateTask(db, userId, found.id, task.id, patch)
      if (status) {
        if (status.id !== updated.statusId) {
          updated = await moveTask(db, userId, found.id, task.id, {
            statusId: status.id,
            beforeTaskId: null,
          })
        }
      }
      return describeTask(updated, await listStatuses(db, userId, found.id))
    },
  }),

  tool({
    name: 'add_comment',
    title: 'Comment on task',
    description: 'Adds a Markdown comment to a task.',
    readOnly: false,
    inputSchema: { key: taskKey, body: z.string().min(1).max(10_000) },
    run: async (input, { db, auth }) => {
      const { project: found, task } = await taskByKey(db, auth.user.id, input.key)
      const request = validate(commentRequestSchema, { body: input.body })
      const comment = await addComment(db, auth.user.id, found.id, task.id, request)
      return { task: task.key, body: comment.body, createdAt: comment.createdAt }
    },
  }),

  tool({
    name: 'list_wiki_pages',
    title: 'List or search wiki pages',
    description:
      'Wiki pages of a project by title, with the title of each page’s parent. Pass `query` to search titles and content.',
    readOnly: true,
    inputSchema: {
      project,
      query: z.string().optional().describe('Text to look for in titles and content.'),
    },
    run: async (input, { db, auth }) => {
      const userId = auth.user.id
      const found = await projectByKey(db, userId, input.project)
      const all = await listPages(db, userId, found.id, {})
      const titles = new Map(all.map((page) => [page.id, page.title]))
      const query = input.query?.trim()
      const pages = query
        ? await listPages(db, userId, found.id, validate(wikiListQuerySchema, { q: query }))
        : all
      return pages.map((page) => ({
        title: page.title,
        parent: page.parentId ? (titles.get(page.parentId) ?? null) : null,
        updatedAt: page.updatedAt,
      }))
    },
  }),

  tool({
    name: 'get_wiki_page',
    title: 'Get wiki page',
    description:
      'A wiki page with its Markdown content. `[[Title]]` in the text links to another page of the project; a task key such as CHL-12 refers to a task.',
    readOnly: true,
    inputSchema: { project, title: z.string().describe('Page title, case-insensitive.') },
    run: async (input, { db, auth }) => {
      const found = await projectByKey(db, auth.user.id, input.project)
      return describePage(await wikiPageByTitle(db, auth.user.id, found.id, input.title))
    },
  }),

  tool({
    name: 'create_wiki_page',
    title: 'Create wiki page',
    description: 'Creates a wiki page. Titles are unique within a project.',
    readOnly: false,
    inputSchema: {
      project,
      title: z.string().min(1).max(150),
      content: z.string().max(200_000).default('').describe('Markdown.'),
      parent: z.string().optional().describe('Title of the page to nest this one under.'),
    },
    run: async (input, { db, auth }) => {
      const userId = auth.user.id
      const found = await projectByKey(db, userId, input.project)
      const parent = input.parent
        ? await wikiPageByTitle(db, userId, found.id, input.parent)
        : undefined
      const request = validate(createWikiPageRequestSchema, {
        title: input.title,
        content: input.content,
        parentId: parent?.id ?? null,
      })
      return describePage(await createPage(db, userId, found.id, request))
    },
  }),

  tool({
    name: 'update_wiki_page',
    title: 'Update wiki page',
    description:
      'Replaces the content and/or title of a wiki page; the previous text stays in its history. ' +
      'Pass the `version` you got from get_wiki_page as `baseVersion` to avoid overwriting a change made since.',
    readOnly: false,
    inputSchema: {
      project,
      title: z.string().describe('Current title of the page.'),
      content: z.string().max(200_000).optional().describe('New Markdown content.'),
      newTitle: z.string().min(1).max(150).optional(),
      baseVersion: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe('Version the edit is based on. Omit to overwrite whatever is there.'),
    },
    run: async (input, { db, auth }) => {
      const userId = auth.user.id
      const found = await projectByKey(db, userId, input.project)
      const page = await wikiPageByTitle(db, userId, found.id, input.title)
      if (input.content === undefined && input.newTitle === undefined) return describePage(page)
      const request = validate(updateWikiPageRequestSchema, {
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.newTitle !== undefined ? { title: input.newTitle } : {}),
        baseVersion: input.baseVersion ?? page.version,
      })
      return describePage(await updatePage(db, userId, found.id, page.id, request))
    },
  }),
]

/** Runs a tool for the caller, refusing write tools to a read-only token. */
export function runTool(
  definition: ToolDefinition,
  input: unknown,
  context: ToolContext,
): Promise<unknown> {
  if (!definition.readOnly && context.auth.apiToken?.scope === 'read') {
    throw forbidden(`This API token is read-only and cannot use ${definition.name}`)
  }
  return definition.run(input as never, context)
}

// A type alias, not an interface: the SDK's result type has an index signature, which only
// an alias is assignable to.
export type ToolResult = {
  isError?: true
  content: { type: 'text'; text: string }[]
}

const textResult = (text: string, isError = false): ToolResult => ({
  ...(isError ? { isError: true as const } : {}),
  content: [{ type: 'text', text }],
})

/**
 * Runs a tool and turns the outcome into an MCP tool result.
 *
 * Expected failures (not found, no access, bad name) go back to the model as an error it
 * can read and correct. Anything else is a fault: its message can hold SQL and bound
 * parameters, so it is logged without them and the client only learns that it failed.
 */
export async function runToolForClient(
  definition: ToolDefinition,
  input: unknown,
  context: ToolContext,
  log: { error(details: object, message: string): void },
): Promise<ToolResult> {
  try {
    return textResult(JSON.stringify(await runTool(definition, input, context), null, 2))
  } catch (error) {
    if (error instanceof AppError) return textResult(error.message, true)
    log.error(
      loggableError(error instanceof Error ? error : new Error(String(error))),
      `MCP tool ${definition.name} failed`,
    )
    return textResult('Internal server error', true)
  }
}
