import { describe, expect, it } from 'vitest'
import { healthResponseSchema } from './health'

describe('healthResponseSchema', () => {
  it('accepts a valid health payload', () => {
    const payload = { status: 'ok', version: '0.0.0', database: 'up' }

    expect(healthResponseSchema.parse(payload)).toEqual(payload)
  })

  it('rejects an unknown status', () => {
    const result = healthResponseSchema.safeParse({
      status: 'maybe',
      version: '0.0.0',
      database: 'up',
    })

    expect(result.success).toBe(false)
  })
})
