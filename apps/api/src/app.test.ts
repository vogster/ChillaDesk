import { healthResponseSchema } from '@chillawiki/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from './app'
import { createMemoryDatabase, type Database } from './db/client'

describe('GET /api/health', () => {
  let database: Database | undefined

  afterEach(async () => {
    await database?.close()
    database = undefined
  })

  it('reports ok when the database is reachable', async () => {
    database = await createMemoryDatabase()
    const app = await buildApp({ database, logLevel: 'silent' })

    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(200)
    const body = healthResponseSchema.parse(response.json())
    expect(body.status).toBe('ok')
    expect(body.database).toBe('up')
    await app.close()
  })

  it('reports degraded with 503 when the database is down', async () => {
    const downDatabase: Database = {
      ...(await createMemoryDatabase()),
      ping: async () => false,
    }
    database = downDatabase
    const app = await buildApp({ database, logLevel: 'silent' })

    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ status: 'degraded', database: 'down' })
    await app.close()
  })
})

describe('OpenAPI document', () => {
  it('is served and lists the health route', async () => {
    const database = await createMemoryDatabase()
    const app = await buildApp({ database, logLevel: 'silent' })

    const response = await app.inject({ method: 'GET', url: '/api/docs/json' })

    expect(response.statusCode).toBe(200)
    const document = response.json<{ info: { title: string }; paths: Record<string, unknown> }>()
    expect(document.info.title).toBe('ChillaWiki API')
    expect(document.paths).toHaveProperty('/api/health')
    await app.close()
    await database.close()
  })
})

describe('trustProxy', () => {
  it('takes the client address from X-Forwarded-For only when enabled', async () => {
    const database = await createMemoryDatabase()
    const trusting = await buildApp({ database, logLevel: 'silent', trustProxy: true })
    const direct = await buildApp({ database, logLevel: 'silent' })
    const addresses: string[] = []
    for (const app of [trusting, direct]) {
      app.addHook('onRequest', async (request) => {
        addresses.push(request.ip)
      })
      await app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { 'x-forwarded-for': '203.0.113.7' },
      })
      await app.close()
    }

    expect(addresses).toEqual(['203.0.113.7', '127.0.0.1'])
    await database.close()
  })
})

describe('unknown routes', () => {
  it('return a JSON 404', async () => {
    const database = await createMemoryDatabase()
    const app = await buildApp({ database, logLevel: 'silent' })

    const response = await app.inject({ method: 'GET', url: '/api/nope' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
    await app.close()
    await database.close()
  })
})
