import { createHash } from 'node:crypto'
import { lt, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { attemptCounters } from '../../db/schema'

export interface AttemptLimiterOptions {
  /** Names the limit, so two limits never share a count for the same key. */
  name: string
  max: number
  windowMs: number
  /** Expired counts are removed once per this many attempts. */
  sweepEvery?: number
}

export type AttemptResult = { allowed: true } | { allowed: false; retryAfterMs: number }

export interface AttemptLimiter {
  consume(key: string, now?: Date): Promise<AttemptResult>
}

/**
 * Fixed-window counter in the database, for limits keyed by something in the request body:
 * logins per account, emails per account. (@fastify/rate-limit applies the per-client
 * limits.) Being in the database, a count survives a restart and is shared by every API
 * replica. Keys are hashed, as they may be email addresses nobody registered.
 */
export function createAttemptLimiter(
  db: Db,
  { name, max, windowMs, sweepEvery = 500 }: AttemptLimiterOptions,
): AttemptLimiter {
  let attempts = 0

  return {
    async consume(key, now = new Date()) {
      attempts += 1
      if (attempts % sweepEvery === 0) {
        await db.delete(attemptCounters).where(lt(attemptCounters.resetAt, now))
      }

      const hashed = createHash('sha256').update(`${name}:${key}`).digest('hex')
      const nowSql = sql`${now.toISOString()}::timestamptz`
      const resetAt = new Date(now.getTime() + windowMs)
      // One statement, so attempts at the same moment on any replica are all counted.
      const expired = sql`${attemptCounters.resetAt} <= ${nowSql}`
      const [counter] = await db
        .insert(attemptCounters)
        .values({ key: hashed, count: 1, resetAt })
        .onConflictDoUpdate({
          target: attemptCounters.key,
          set: {
            count: sql`case when ${expired} then 1 else ${attemptCounters.count} + 1 end`,
            resetAt: sql`case when ${expired} then ${resetAt.toISOString()}::timestamptz else ${attemptCounters.resetAt} end`,
          },
        })
        .returning({ count: attemptCounters.count, resetAt: attemptCounters.resetAt })
      if (!counter || counter.count <= max) return { allowed: true }
      return {
        allowed: false,
        retryAfterMs: Math.max(0, counter.resetAt.getTime() - now.getTime()),
      }
    },
  }
}
