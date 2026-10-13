import { z } from 'zod'
import { taskPrioritySchema, userSummarySchema } from './tasks'

/**
 * One thing that happened to a task. Names are kept as they were at that moment (of the
 * column, the person, the labels), so the history still reads right after a rename or
 * after the thing itself is gone.
 */
export const taskChangeSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('created') }),
  z.object({ field: z.literal('title'), from: z.string(), to: z.string() }),
  /** The texts themselves are not kept: they can be long, and the task shows the latest. */
  z.object({ field: z.literal('description') }),
  z.object({ field: z.literal('status'), from: z.string(), to: z.string() }),
  z.object({ field: z.literal('priority'), from: taskPrioritySchema, to: taskPrioritySchema }),
  z.object({
    field: z.literal('assignee'),
    from: z.string().nullable(),
    to: z.string().nullable(),
  }),
  z.object({
    field: z.literal('dueDate'),
    from: z.string().nullable(),
    to: z.string().nullable(),
  }),
  z.object({
    field: z.literal('milestone'),
    from: z.string().nullable(),
    to: z.string().nullable(),
  }),
  z.object({
    field: z.literal('labels'),
    added: z.array(z.string()),
    removed: z.array(z.string()),
  }),
])
export type TaskChange = z.infer<typeof taskChangeSchema>

export const taskEventSchema = z.object({
  id: z.uuid(),
  /** Null when the account of whoever did it has been deleted since. */
  actor: userSummarySchema.nullable(),
  change: taskChangeSchema,
  createdAt: z.iso.datetime(),
})
export type TaskEvent = z.infer<typeof taskEventSchema>
