import { z } from 'zod'
import { textSchema } from './auth'

/** `read` tokens can only look; `write` tokens can do whatever their owner can in a project. */
export const apiTokenScopeSchema = z.enum(['read', 'write'])
export type ApiTokenScope = z.infer<typeof apiTokenScopeSchema>

/** Every personal API token starts with this, which is how the server tells it from a session. */
export const API_TOKEN_PREFIX = 'cw_pat_'

export const API_TOKEN_MAX_DAYS = 3650

export const apiTokenSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  scope: apiTokenScopeSchema,
  /** Rounded to about a minute; null until the token is first used. */
  lastUsedAt: z.iso.datetime().nullable(),
  /** Null for a token that does not expire. */
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export type ApiToken = z.infer<typeof apiTokenSchema>

export const createApiTokenRequestSchema = z.object({
  name: textSchema.trim().min(1).max(60),
  scope: apiTokenScopeSchema.default('read'),
  /** Null for no expiry. */
  expiresInDays: z.number().int().min(1).max(API_TOKEN_MAX_DAYS).nullable().default(null),
})
export type CreateApiTokenRequest = z.infer<typeof createApiTokenRequestSchema>

/** The only response that contains the token itself; it cannot be retrieved again. */
export const createdApiTokenSchema = apiTokenSchema.extend({ token: z.string() })
export type CreatedApiToken = z.infer<typeof createdApiTokenSchema>
