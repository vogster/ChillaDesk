import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 200

export const emailSchema = z.email().max(254)

/** PostgreSQL text cannot hold NUL, so it is rejected up front instead of failing the query. */
export const textSchema = z
  .string()
  .refine((value) => !value.includes('\u0000'), 'Must not contain null characters')

export const userSchema = z.object({
  id: z.uuid(),
  email: emailSchema,
  name: z.string(),
  createdAt: z.iso.datetime(),
})
export type User = z.infer<typeof userSchema>

export const registerRequestSchema = z.object({
  email: emailSchema,
  name: textSchema.trim().min(1).max(100),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
})
export type RegisterRequest = z.infer<typeof registerRequestSchema>

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

export const authResponseSchema = z.object({
  user: userSchema,
  /** Session token for clients that cannot use cookies (mobile apps, scripts). */
  token: z.string(),
  expiresAt: z.iso.datetime(),
})
export type AuthResponse = z.infer<typeof authResponseSchema>
