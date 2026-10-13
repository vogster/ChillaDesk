import { z } from 'zod'
import { emailSchema, textSchema } from './auth'
import { labelIdsSchema, labelSchema } from './labels'
import { checklistProgressSchema } from './task-extras'

/** What a column means, whatever it is called: lets clients tell open work from finished. */
export const statusCategorySchema = z.enum(['todo', 'in_progress', 'done'])
export type StatusCategory = z.infer<typeof statusCategorySchema>

const statusNameSchema = textSchema.trim().min(1).max(40)

export const statusSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: statusCategorySchema,
  /** Zero-based column index on the board. */
  position: z.number().int(),
})
export type Status = z.infer<typeof statusSchema>

export const createStatusRequestSchema = z.object({
  name: statusNameSchema,
  category: statusCategorySchema.default('todo'),
})
export type CreateStatusRequest = z.infer<typeof createStatusRequestSchema>

export const updateStatusRequestSchema = z
  .object({ name: statusNameSchema.optional(), category: statusCategorySchema.optional() })
  .refine((patch) => Object.keys(patch).length > 0, 'At least one field is required')
export type UpdateStatusRequest = z.infer<typeof updateStatusRequestSchema>

/** Every status id of the project, in the new left-to-right order. */
export const reorderStatusesRequestSchema = z.object({ statusIds: z.array(z.uuid()).min(1) })
export type ReorderStatusesRequest = z.infer<typeof reorderStatusesRequestSchema>

export const taskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent'])
export type TaskPriority = z.infer<typeof taskPrioritySchema>

/**
 * Calendar date, `YYYY-MM-DD`. The year range keeps out typos and half-typed values such as
 * `0002-05-17`, and year 0000, which PostgreSQL cannot store.
 */
export const dueDateSchema = z.iso
  .date()
  .refine((date) => date >= '1900-01-01' && date <= '2999-12-31', 'Year must be 1900-2999')

export const userSummarySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: emailSchema,
})
export type UserSummary = z.infer<typeof userSummarySchema>

export const taskSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  /** Sequential within the project. */
  number: z.number().int(),
  /** Project key plus number, e.g. `CHL-12`. */
  key: z.string(),
  title: z.string(),
  /** Markdown. */
  description: z.string(),
  statusId: z.uuid(),
  priority: taskPrioritySchema,
  assignee: userSummarySchema.nullable(),
  /** Null when the author's account was deleted. */
  reporter: userSummarySchema.nullable(),
  dueDate: dueDateSchema.nullable(),
  /** Sorted by name. */
  labels: z.array(labelSchema),
  /** Zero of zero for a task without a checklist. */
  checklist: checklistProgressSchema,
  /** Sort key within the status column; only the order is meaningful. */
  position: z.number(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type Task = z.infer<typeof taskSchema>

const taskTitleSchema = textSchema.trim().min(1).max(200)
const taskDescriptionSchema = textSchema.max(20_000)

export const createTaskRequestSchema = z.object({
  title: taskTitleSchema,
  description: taskDescriptionSchema.default(''),
  /** Defaults to the first column of the board. */
  statusId: z.uuid().optional(),
  priority: taskPrioritySchema.default('medium'),
  assigneeId: z.uuid().nullable().default(null),
  dueDate: dueDateSchema.nullable().default(null),
  labelIds: labelIdsSchema.default([]),
})
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>

export const updateTaskRequestSchema = z
  .object({
    title: taskTitleSchema.optional(),
    description: taskDescriptionSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assigneeId: z.uuid().nullable().optional(),
    dueDate: dueDateSchema.nullable().optional(),
    /** The complete new set of labels. */
    labelIds: labelIdsSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'At least one field is required')
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>

export const moveTaskRequestSchema = z.object({
  statusId: z.uuid(),
  /** The task that should come right after the moved one; null puts it at the end. */
  beforeTaskId: z.uuid().nullable().default(null),
})
export type MoveTaskRequest = z.infer<typeof moveTaskRequestSchema>

export const TASK_PAGE_MAX = 500

/** `board` is the order of the board: column by column, top to bottom. */
export const taskSortSchema = z.enum([
  'board',
  'number',
  'title',
  'priority',
  'due',
  'updated',
  'created',
])
export type TaskSort = z.infer<typeof taskSortSchema>

export const sortOrderSchema = z.enum(['asc', 'desc'])
export type SortOrder = z.infer<typeof sortOrderSchema>

export const taskListQuerySchema = z.object({
  statusId: z.uuid().optional(),
  /** A user id, or `none` for unassigned tasks. */
  assigneeId: z.union([z.uuid(), z.literal('none')]).optional(),
  priority: taskPrioritySchema.optional(),
  /** Only tasks that carry this label. */
  labelId: z.uuid().optional(),
  /** Case-insensitive match in the title or description. */
  q: textSchema.trim().min(1).max(200).optional(),
  sort: taskSortSchema.default('board'),
  /** Tasks without a due date come last either way. */
  order: sortOrderSchema.default('asc'),
  limit: z.coerce.number().int().min(1).max(TASK_PAGE_MAX).default(TASK_PAGE_MAX),
  offset: z.coerce.number().int().min(0).default(0),
})
export type TaskListQuery = z.infer<typeof taskListQuerySchema>

export const taskListSchema = z.object({
  items: z.array(taskSchema),
  /** Number of tasks matching the filters, ignoring `limit` and `offset`. */
  total: z.number().int(),
})
export type TaskList = z.infer<typeof taskListSchema>

export const commentSchema = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  author: userSummarySchema.nullable(),
  /** Markdown. */
  body: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type Comment = z.infer<typeof commentSchema>

export const commentRequestSchema = z.object({ body: textSchema.trim().min(1).max(10_000) })
export type CommentRequest = z.infer<typeof commentRequestSchema>

/** Who follows a task: they hear about its comments and moves. */
export const taskWatchersSchema = z.object({
  /** Whether the user asking is one of them. */
  watching: z.boolean(),
  watchers: z.array(userSummarySchema),
})
export type TaskWatchers = z.infer<typeof taskWatchersSchema>

/** One action on several tasks at once; it applies to all of them or to none. */
export const bulkTasksRequestSchema = z.object({
  taskIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, 'Tasks must not repeat'),
  action: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('update'),
      patch: z
        .object({
          /** Moves the tasks to the end of this column. */
          statusId: z.uuid().optional(),
          assigneeId: z.uuid().nullable().optional(),
          priority: taskPrioritySchema.optional(),
        })
        .refine((patch) => Object.keys(patch).length > 0, 'At least one field is required'),
    }),
    z.object({ type: z.literal('delete') }),
  ]),
})
export type BulkTasksRequest = z.infer<typeof bulkTasksRequestSchema>

export const bulkTasksResultSchema = z.object({ affected: z.number().int() })

/** A named set of list filters a person keeps for themselves in a project. */
export const savedFilterSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The query string of the task list, e.g. `priority=high&sort=due`. */
  query: z.string(),
})
export type SavedFilter = z.infer<typeof savedFilterSchema>

export const createSavedFilterSchema = z.object({
  name: textSchema.trim().min(1).max(60),
  query: textSchema.max(500),
})
export type CreateSavedFilter = z.infer<typeof createSavedFilterSchema>
