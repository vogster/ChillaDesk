import type { AuthResponse, Project, Status } from '@chilladesk/shared'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { buildApp, type AppOptions } from '../app'
import { eq } from 'drizzle-orm'
import { createMemoryDatabase, type Database } from '../db/client'
import { users } from '../db/schema'

export interface TestUser {
  id: string
  email: string
  token: string
  /** Bearer header for `app.inject`. */
  headers: { authorization: string }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ProjectFixture {
  project: Project
  /** The default board columns, left to right. */
  statuses: Status[]
  owner: TestUser
  member: TestUser
  viewer: TestUser
  /** Signed in, but not a member of the project. */
  outsider: TestUser
  /** Calls `/api/projects/<id><path>` as the given user. */
  call(
    user: TestUser,
    method: Method,
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<LightMyRequestResponse>
}

export interface TestContext {
  app: FastifyInstance
  database: Database
  /** Registers a fresh user; every call produces a unique email. */
  signUp(name?: string): Promise<TestUser>
  /** Calls the API as the given user. */
  request(
    user: TestUser,
    method: Method,
    url: string,
    payload?: Record<string, unknown>,
  ): Promise<LightMyRequestResponse>
  /** Creates a project with one user in each role. */
  createProject(): Promise<ProjectFixture>
  close(): Promise<void>
}

export const TEST_PASSWORD = 'correct horse battery'

let userCounter = 0
let projectCounter = 0

export async function createTestContext(
  options: Partial<Omit<AppOptions, 'database'>> = {},
): Promise<TestContext> {
  const database = await createMemoryDatabase()
  await database.migrate()
  // Limits are lifted by default so that only the tests about rate limiting hit them.
  const app = await buildApp({
    database,
    logLevel: 'silent',
    rateLimitMax: 100_000,
    authRateLimitMax: 100_000,
    accountRateLimitMax: 100_000,
    memberInviteRateLimitMax: 100_000,
    ...options,
  })

  const signUp: TestContext['signUp'] = async (name = 'Test User') => {
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
    // Fixture users are people whose address is known to be theirs; tests about
    // unconfirmed accounts register their own.
    await database.db
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.id, user.id))
    return { id: user.id, email, token, headers: { authorization: `Bearer ${token}` } }
  }

  const request: TestContext['request'] = (user, method, url, payload) =>
    app.inject({ method, url, headers: user.headers, ...(payload ? { payload } : {}) })

  async function expectOk(response: LightMyRequestResponse, what: string): Promise<void> {
    if (response.statusCode >= 300) {
      throw new Error(`${what} failed with ${response.statusCode}: ${response.body}`)
    }
  }

  const createProject: TestContext['createProject'] = async () => {
    const [owner, member, viewer, outsider] = await Promise.all([
      signUp('Olga Owner'),
      signUp('Max Member'),
      signUp('Vera Viewer'),
      signUp('Oscar Outsider'),
    ])
    projectCounter += 1
    const created = await request(owner, 'POST', '/api/projects', {
      name: `Project ${projectCounter}`,
      key: `T${projectCounter}`,
    })
    await expectOk(created, 'createProject')
    const project = created.json<Project>()
    const base = `/api/projects/${project.id}`

    for (const [user, role] of [
      [member, 'member'],
      [viewer, 'viewer'],
    ] as const) {
      const added = await request(owner, 'POST', `${base}/members`, { email: user.email, role })
      await expectOk(added, `adding the ${role}`)
    }
    const statuses = await request(owner, 'GET', `${base}/statuses`)
    await expectOk(statuses, 'listing statuses')

    return {
      project,
      statuses: statuses.json<Status[]>(),
      owner,
      member,
      viewer,
      outsider,
      call: (user, method, path, payload) => request(user, method, `${base}${path}`, payload),
    }
  }

  return {
    app,
    database,
    signUp,
    request,
    createProject,
    async close() {
      await app.close()
      await database.close()
    },
  }
}
