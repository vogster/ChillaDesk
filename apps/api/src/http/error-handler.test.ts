import { errorResponseSchema } from '@chillawiki/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { conflict, isForeignKeyViolation, isUniqueViolation } from '../errors'
import { createTestContext, type TestContext } from '../test/harness'
import { loggableError } from './error-handler'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
  ctx.app.get('/boom', async () => {
    throw new Error('secret database password leaked')
  })
  ctx.app.get('/conflict', async () => {
    throw conflict('Already there')
  })
})

afterAll(async () => {
  await ctx.close()
})

describe('error responses', () => {
  it('hides the details of unexpected errors', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/boom' })

    expect(response.statusCode).toBe(500)
    expect(errorResponseSchema.parse(response.json())).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    })
  })

  it('maps application errors to their status and code', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/conflict' })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({ error: { code: 'CONFLICT', message: 'Already there' } })
  })

  it('reports malformed JSON as a client error', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"email": ',
    })

    expect(response.statusCode).toBe(400)
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR')
  })

  it('uses the shared shape for unknown routes', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/nope' })

    expect(response.statusCode).toBe(404)
    expect(errorResponseSchema.parse(response.json()).error.code).toBe('NOT_FOUND')
  })
})

describe('loggableError', () => {
  it('drops query parameters, which can hold emails and password hashes', () => {
    const driverError = new Error('invalid byte sequence')
    const queryError = Object.assign(
      new Error('Failed query: insert ... params: ann@example.com'),
      {
        query: 'insert into "users" values ($1)',
        params: ['ann@example.com'],
        cause: driverError,
      },
    )

    expect(loggableError(queryError)).toEqual({
      err: driverError,
      query: 'insert into "users" values ($1)',
    })
  })

  it('passes other errors through', () => {
    const error = new Error('plain')

    expect(loggableError(error)).toEqual({ err: error })
  })
})

describe('isUniqueViolation', () => {
  it('finds the PostgreSQL code on the error or anywhere in its cause chain', () => {
    const driverError = Object.assign(new Error('duplicate key'), { code: '23505' })
    const wrapped = new Error('Failed query', { cause: driverError })

    expect(isUniqueViolation(driverError)).toBe(true)
    expect(isUniqueViolation(wrapped)).toBe(true)
  })

  it('ignores other errors and non-errors', () => {
    expect(isUniqueViolation(Object.assign(new Error('fk'), { code: '23503' }))).toBe(false)
    expect(isUniqueViolation(new Error('plain'))).toBe(false)
    expect(isUniqueViolation('23505')).toBe(false)
  })

  it('is told apart from a foreign key violation', () => {
    const foreignKey = new Error('Failed query', {
      cause: Object.assign(new Error('still referenced'), { code: '23503' }),
    })

    expect(isForeignKeyViolation(foreignKey)).toBe(true)
    expect(isUniqueViolation(foreignKey)).toBe(false)
  })
})
