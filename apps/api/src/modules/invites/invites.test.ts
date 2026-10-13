import type { CreatedInvite, InvitePreview, Project, ProjectInvite } from '@chilladesk/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projectInvites } from '../../db/schema'
import {
  createTestContext,
  type ProjectFixture,
  type TestContext,
  type TestUser,
} from '../../test/harness'
import { MAX_INVITES_PER_PROJECT } from './service'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

async function invite(fixture: ProjectFixture, role?: string): Promise<CreatedInvite> {
  const response = await fixture.call(fixture.owner, 'POST', '/invites', role ? { role } : {})
  expect(response.statusCode, response.body).toBe(201)
  return response.json<CreatedInvite>()
}

const preview = (user: TestUser, token: string) =>
  ctx.request(user, 'POST', '/api/invites/preview', { token })
const accept = (user: TestUser, token: string) =>
  ctx.request(user, 'POST', '/api/invites/accept', { token })

const roleOf = async (fixture: ProjectFixture, user: TestUser) =>
  (await ctx.request(user, 'GET', `/api/projects/${fixture.project.id}`)).json<Project>().role

describe('managing invite links', () => {
  it('creates a link for members by default, valid for a week, with its token shown once', async () => {
    const fixture = await ctx.createProject()

    const created = await invite(fixture)
    const listed = (await fixture.call(fixture.owner, 'GET', '/invites')).json<ProjectInvite[]>()

    expect(created.role).toBe('member')
    expect(created.token.length).toBeGreaterThan(30)
    const days = (Date.parse(created.expiresAt) - Date.parse(created.createdAt)) / 86_400_000
    expect(Math.round(days)).toBe(7)
    expect(listed).toEqual([
      {
        id: created.id,
        role: 'member',
        createdAt: created.createdAt,
        expiresAt: created.expiresAt,
      },
    ])
    const stored = await ctx.database.db
      .select()
      .from(projectInvites)
      .where(eq(projectInvites.id, created.id))
    expect(stored[0]?.tokenHash).not.toBe(created.token)
  })

  it('can invite viewers, never owners', async () => {
    const fixture = await ctx.createProject()

    const viewer = await invite(fixture, 'viewer')
    const owner = await fixture.call(fixture.owner, 'POST', '/invites', { role: 'owner' })

    expect(viewer.role).toBe('viewer')
    expect(owner.statusCode).toBe(400)
  })

  it('is for owners with a signed-in session only', async () => {
    const fixture = await ctx.createProject()
    const created = await invite(fixture)
    const token = (
      await ctx.request(fixture.owner, 'POST', '/api/tokens', { name: 'Script', scope: 'write' })
    ).json<{ token: string }>().token
    const viaToken = (method: 'GET' | 'POST', payload?: Record<string, unknown>) =>
      ctx.app.inject({
        method,
        url: `/api/projects/${fixture.project.id}/invites`,
        headers: { authorization: `Bearer ${token}` },
        ...(payload ? { payload } : {}),
      })

    const statuses = [
      (await fixture.call(fixture.member, 'GET', '/invites')).statusCode,
      (await fixture.call(fixture.member, 'POST', '/invites', {})).statusCode,
      (await fixture.call(fixture.member, 'DELETE', `/invites/${created.id}`)).statusCode,
      (await fixture.call(fixture.outsider, 'GET', '/invites')).statusCode,
      (await viaToken('GET')).statusCode,
      (await viaToken('POST', {})).statusCode,
    ]

    expect(statuses).toEqual([403, 403, 403, 404, 403, 403])
  })

  it('revokes a link, which then stops working', async () => {
    const fixture = await ctx.createProject()
    const created = await invite(fixture)

    const revoked = await fixture.call(fixture.owner, 'DELETE', `/invites/${created.id}`)
    const again = await fixture.call(fixture.owner, 'DELETE', `/invites/${created.id}`)

    expect([revoked.statusCode, again.statusCode]).toEqual([204, 404])
    expect((await accept(fixture.outsider, created.token)).statusCode).toBe(404)
    expect((await fixture.call(fixture.owner, 'GET', '/invites')).json()).toEqual([])
  })

  it('cannot revoke a link of another project', async () => {
    const [first, second] = [await ctx.createProject(), await ctx.createProject()]
    const created = await invite(first)

    const response = await second.call(second.owner, 'DELETE', `/invites/${created.id}`)

    expect(response.statusCode).toBe(404)
    expect((await preview(first.outsider, created.token)).statusCode).toBe(200)
  })

  it('limits how many links a project has open, not counting expired ones', async () => {
    const fixture = await ctx.createProject()
    for (let index = 0; index < MAX_INVITES_PER_PROJECT; index += 1) await invite(fixture)

    const tooMany = await fixture.call(fixture.owner, 'POST', '/invites', {})
    await ctx.database.db
      .update(projectInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(projectInvites.projectId, fixture.project.id))
    const afterExpiry = await fixture.call(fixture.owner, 'POST', '/invites', {})

    expect([tooMany.statusCode, afterExpiry.statusCode]).toEqual([409, 201])
    expect((await fixture.call(fixture.owner, 'GET', '/invites')).json()).toHaveLength(1)
  })
})

describe('using an invite link', () => {
  it('shows what the link is for without giving access', async () => {
    const fixture = await ctx.createProject()
    const { token } = await invite(fixture, 'viewer')

    const response = await preview(fixture.outsider, token)

    expect(response.json<InvitePreview>()).toEqual({
      project: { id: fixture.project.id, key: fixture.project.key, name: fixture.project.name },
      role: 'viewer',
      alreadyMember: false,
    })
    const project = await ctx.request(
      fixture.outsider,
      'GET',
      `/api/projects/${fixture.project.id}`,
    )
    expect(project.statusCode).toBe(404)
  })

  it('makes whoever accepts it a member with the role of the link, as often as it is used', async () => {
    const fixture = await ctx.createProject()
    const { token } = await invite(fixture, 'viewer')
    const another = await ctx.signUp('Another Guest')

    const joined = await accept(fixture.outsider, token)
    await accept(another, token)

    expect(joined.statusCode, joined.body).toBe(200)
    expect(joined.json<Project>()).toMatchObject({ id: fixture.project.id, role: 'viewer' })
    expect(await roleOf(fixture, fixture.outsider)).toBe('viewer')
    expect(await roleOf(fixture, another)).toBe('viewer')
  })

  it('leaves the role of someone who is a member already', async () => {
    const fixture = await ctx.createProject()
    const { token } = await invite(fixture, 'viewer')

    const before = (await preview(fixture.owner, token)).json<InvitePreview>()
    const response = await accept(fixture.owner, token)

    expect(before.alreadyMember).toBe(true)
    expect(response.json<Project>().role).toBe('owner')
    expect(await roleOf(fixture, fixture.owner)).toBe('owner')
  })

  it('answers the same for an unknown, an expired and a malformed token', async () => {
    const fixture = await ctx.createProject()
    const expired = await invite(fixture)
    await ctx.database.db
      .update(projectInvites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(projectInvites.id, expired.id))

    const answers = await Promise.all([
      accept(fixture.outsider, 'no-such-token'),
      accept(fixture.outsider, expired.token),
      preview(fixture.outsider, expired.token),
    ])

    expect(answers.map((response) => response.statusCode)).toEqual([404, 404, 404])
    expect(new Set(answers.map((response) => response.body)).size).toBe(1)
    expect((await accept(fixture.outsider, '')).statusCode).toBe(400)
  })

  it('needs an account: a session to accept, nothing anonymous', async () => {
    const fixture = await ctx.createProject()
    const { token } = await invite(fixture)
    const apiToken = (
      await ctx.request(fixture.outsider, 'POST', '/api/tokens', { name: 'S', scope: 'write' })
    ).json<{ token: string }>().token

    const anonymous = await ctx.app.inject({
      method: 'POST',
      url: '/api/invites/accept',
      payload: { token },
    })
    const viaToken = await ctx.app.inject({
      method: 'POST',
      url: '/api/invites/accept',
      headers: { authorization: `Bearer ${apiToken}` },
      payload: { token },
    })

    expect([anonymous.statusCode, viaToken.statusCode]).toEqual([401, 403])
  })

  it('tells the newcomer and the project, once', async () => {
    const fixture = await ctx.createProject()
    const { token } = await invite(fixture)
    const listen = (user: TestUser) => {
      const received: { type: string }[] = []
      const stop = ctx.app.events.subscribe({
        userId: user.id,
        send: (event) => void received.push(event),
        close: () => undefined,
      })
      return { received, stop }
    }
    const [owner, guest] = [listen(fixture.owner), listen(fixture.outsider)]

    await accept(fixture.outsider, token)
    await accept(fixture.outsider, token)

    await expect
      .poll(() => owner.received)
      .toEqual([{ type: 'project_changed', projectId: fixture.project.id, resource: 'members' }])
    expect(guest.received.filter((event) => event.type === 'access_changed')).toHaveLength(1)
    owner.stop()
    guest.stop()
  })

  it('goes away with its project', async () => {
    const fixture = await ctx.createProject()
    const { token } = await invite(fixture)

    await fixture.call(fixture.owner, 'DELETE', '')

    expect((await accept(fixture.outsider, token)).statusCode).toBe(404)
  })
})

describe('guessing at invite links', () => {
  it('is slowed down per client', async () => {
    const limited = await createTestContext({ inviteRateLimitMax: 3 })
    const user = await limited.signUp()
    const attempt = () => limited.request(user, 'POST', '/api/invites/preview', { token: 'guess' })

    const statuses = []
    for (let index = 0; index < 4; index += 1) statuses.push((await attempt()).statusCode)
    await limited.close()

    expect(statuses).toEqual([404, 404, 404, 429])
  })
})
