import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ApiError, apiRequest, errorMessage } from './client'

const respond = (body: unknown, status = 200) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(body === null ? null : JSON.stringify(body), { status }))

const caught = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: ApiError) => error,
  )

describe('apiRequest', () => {
  it('sends JSON with the session cookie and validates the response', async () => {
    const spy = respond({ id: 7 })

    const result = await apiRequest('/things', {
      method: 'POST',
      body: { name: 'x' },
      schema: z.object({ id: z.number() }),
    })

    expect(result).toEqual({ id: 7 })
    expect(spy).toHaveBeenCalledWith('/api/things', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{"name":"x"}',
    })
  })

  it('sends no body or content type for a plain GET', async () => {
    const spy = respond({ id: 1 })

    await apiRequest('/things', { schema: z.object({ id: z.number() }) })

    expect(spy).toHaveBeenCalledWith('/api/things', { method: 'GET', credentials: 'same-origin' })
  })

  it('resolves to undefined for 204 responses', async () => {
    respond(null, 204)

    await expect(apiRequest('/things/1', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('turns an API error body into an ApiError', async () => {
    respond(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: [{ path: 'email', message: 'Invalid email' }],
        },
      },
      400,
    )

    const error = await caught(apiRequest('/things'))

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      message: 'Request validation failed',
      details: [{ path: 'email', message: 'Invalid email' }],
    })
  })

  it('reports a non-JSON error page', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>Bad Gateway</html>', { status: 502 }),
    )

    const error = await caught(apiRequest('/things'))

    expect(error).toMatchObject({ code: 'UNEXPECTED_RESPONSE', status: 502 })
    expect(error?.message).toContain('502')
  })

  it('reports a success body that does not match the schema', async () => {
    respond({ id: 'not-a-number' })

    const error = await caught(apiRequest('/things', { schema: z.object({ id: z.number() }) }))

    expect(error).toMatchObject({ code: 'UNEXPECTED_RESPONSE' })
  })

  it('reports a network failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))

    const error = await caught(apiRequest('/things'))

    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: 0 })
  })
})

describe('errorMessage', () => {
  it('uses the message of an ApiError and a generic text otherwise', () => {
    expect(errorMessage(new ApiError('CONFLICT', 'Key is taken', 409))).toBe('Key is taken')
    expect(errorMessage(new TypeError('boom'))).toBe('Something went wrong. Please try again.')
  })
})
