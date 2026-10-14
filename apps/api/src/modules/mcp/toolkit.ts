import type { LiveResource, Status, Task, TaskInContext, WikiPage } from '@chilladesk/shared'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { invalid } from '../../errors'
import type { AuthContext } from '../auth/service'

export interface ToolContext {
  db: Db
  auth: AuthContext
  /** Write tools report the project they changed, so open screens can refresh. */
  changed?(projectId: string, resource: LiveResource): void
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

export function tool<Shape extends z.ZodRawShape>(definition: {
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
export function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  const problems = result.error.issues
    .map((issue) => [issue.path.join('.'), issue.message].filter(Boolean).join(': '))
    .join('; ')
  throw invalid(`Invalid input: ${problems}`)
}

export const project = z
  .string()
  .describe('Project key, e.g. "CHL". Use list_projects to see them.')
export const taskKey = z.string().describe('Task key: project key, dash, number, e.g. "CHL-12".')

export const statusName = (statuses: Status[], statusId: string) =>
  statuses.find((status) => status.id === statusId)?.name ?? 'Unknown'

/** A task as an agent needs it: names instead of ids, nothing internal. */
export function describeTask(task: Task, statuses: Status[]) {
  return {
    key: task.key,
    title: task.title,
    status: statusName(statuses, task.statusId),
    priority: task.priority,
    assignee: task.assignee?.email ?? null,
    reporter: task.reporter?.email ?? null,
    dueDate: task.dueDate,
    labels: task.labels.map((label) => label.name),
    milestone: task.milestone?.name ?? null,
    description: task.description,
    updatedAt: task.updatedAt,
  }
}

/** A task found outside one project: its status comes with it, and its description is left out. */
export function describeTaskInContext(task: TaskInContext) {
  const { description: _description, ...summary } = describeTask(task, [task.status])
  return { project: task.project.key, ...summary }
}

export const describePage = (page: WikiPage) => ({
  title: page.title,
  version: page.version,
  content: page.content,
  updatedBy: page.updatedBy?.email ?? null,
  updatedAt: page.updatedAt,
})
