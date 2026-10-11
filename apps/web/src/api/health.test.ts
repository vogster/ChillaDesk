import { describe, expect, it, vi } from 'vitest'
import { fetchHealth } from './health'

function mockFetch(body: unknown, status = 200) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

describe('fetchHealth', () => {
  it('returns the parsed health payload', async () => {
    const spy = mockFetch({ status: 'ok', version: '1.2.3', database: 'up' })

    await expect(fetchHealth()).resolves.toEqual({
      status: 'ok',
      version: '1.2.3',
      database: 'up',
    })
    expect(spy).toHaveBeenCalledWith('/api/health')
  })

  it('still returns a degraded payload sent with 503', async () => {
    mockFetch({ status: 'degraded', version: '1.2.3', database: 'down' }, 503)

    await expect(fetchHealth()).resolves.toMatchObject({ status: 'degraded' })
  })

  it('throws on an unexpected response shape', async () => {
    mockFetch({ hello: 'world' }, 500)

    await expect(fetchHealth()).rejects.toThrow(/unexpected health response/i)
  })
})
