import { describe, expect, it } from 'vitest'
import { createApiTokenRequestSchema } from './tokens'

describe('createApiTokenRequestSchema', () => {
  it('defaults to a read-only token that does not expire', () => {
    expect(createApiTokenRequestSchema.parse({ name: ' Claude ' })).toEqual({
      name: 'Claude',
      scope: 'read',
      expiresInDays: null,
    })
  })

  it.each([
    ['a blank name', { name: '  ' }],
    ['an overlong name', { name: 'x'.repeat(61) }],
    ['an unknown scope', { name: 'T', scope: 'admin' }],
    ['a zero lifetime', { name: 'T', expiresInDays: 0 }],
    ['a fractional lifetime', { name: 'T', expiresInDays: 1.5 }],
    ['a lifetime over ten years', { name: 'T', expiresInDays: 3651 }],
  ])('rejects %s', (_label, input) => {
    expect(createApiTokenRequestSchema.safeParse(input).success).toBe(false)
  })
})
