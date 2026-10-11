import { describe, expect, it } from 'vitest'
import { loginRequestSchema, registerRequestSchema } from './auth'
import {
  addMemberRequestSchema,
  createProjectRequestSchema,
  projectKeySchema,
  updateProjectRequestSchema,
} from './projects'

describe('registerRequestSchema', () => {
  const valid = { email: 'ann@example.com', name: 'Ann', password: 'correct horse' }

  it('accepts a valid registration and trims the name', () => {
    expect(registerRequestSchema.parse({ ...valid, name: '  Ann  ' })).toEqual(valid)
  })

  it.each([
    ['a malformed email', { ...valid, email: 'not-an-email' }],
    ['an empty name', { ...valid, name: '   ' }],
    ['a short password', { ...valid, password: '1234567' }],
    ['an overlong password', { ...valid, password: 'x'.repeat(201) }],
  ])('rejects %s', (_label, input) => {
    expect(registerRequestSchema.safeParse(input).success).toBe(false)
  })
})

describe('loginRequestSchema', () => {
  it('does not enforce the password policy on login', () => {
    expect(loginRequestSchema.safeParse({ email: 'ann@example.com', password: 'x' }).success).toBe(
      true,
    )
  })
})

describe('projectKeySchema', () => {
  it.each(['CH', 'CHL', 'WEB2', 'ABCDEFGHIJ'])('accepts %s', (key) => {
    expect(projectKeySchema.safeParse(key).success).toBe(true)
  })

  it.each(['C', 'chl', '2WEB', 'TOO-LONG', 'ABCDEFGHIJK', 'A B'])('rejects %s', (key) => {
    expect(projectKeySchema.safeParse(key).success).toBe(false)
  })
})

describe('createProjectRequestSchema', () => {
  it('defaults the description to an empty string', () => {
    expect(createProjectRequestSchema.parse({ name: 'Chilla', key: 'CHL' })).toEqual({
      name: 'Chilla',
      key: 'CHL',
      description: '',
    })
  })
})

describe('updateProjectRequestSchema', () => {
  it('rejects an empty patch', () => {
    expect(updateProjectRequestSchema.safeParse({}).success).toBe(false)
  })

  it('accepts a partial patch', () => {
    expect(updateProjectRequestSchema.parse({ name: 'New name' })).toEqual({ name: 'New name' })
  })
})

describe('addMemberRequestSchema', () => {
  it('defaults the role to member', () => {
    expect(addMemberRequestSchema.parse({ email: 'bob@example.com' }).role).toBe('member')
  })

  it('rejects an unknown role', () => {
    expect(
      addMemberRequestSchema.safeParse({ email: 'bob@example.com', role: 'admin' }).success,
    ).toBe(false)
  })
})
