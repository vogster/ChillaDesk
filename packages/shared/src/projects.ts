import { z } from 'zod'
import { emailSchema, textSchema } from './auth'

export const projectRoleSchema = z.enum(['owner', 'member', 'viewer'])
export type ProjectRole = z.infer<typeof projectRoleSchema>

/** Short uppercase prefix used in task keys, e.g. `CHL` in `CHL-12`. */
export const projectKeySchema = z
  .string()
  .regex(
    /^[A-Z][A-Z0-9]{1,9}$/,
    'Key must be 2-10 uppercase letters or digits, starting with a letter',
  )

const projectNameSchema = textSchema.trim().min(1).max(100)
const projectDescriptionSchema = textSchema.max(2000)

export const projectSchema = z.object({
  id: z.uuid(),
  key: projectKeySchema,
  name: z.string(),
  description: z.string(),
  /** Role of the user who made the request. */
  role: projectRoleSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})
export type Project = z.infer<typeof projectSchema>

export const createProjectRequestSchema = z.object({
  name: projectNameSchema,
  key: projectKeySchema,
  description: projectDescriptionSchema.default(''),
})
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>

export const updateProjectRequestSchema = z
  .object({
    name: projectNameSchema.optional(),
    description: projectDescriptionSchema.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'At least one field is required')
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>

export const projectMemberSchema = z.object({
  userId: z.uuid(),
  email: emailSchema,
  name: z.string(),
  role: projectRoleSchema,
  joinedAt: z.iso.datetime(),
})
export type ProjectMember = z.infer<typeof projectMemberSchema>

export const addMemberRequestSchema = z.object({
  email: emailSchema,
  role: projectRoleSchema.default('member'),
})
export type AddMemberRequest = z.infer<typeof addMemberRequestSchema>

export const updateMemberRequestSchema = z.object({ role: projectRoleSchema })
export type UpdateMemberRequest = z.infer<typeof updateMemberRequestSchema>
