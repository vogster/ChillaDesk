import {
  API_TOKEN_PREFIX,
  type ApiToken,
  type CreateApiTokenRequest,
  type CreatedApiToken,
} from '@chillawiki/shared'
import { and, count, desc, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { apiTokens } from '../../db/schema'
import { conflict, notFound } from '../../errors'
import { generateToken, hashToken } from '../auth/tokens'

export const MAX_TOKENS_PER_USER = 50

const DAY_MS = 24 * 60 * 60 * 1000

function toApiToken(row: typeof apiTokens.$inferSelect): ApiToken {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function listApiTokens(db: Db, userId: string): Promise<ApiToken[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt), desc(apiTokens.id))
  return rows.map(toApiToken)
}

export async function createApiToken(
  db: Db,
  userId: string,
  input: CreateApiTokenRequest,
  now: Date = new Date(),
): Promise<CreatedApiToken> {
  const [existing] = await db
    .select({ total: count() })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
  if ((existing?.total ?? 0) >= MAX_TOKENS_PER_USER) {
    throw conflict(
      `You can have at most ${MAX_TOKENS_PER_USER} tokens. Revoke one you no longer use.`,
    )
  }

  const secret = generateToken()
  const token = `${API_TOKEN_PREFIX}${secret.token}`
  const [created] = await db
    .insert(apiTokens)
    .values({
      userId,
      name: input.name,
      scope: input.scope,
      tokenHash: hashToken(token),
      expiresAt: input.expiresInDays
        ? new Date(now.getTime() + input.expiresInDays * DAY_MS)
        : null,
    })
    .returning()
  if (!created) throw new Error('Insert returned no token row')
  return { ...toApiToken(created), token }
}

export async function revokeApiToken(db: Db, userId: string, tokenId: string): Promise<void> {
  const removed = await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.userId, userId), eq(apiTokens.id, tokenId)))
    .returning({ id: apiTokens.id })
  if (removed.length === 0) throw notFound('Token')
}
