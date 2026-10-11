import { describe, expect, it } from 'vitest'
import { createAttemptLimiter } from './attempt-limiter'

const WINDOW = 60_000

describe('attempt limiter', () => {
  it('allows up to max attempts per key, then reports when to retry', () => {
    const limiter = createAttemptLimiter({ max: 2, windowMs: WINDOW })

    expect(limiter.consume('ann', 0)).toEqual({ allowed: true })
    expect(limiter.consume('ann', 1000)).toEqual({ allowed: true })
    expect(limiter.consume('ann', 2000)).toEqual({ allowed: false, retryAfterMs: 58_000 })
  })

  it('counts keys independently', () => {
    const limiter = createAttemptLimiter({ max: 1, windowMs: WINDOW })
    limiter.consume('ann', 0)

    expect(limiter.consume('bob', 0).allowed).toBe(true)
  })

  it('starts a fresh window once the old one has passed', () => {
    const limiter = createAttemptLimiter({ max: 1, windowMs: WINDOW })
    limiter.consume('ann', 0)

    expect(limiter.consume('ann', WINDOW - 1).allowed).toBe(false)
    expect(limiter.consume('ann', WINDOW).allowed).toBe(true)
  })

  it('forgets expired keys so memory stays bounded', () => {
    const limiter = createAttemptLimiter({ max: 1, windowMs: WINDOW, sweepEvery: 3 })
    limiter.consume('old-1', 0)
    limiter.consume('old-2', 0)

    limiter.consume('new', WINDOW * 2)

    expect(limiter.size()).toBe(1)
  })
})
