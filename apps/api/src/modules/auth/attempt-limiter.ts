export interface AttemptLimiterOptions {
  max: number
  windowMs: number
  /** Expired keys are purged once per this many calls. */
  sweepEvery?: number
}

export type AttemptResult = { allowed: true } | { allowed: false; retryAfterMs: number }

export interface AttemptLimiter {
  consume(key: string, now?: number): AttemptResult
  size(): number
}

/**
 * Fixed-window counter kept in memory, for limits keyed by something in the request body.
 * (@fastify/rate-limit applies a single limit per request and already handles the per-client one.)
 * Counts are per process and reset on restart.
 */
export function createAttemptLimiter({
  max,
  windowMs,
  sweepEvery = 1000,
}: AttemptLimiterOptions): AttemptLimiter {
  const windows = new Map<string, { count: number; resetAt: number }>()
  let calls = 0

  function sweep(now: number): void {
    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key)
    }
  }

  return {
    consume(key, now = Date.now()) {
      calls += 1
      if (calls % sweepEvery === 0) sweep(now)

      const current = windows.get(key)
      if (!current || current.resetAt <= now) {
        windows.set(key, { count: 1, resetAt: now + windowMs })
        return { allowed: true }
      }
      if (current.count >= max) return { allowed: false, retryAfterMs: current.resetAt - now }

      windows.set(key, { ...current, count: current.count + 1 })
      return { allowed: true }
    },
    size: () => windows.size,
  }
}
