import {
  API_TOKEN_PREFIX,
  apiTokenSchema,
  createdApiTokenSchema,
  type ApiToken,
  type CreatedApiToken,
} from '@chillawiki/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apiTokens } from '../../db/schema'
import { createTestContext, type TestContext, type TestUser } from '../../test/harness'
import { SESSION_COOKIE } from '../auth/plugin'
import { authenticate } from '../auth/service'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

async function createToken(
  user: TestUser,
  payload: Record<string, unknown> = { name: 'Test token' },
): Promise<CreatedApiToken> {
  const response = await ctx.request(user, 'POST', '/api/tokens', payload)
  expect(response.statusCode, response.body).toBe(201)
  return response.json<CreatedApiToken>()
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` })
const withToken = (
  token: string,
  method: 'GET' | 'POST' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
) => ctx.app.inject({ method, url, headers: bearer(token), ...(payload ? { payload } : {}) })

describe('creating tokens', () => {
  it('returns the token once and stores only its hash', async () => {
    const user = await ctx.signUp()

    const created = await createToken(user, { name: ' Claude ', scope: 'write' })
    const list = await ctx.request(user, 'GET', '/api/tokens')

    expect(createdApiTokenSchema.parse(created)).toMatchObject({
      name: 'Claude',
      scope: 'write',
      lastUsedAt: null,
      expiresAt: null,
    })
    expect(created.token.startsWith(API_TOKEN_PREFIX)).toBe(true)
    expect(created.token.length).toBeGreaterThan(40)
    expect(list.body).not.toContain(created.token)
    expect(list.json<ApiToken[]>().map((token) => apiTokenSchema.parse(token).id)).toEqual([
      created.id,
    ])
    const [row] = await ctx.database.db.select().from(apiTokens).where(eq(apiTokens.id, created.id))
    expect(row?.tokenHash).not.toContain(created.token)
  })

  it('sets an expiry when asked', async () => {
    const user = await ctx.signUp()
    const before = Date.now()

    const created = await createToken(user, { name: 'Short', expiresInDays: 7 })

    const lifetime = Date.parse(created.expiresAt ?? '') - before
    const week = 7 * 24 * 60 * 60 * 1000
    expect(lifetime).toBeGreaterThan(week - 60_000)
    expect(lifetime).toBeLessThan(week + 60_000)
  })

  it('lists only the caller’s tokens, newest first', async () => {
    const ann = await ctx.signUp()
    const bob = await ctx.signUp()
    await createToken(ann, { name: 'First' })
    await createToken(bob, { name: 'Not mine' })
    await createToken(ann, { name: 'Second' })

    const list = await ctx.request(ann, 'GET', '/api/tokens')

    expect(list.json<ApiToken[]>().map((token) => token.name)).toEqual(['Second', 'First'])
  })

  it('caps the number of tokens per user', async () => {
    const user = await ctx.signUp()
    for (let index = 0; index < 50; index += 1) await createToken(user, { name: `Token ${index}` })

    const response = await ctx.request(user, 'POST', '/api/tokens', { name: 'One too many' })

    expect(response.statusCode).toBe(409)
  })

  it('requires a signed-in user', async () => {
    const responses = await Promise.all([
      ctx.app.inject({ method: 'GET', url: '/api/tokens' }),
      ctx.app.inject({ method: 'POST', url: '/api/tokens', payload: { name: 'X' } }),
    ])

    expect(responses.map((response) => response.statusCode)).toEqual([401, 401])
  })
})

describe('using a token', () => {
  it('authenticates API requests as its owner', async () => {
    const { owner, project } = await ctx.createProject()
    const { token } = await createToken(owner)

    const me = await withToken(token, 'GET', '/api/auth/me')
    const projects = await withToken(token, 'GET', '/api/projects')

    expect(me.json()).toMatchObject({ id: owner.id })
    expect(projects.json<{ id: string }[]>().map((item) => item.id)).toEqual([project.id])
  })

  it('lets a read token look but not change anything', async () => {
    const { owner, project } = await ctx.createProject()
    const { token } = await createToken(owner, { name: 'Reader', scope: 'read' })
    const tasks = `/api/projects/${project.id}/tasks`

    const read = await withToken(token, 'GET', tasks)
    const write = await withToken(token, 'POST', tasks, { title: 'Nope' })
    const remove = await withToken(token, 'DELETE', `/api/projects/${project.id}`)

    expect(read.statusCode).toBe(200)
    expect([write.statusCode, remove.statusCode]).toEqual([403, 403])
    expect(write.json<{ error: { message: string } }>().error.message).toMatch(/read-only/i)
  })

  it('lets a write token do what its owner can, and no more', async () => {
    const { viewer, member, project } = await ctx.createProject()
    const memberToken = (await createToken(member, { name: 'Writer', scope: 'write' })).token
    const viewerToken = (await createToken(viewer, { name: 'Writer', scope: 'write' })).token
    const tasks = `/api/projects/${project.id}/tasks`

    const asMember = await withToken(memberToken, 'POST', tasks, { title: 'From a script' })
    const asViewer = await withToken(viewerToken, 'POST', tasks, { title: 'Nope' })

    expect(asMember.statusCode).toBe(201)
    expect(asViewer.statusCode).toBe(403)
  })

  it('cannot manage members or delete the project, which would outlast revoking it', async () => {
    const { owner, outsider, member, project } = await ctx.createProject()
    const { token } = await createToken(owner, { name: 'Owner writer', scope: 'write' })
    const base = `/api/projects/${project.id}`

    const responses = await Promise.all([
      withToken(token, 'POST', `${base}/members`, { email: outsider.email, role: 'owner' }),
      ctx.app.inject({
        method: 'PATCH',
        url: `${base}/members/${member.id}`,
        headers: bearer(token),
        payload: { role: 'owner' },
      }),
      withToken(token, 'DELETE', `${base}/members/${member.id}`),
      withToken(token, 'DELETE', base),
    ])
    const stillThere = await withToken(token, 'GET', `${base}/members`)

    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 403])
    expect(stillThere.statusCode).toBe(200)
    expect(stillThere.json()).toHaveLength(3)
  })

  it('lets a read token reach nothing but reads, whatever the path looks like', async () => {
    const { owner, project } = await ctx.createProject()
    const { token } = await createToken(owner, { name: 'Reader', scope: 'read' })
    const attempt = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string) =>
      ctx.app.inject({ method, url, headers: bearer(token), payload: { name: 'X', key: 'XX' } })

    const responses = await Promise.all([
      attempt('POST', '/api/mcp/../projects'),
      attempt('POST', '/api/mcp/x'),
      attempt('POST', '/api/MCP'),
      attempt('POST', '//api/mcp'),
      attempt('PATCH', '/api/mcp'),
      attempt('POST', '/api/projects?x=/api/mcp'),
      attempt('PATCH', `/api/projects/${project.id}`),
    ])
    const projects = await withToken(token, 'GET', '/api/projects')

    for (const response of responses) expect(response.statusCode).toBeGreaterThanOrEqual(400)
    expect(projects.json<{ name: string }[]>().map((item) => item.name)).toEqual([project.name])
  })

  it('cannot manage tokens, so a leaked token cannot mint more', async () => {
    const user = await ctx.signUp()
    const created = await createToken(user, { name: 'Writer', scope: 'write' })

    const responses = await Promise.all([
      withToken(created.token, 'GET', '/api/tokens'),
      withToken(created.token, 'POST', '/api/tokens', { name: 'Child', scope: 'write' }),
      withToken(created.token, 'DELETE', `/api/tokens/${created.id}`),
    ])

    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403])
  })

  it('is only accepted in the Authorization header, never as a cookie', async () => {
    const user = await ctx.signUp()
    const { token } = await createToken(user)

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: token },
    })

    expect(response.statusCode).toBe(401)
  })

  it('records when it was last used', async () => {
    const user = await ctx.signUp()
    const created = await createToken(user)

    await withToken(created.token, 'GET', '/api/auth/me')

    const list = await ctx.request(user, 'GET', '/api/tokens')
    const lastUsedAt = list.json<ApiToken[]>()[0]?.lastUsedAt
    expect(Date.now() - Date.parse(lastUsedAt ?? '')).toBeLessThan(60_000)
  })

  it('stays valid when its owner logs out of the browser, and ignores logout itself', async () => {
    const user = await ctx.signUp()
    const { token } = await createToken(user)

    await withToken(token, 'POST', '/api/auth/logout')
    await ctx.request(user, 'POST', '/api/auth/logout')

    expect((await withToken(token, 'GET', '/api/auth/me')).statusCode).toBe(200)
  })
})

describe('expiry and revocation', () => {
  it('rejects an expired token', async () => {
    const user = await ctx.signUp()
    const { token } = await createToken(user, { name: 'Short', expiresInDays: 1 })
    const twoDaysLater = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)

    await expect(authenticate(ctx.database.db, token, { viaHeader: true })).resolves.not.toBeNull()
    await expect(
      authenticate(ctx.database.db, token, { viaHeader: true, now: twoDaysLater }),
    ).resolves.toBeNull()
  })

  it('rejects a revoked token', async () => {
    const user = await ctx.signUp()
    const created = await createToken(user)

    const revoke = await ctx.request(user, 'DELETE', `/api/tokens/${created.id}`)
    const after = await withToken(created.token, 'GET', '/api/auth/me')

    expect(revoke.statusCode).toBe(204)
    expect(after.statusCode).toBe(401)
  })

  it('does not let one user revoke another’s token', async () => {
    const ann = await ctx.signUp()
    const bob = await ctx.signUp()
    const created = await createToken(ann)

    const response = await ctx.request(bob, 'DELETE', `/api/tokens/${created.id}`)

    expect(response.statusCode).toBe(404)
    expect((await withToken(created.token, 'GET', '/api/auth/me')).statusCode).toBe(200)
  })

  it('rejects something that only looks like a token', async () => {
    const response = await withToken(`${API_TOKEN_PREFIX}not-a-real-token`, 'GET', '/api/auth/me')

    expect(response.statusCode).toBe(401)
  })
})
