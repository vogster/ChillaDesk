import { z } from 'zod'
import { textSchema } from './auth'

/** A fixed palette: clients decide how each name looks in light and dark themes. */
export const labelColorSchema = z.enum([
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
export type LabelColor = z.infer<typeof labelColorSchema>

export const LABELS_PER_TASK_MAX = 20

const labelNameSchema = textSchema.trim().min(1).max(40)

export const labelSchema = z.object({
  id: z.uuid(),
  /** Unique within the project, ignoring case. */
  name: z.string(),
  color: labelColorSchema,
})
export type Label = z.infer<typeof labelSchema>

export const createLabelRequestSchema = z.object({
  name: labelNameSchema,
  color: labelColorSchema.default('gray'),
})
export type CreateLabelRequest = z.infer<typeof createLabelRequestSchema>

export const updateLabelRequestSchema = z
  .object({ name: labelNameSchema.optional(), color: labelColorSchema.optional() })
  .refine((patch) => Object.keys(patch).length > 0, 'At least one field is required')
export type UpdateLabelRequest = z.infer<typeof updateLabelRequestSchema>

/** The complete set of labels for a task; replaces whatever it had. */
export const labelIdsSchema = z
  .array(z.uuid())
  .max(LABELS_PER_TASK_MAX)
  .refine((ids) => new Set(ids).size === ids.length, 'Labels must not repeat')
