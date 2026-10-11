import type { AuthResponse } from '@chillawiki/shared'
import type { FastifyInstance } from 'fastify'
import { buildApp, type AppOptions } from '../app'
import { createMemoryDatabase, type Database } from '../db/client'

export interface TestUser {
  id: string
  email: string
  token: string
  /** Bearer header for `app.inject`. */
  headers: { authorization: string }
}

export interface TestContext {
  app: FastifyInstance
  database: Database
  /** Registers a fresh user; every call produces a unique email. */
  signUp(name?: string): Promise<TestUser>
  close(): Promise<void>
}

export const TEST_PASSWORD = 'correct horse battery'

let userCounter = 0

export async function createTestContext(
  options: Partial<Omit<AppOptions, 'database'>> = {},
): Promise<TestContext> {
  const database = await createMemoryDatabase()
  await database.migrate()
  // Limits are lifted by default so that only the tests about rate limiting hit them.
  const app = await buildApp({
    database,
    logLevel: 'silent',
    rateLimitMax: 10_000,
    authRateLimitMax: 10_000,
    ...options,
  })

  return {
    app,
    database,
    async signUp(name = 'Test User') {
      userCounter += 1
      const email = `user${userCounter}@example.com`
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email, name, password: TEST_PASSWORD },
      })
      if (response.statusCode !== 201) {
        throw new Error(`signUp failed with ${response.statusCode}: ${response.body}`)
      }
      const { user, token } = response.json<AuthResponse>()
      return { id: user.id, email, token, headers: { authorization: `Bearer ${token}` } }
    },
    async close() {
      await app.close()
      await database.close()
    },
  }
}
