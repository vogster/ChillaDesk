import { z } from 'zod'
import { textSchema } from './auth'

const milestoneNameSchema = textSchema.trim().min(1).max(80)
/** `YYYY-MM-DD`; the same shape as the due date of a task. */
const milestoneDateSchema = z.iso
  .date()
  .refine((date) => date >= '1900-01-01' && date <= '2999-12-31', 'Year must be 1900-2999')

/** A milestone as a task carries it. */
export const milestoneRefSchema = z.object({ id: z.uuid(), name: z.string() })
export type MilestoneRef = z.infer<typeof milestoneRefSchema>

/**
 * A point the project works towards: a release, a deadline. Tasks are put on it, and how
 * many of them are finished says how far it is.
 */
export const milestoneSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  dueDate: milestoneDateSchema.nullable(),
  /** Closed milestones are finished or given up; they are not offered for new tasks. */
  closed: z.boolean(),
  /** `done` counts the tasks in columns of the "done" kind. */
  progress: z.object({ done: z.number().int().min(0), total: z.number().int().min(0) }),
})
export type Milestone = z.infer<typeof milestoneSchema>

export const createMilestoneRequestSchema = z.object({
  name: milestoneNameSchema,
  dueDate: milestoneDateSchema.nullable().default(null),
})
export type CreateMilestoneRequest = z.infer<typeof createMilestoneRequestSchema>

export const updateMilestoneRequestSchema = z
  .object({
    name: milestoneNameSchema.optional(),
    dueDate: milestoneDateSchema.nullable().optional(),
    closed: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'At least one field is required')
export type UpdateMilestoneRequest = z.infer<typeof updateMilestoneRequestSchema>
