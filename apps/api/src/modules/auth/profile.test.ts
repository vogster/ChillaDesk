import type { AuthResponse, Project, Status, Task, User } from '@chilladesk/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { notifications, users } from '../../db/schema'
import { createTestContext, TEST_PASSWORD, type TestContext } from '../../test/harness'
import { deliverPending, type MailMessage } from '../notifications/mailer'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

let counter = 0
async function register(extra: Record<string, unknown> = {}) {
  counter += 1
  const email = `profile${counter}@example.com`
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, name: 'Pat', password: TEST_PASSWORD, ...extra },
  })
  expect(response.statusCode, response.body).toBe(201)
  const { user, token } = response.json<AuthResponse>()
  return { user, token, email, headers: { authorization: `Bearer ${token}` } }
}

const me = async (headers: { authorization: string }) =>
  (await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers })).json<User>()

describe('the profile', () => {
  it('starts with emails on, no language and an unverified address', async () => {
    const { user } = await register()

    expect(user).toMatchObject({
      name: 'Pat',
      locale: null,
      emailNotifications: true,
      emailVerified: false,
    })
  })

  it('remembers the language chosen at registration and refuses one it does not have', async () => {
    const { user } = await register({ locale: 'ru' })
    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@example.com', name: 'X', password: TEST_PASSWORD, locale: 'xx' },
    })

    expect(user.locale).toBe('ru')
    expect(unknown.statusCode).toBe(400)
  })

  it('changes the name, the language and the email preference', async () => {
    const { headers } = await register()

    const response = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers,
      payload: { name: '  Patricia  ', locale: 'ru', emailNotifications: false },
    })

    const expected = { name: 'Patricia', locale: 'ru', emailNotifications: false }
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject(expected)
    expect(await me(headers)).toMatchObject(expected)
  })

  it('rejects an empty change, an empty name and an unknown language', async () => {
    const { headers } = await register()
    const patch = (payload: Record<string, unknown>) =>
      ctx.app.inject({ method: 'PATCH', url: '/api/auth/me', headers, payload })

    const statuses = await Promise.all([patch({}), patch({ name: '   ' }), patch({ locale: 'de' })])

    expect(statuses.map((response) => response.statusCode)).toEqual([400, 400, 400])
  })

  it('needs a signed-in session: no anonymous access and no API token', async () => {
    const { headers } = await register()
    const token = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/tokens',
        headers,
        payload: { name: 'Script', scope: 'write' },
      })
    ).json<{ token: string }>().token
    const viaToken = { authorization: `Bearer ${token}` }

    const anonymous = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      payload: { name: 'Nobody' },
    })
    const profile = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: viaToken,
      payload: { name: 'Robot' },
    })
    const password = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/password',
      headers: viaToken,
      payload: { currentPassword: TEST_PASSWORD, newPassword: 'another long password' },
    })

    expect([anonymous.statusCode, profile.statusCode, password.statusCode]).toEqual([401, 403, 403])
    expect((await me(headers)).name).toBe('Pat')
  })
})

describe('changing the password', () => {
  const NEW_PASSWORD = 'a brand new password'
  const login = (email: string, password: string) =>
    ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })
  const change = (headers: { authorization: string }, payload: Record<string, unknown>) =>
    ctx.app.inject({ method: 'POST', url: '/api/auth/password', headers, payload })

  it('replaces the password and signs the account out everywhere else', async () => {
    const { headers, email } = await register()
    const elsewhere = (await login(email, TEST_PASSWORD)).json<AuthResponse>().token

    const response = await change(headers, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    })

    expect(response.statusCode, response.body).toBe(204)
    expect((await login(email, TEST_PASSWORD)).statusCode).toBe(401)
    expect((await login(email, NEW_PASSWORD)).statusCode).toBe(200)
    // The session that made the change goes on; the other one is gone.
    expect((await me(headers)).email).toBe(email)
    const other = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${elsewhere}` },
    })
    expect(other.statusCode).toBe(401)
  })

  it('refuses a wrong current password and says which field it is about', async () => {
    const { headers, email } = await register()

    const response = await change(headers, {
      currentPassword: 'not the password',
      newPassword: NEW_PASSWORD,
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: [{ path: 'currentPassword' }] },
    })
    expect((await login(email, TEST_PASSWORD)).statusCode).toBe(200)
  })

  it('refuses a new password that is too short', async () => {
    const { headers } = await register()

    const response = await change(headers, { currentPassword: TEST_PASSWORD, newPassword: 'short' })

    expect(response.statusCode).toBe(400)
  })
})

describe('what the profile changes elsewhere', () => {
  it('names the columns of a new project in the language of its creator', async () => {
    const russian = await register({ locale: 'ru' })
    const english = await register()
    const columnsOf = async (headers: { authorization: string }, key: string) => {
      const project = (
        await ctx.app.inject({
          method: 'POST',
          url: '/api/projects',
          headers,
          payload: { name: 'Columns', key },
        })
      ).json<Project>()
      const statuses = await ctx.app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}/statuses`,
        headers,
      })
      return statuses.json<Status[]>().map((status) => [status.name, status.category])
    }

    expect(await columnsOf(russian.headers, 'COLRU')).toEqual([
      ['К выполнению', 'todo'],
      ['В работе', 'in_progress'],
      ['Готово', 'done'],
    ])
    expect(await columnsOf(english.headers, 'COLEN')).toEqual([
      ['To Do', 'todo'],
      ['In Progress', 'in_progress'],
      ['Done', 'done'],
    ])
  })

  it('sends no notification emails to someone who turned them off', async () => {
    const fixture = await ctx.createProject()
    await ctx.database.db.delete(notifications)
    await ctx.request(fixture.member, 'PATCH', '/api/auth/me', { emailNotifications: false })
    const assign = (assigneeId: string) =>
      fixture.call(fixture.owner, 'POST', '/tasks', { title: 'For you', assigneeId })
    expect((await assign(fixture.member.id)).json<Task>().assignee?.id).toBe(fixture.member.id)
    await assign(fixture.viewer.id)
    const sent: MailMessage[] = []
    await ctx.database.db.update(users).set({ emailVerifiedAt: new Date() })

    await deliverPending(ctx.database.db, async (message) => void sent.push(message), {
      publicUrl: 'https://desk.example.com',
    })

    expect(sent.map((message) => message.to)).toEqual([fixture.viewer.email])
    // Still in the app.
    const inbox = await ctx.request(fixture.member, 'GET', '/api/notifications')
    expect(inbox.json<{ unreadCount: number }>().unreadCount).toBe(1)
  })
})
