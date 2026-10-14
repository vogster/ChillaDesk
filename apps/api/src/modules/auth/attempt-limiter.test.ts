import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createMemoryDatabase, type Database } from '../../db/client'
import { attemptCounters } from '../../db/schema'
import { createAttemptLimiter } from './attempt-limiter'

const WINDOW = 60_000
const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms)
let database: Database

beforeAll(async () => {
  database = await createMemoryDatabase()
  await database.migrate()
})

afterAll(async () => {
  await database.close()
})

let limits = 0
const limiter = (max: number, sweepEvery?: number) => {
  limits += 1
  return createAttemptLimiter(database.db, {
    name: `test-${limits}`,
    max,
    windowMs: WINDOW,
    ...(sweepEvery ? { sweepEvery } : {}),
  })
}

describe('attempt limiter', () => {
  it('allows up to max attempts per key, then reports when to retry', async () => {
    const limit = limiter(2)

    expect(await limit.consume('ann', at(0))).toEqual({ allowed: true })
    expect(await limit.consume('ann', at(1000))).toEqual({ allowed: true })
    expect(await limit.consume('ann', at(2000))).toEqual({ allowed: false, retryAfterMs: 58_000 })
  })

  it('counts keys and limits independently', async () => {
    const one = limiter(1)
    const other = limiter(1)
    await one.consume('ann', at(0))

    expect((await one.consume('bob', at(0))).allowed).toBe(true)
    expect((await other.consume('ann', at(0))).allowed).toBe(true)
    expect((await one.consume('ann', at(0))).allowed).toBe(false)
  })

  it('starts a fresh window once the old one has passed', async () => {
    const limit = limiter(1)
    await limit.consume('ann', at(0))

    expect((await limit.consume('ann', at(WINDOW - 1))).allowed).toBe(false)
    expect((await limit.consume('ann', at(WINDOW))).allowed).toBe(true)
    expect((await limit.consume('ann', at(WINDOW + 1))).allowed).toBe(false)
  })

  it('is shared by every limiter of the same name, as replicas of the API are', async () => {
    const first = createAttemptLimiter(database.db, { name: 'shared', max: 1, windowMs: WINDOW })
    const second = createAttemptLimiter(database.db, { name: 'shared', max: 1, windowMs: WINDOW })

    expect((await first.consume('ann', at(0))).allowed).toBe(true)
    expect((await second.consume('ann', at(0))).allowed).toBe(false)
  })

  it('keeps no address in the clear and removes expired counts', async () => {
    const limit = limiter(5, 2)
    await limit.consume('someone@example.com', at(0))
    await limit.consume('later@example.com', at(WINDOW * 10))

    const rows = await database.db.select().from(attemptCounters)
    expect(rows.some((row) => row.key.includes('@'))).toBe(false)
    expect(rows.every((row) => row.resetAt.getTime() > at(WINDOW * 10).getTime())).toBe(true)
  })
})
