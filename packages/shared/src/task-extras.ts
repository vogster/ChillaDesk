import { z } from 'zod'
import { textSchema } from './auth'

// ---------- checklist ----------

export const checklistTextSchema = textSchema.trim().min(1).max(300)

export const checklistItemSchema = z.object({
  id: z.uuid(),
  text: z.string(),
  done: z.boolean(),
})
export type ChecklistItem = z.infer<typeof checklistItemSchema>

export const createChecklistItemSchema = z.object({ text: checklistTextSchema })
export type CreateChecklistItem = z.infer<typeof createChecklistItemSchema>

export const updateChecklistItemSchema = z
  .object({ text: checklistTextSchema.optional(), done: z.boolean().optional() })
  .refine((patch) => Object.keys(patch).length > 0, 'At least one field is required')
export type UpdateChecklistItem = z.infer<typeof updateChecklistItemSchema>

/** How far a task's checklist is; shown on cards and in lists. */
export const checklistProgressSchema = z.object({
  done: z.number().int().min(0),
  total: z.number().int().min(0),
})
export type ChecklistProgress = z.infer<typeof checklistProgressSchema>

// ---------- links between tasks ----------

/**
 * How one task relates to another, read from the task the link is listed under:
 * "this task blocks that one", "this task is a subtask of that one", and so on.
 */
export const taskRelationSchema = z.enum([
  'blocks',
  'blocked_by',
  'duplicates',
  'duplicated_by',
  'subtask_of',
  'parent_of',
  'relates_to',
])
export type TaskRelation = z.infer<typeof taskRelationSchema>

/** The same link as seen from the other task. */
export const INVERSE_RELATION: Record<TaskRelation, TaskRelation> = {
  blocks: 'blocked_by',
  blocked_by: 'blocks',
  duplicates: 'duplicated_by',
  duplicated_by: 'duplicates',
  subtask_of: 'parent_of',
  parent_of: 'subtask_of',
  relates_to: 'relates_to',
}

export const taskLinkSchema = z.object({
  id: z.uuid(),
  relation: taskRelationSchema,
  /** The task at the other end. */
  task: z.object({
    id: z.uuid(),
    key: z.string(),
    title: z.string(),
    /** Whether it sits in a "done" column. */
    done: z.boolean(),
  }),
})
export type TaskLink = z.infer<typeof taskLinkSchema>

export const createTaskLinkSchema = z.object({
  relation: taskRelationSchema,
  /** Number of the other task in the same project (the `12` of `CHL-12`). */
  taskNumber: z.number().int().min(1).max(999_999_999),
})
export type CreateTaskLink = z.infer<typeof createTaskLinkSchema>
