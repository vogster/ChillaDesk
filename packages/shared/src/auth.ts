import { z } from 'zod'

export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 200

export const emailSchema = z.email().max(254)

export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH)

/** PostgreSQL text cannot hold NUL, so it is rejected up front instead of failing the query. */
export const textSchema = z
  .string()
  .refine((value) => !value.includes('\u0000'), 'Must not contain null characters')

/** Languages the interface, the default board columns and the emails come in. */
export const localeSchema = z.enum(['en', 'ru'])
export type UserLocale = z.infer<typeof localeSchema>

export const userNameSchema = textSchema.trim().min(1).max(100)

export const userSchema = z.object({
  id: z.uuid(),
  email: emailSchema,
  name: z.string(),
  /** Null until the user has used an interface that reports its language. */
  locale: localeSchema.nullable(),
  /** Whether notifications are also sent by email (if the server sends email at all). */
  emailNotifications: z.boolean(),
  /** Whether the user has proved that the email address is theirs. */
  emailVerified: z.boolean(),
  createdAt: z.iso.datetime(),
})
export type User = z.infer<typeof userSchema>

export const registerRequestSchema = z.object({
  email: emailSchema,
  name: userNameSchema,
  password: passwordSchema,
  locale: localeSchema.optional(),
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

export const updateProfileRequestSchema = z
  .object({
    name: userNameSchema.optional(),
    locale: localeSchema.optional(),
    emailNotifications: z.boolean().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'At least one field is required')
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
})
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>

/** What a client needs to know before anyone is signed in. */
export const authOptionsSchema = z.object({
  registrationEnabled: z.boolean(),
  /** Whether the server sends email: confirmation links and password resets depend on it. */
  emailEnabled: z.boolean(),
})
export type AuthOptions = z.infer<typeof authOptionsSchema>

/** The token from a link in an email. */
export const emailTokenRequestSchema = z.object({ token: z.string().min(1).max(200) })

export const passwordResetRequestSchema = z.object({ email: emailSchema })
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(1).max(200),
  password: passwordSchema,
})
export type PasswordResetConfirm = z.infer<typeof passwordResetConfirmSchema>
