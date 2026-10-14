import type { Project, Status } from '@chilladesk/shared'
import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { buildApp, type AppOptions } from '../app'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { createMemoryDatabase, type Database } from '../db/client'
import { users } from '../db/schema'
import { register } from '../modules/auth/service'
import { addMember } from '../modules/projects/service'

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
  // Uploaded files of one test run; removed again when the context is closed.
  const filesDir = await mkdtemp(join(tmpdir(), 'chilladesk-test-files-'))
  await database.migrate()
  // Limits are lifted by default so that only the tests about rate limiting hit them.
  const app = await buildApp({
    database,
    logLevel: 'silent',
    rateLimitMax: 100_000,
    authRateLimitMax: 100_000,
    accountRateLimitMax: 100_000,
    memberInviteRateLimitMax: 100_000,
    filesDir,
    uploadRateLimitMax: 100_000,
    ...options,
  })

  const signUp: TestContext['signUp'] = async (name = 'Test User') => {
    userCounter += 1
    const email = `user${userCounter}@example.com`
    // Through the service rather than the route: on a server that sends email the route
    // only starts a sign-up, and fixtures need finished accounts either way.
    const { user, token } = await register(
      database.db,
      { email, name, password: TEST_PASSWORD },
      { registration: 'open' },
    )
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
      // Directly: with email on, the route sends an invite link instead of adding.
      await addMember(database.db, owner.id, project.id, { email: user.email, role })
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
      await rm(filesDir, { recursive: true, force: true })
    },
  }
}
