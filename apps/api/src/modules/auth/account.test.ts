import type { Project, Task, User } from '@chilladesk/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { projects } from '../../db/schema'
import { createTestContext, TEST_PASSWORD, type TestContext } from '../../test/harness'
import type { MailMessage } from '../notifications/mailer'

let plain: TestContext
let withMail: TestContext
let outbox: MailMessage[] = []

beforeAll(async () => {
  plain = await createTestContext()
  withMail = await createTestContext({
    mail: {
      publicUrl: 'https://desk.example.com',
      send: async (message) => void outbox.push(message),
    },
  })
})

afterAll(async () => {
  await plain.close()
  await withMail.close()
})

beforeEach(() => {
  outbox = []
})

let counter = 0
const freshAddress = () => {
  counter += 1
  return `moved${counter}@example.com`
}

const login = (ctx: TestContext, email: string, password = TEST_PASSWORD) =>
  ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } })

async function emailTo(address: string, subject: RegExp) {
  const find = () =>
    outbox.find((message) => message.to === address && subject.test(message.subject))
  await expect.poll(find).toBeDefined()
  const message = find() as MailMessage
  const token = /#token=(\S+)/.exec(message.text)?.[1] ?? ''
  return { message, token }
}

describe('changing the email address without email set up', () => {
  it('changes it at once with the password, and refuses what cannot be', async () => {
    const ann = await plain.signUp()
    const other = await plain.signUp()
    const address = freshAddress()
    const change = (payload: Record<string, unknown>) =>
      plain.request(ann, 'POST', '/api/auth/email', payload)

    expect((await change({ email: address, password: 'wrong' })).statusCode).toBe(400)
    expect((await change({ email: ann.email, password: TEST_PASSWORD })).statusCode).toBe(400)
    expect((await change({ email: other.email, password: TEST_PASSWORD })).statusCode).toBe(409)
    const moved = await change({ email: address.toUpperCase(), password: TEST_PASSWORD })

    expect(moved.statusCode, moved.body).toBe(200)
    expect(moved.json<User>()).toMatchObject({ email: address, emailVerified: false })
    expect((await login(plain, address)).statusCode).toBe(200)
    expect((await login(plain, ann.email)).statusCode).toBe(401)
  })

  it('is for a signed-in session, not an API token', async () => {
    const ann = await plain.signUp()
    const token = (
      await plain.request(ann, 'POST', '/api/tokens', { name: 'script', scope: 'write' })
    ).json<{ token: string }>().token

    const response = await plain.app.inject({
      method: 'POST',
      url: '/api/auth/email',
      headers: { authorization: `Bearer ${token}` },
      payload: { email: freshAddress(), password: TEST_PASSWORD },
    })

    expect(response.statusCode).toBe(403)
  })
})

describe('changing the email address with email set up', () => {
  it('sends a link to the new address, which moves the account when its owner opens it', async () => {
    const ann = await withMail.signUp()
    const address = freshAddress()

    const asked = await withMail.request(ann, 'POST', '/api/auth/email', {
      email: address,
      password: TEST_PASSWORD,
    })
    expect(asked.statusCode).toBe(202)
    const { token, message } = await emailTo(address, /Confirm the new email address/)
    expect(message.text).toContain('https://desk.example.com/confirm-email#token=')

    const stranger = await withMail.signUp()
    const wrongOwner = await withMail.request(stranger, 'POST', '/api/auth/email/confirm', {
      token,
    })
    expect(wrongOwner.statusCode).toBe(400)

    const confirmed = await withMail.request(ann, 'POST', '/api/auth/email/confirm', { token })
    expect(confirmed.statusCode, confirmed.body).toBe(200)
    expect(confirmed.json<User>()).toMatchObject({ email: address, emailVerified: true })
    // The old address hears of it, without the new one being named.
    const notice = await emailTo(ann.email, /was changed/)
    expect(notice.message.text).not.toContain(address)
    expect(
      (await withMail.request(ann, 'POST', '/api/auth/email/confirm', { token })).statusCode,
    ).toBe(400)
  })

  it('answers the same for a taken address, tells its owner and changes nothing', async () => {
    const ann = await withMail.signUp()
    const bob = await withMail.signUp()

    const free = await withMail.request(ann, 'POST', '/api/auth/email', {
      email: freshAddress(),
      password: TEST_PASSWORD,
    })
    const taken = await withMail.request(ann, 'POST', '/api/auth/email', {
      email: bob.email,
      password: TEST_PASSWORD,
    })

    expect([free.statusCode, taken.statusCode]).toEqual([202, 202])
    expect(free.body).toBe(taken.body)
    await emailTo(bob.email, /already has a ChillaDesk account/)
    expect((await login(withMail, ann.email)).statusCode).toBe(200)
  })
})

describe('deleting the account', () => {
  async function project(ctx: TestContext, owner: Awaited<ReturnType<TestContext['signUp']>>) {
    counter += 1
    const created = await ctx.request(owner, 'POST', '/api/projects', {
      name: `Doomed ${counter}`,
      key: `D${counter}X`,
    })
    expect(created.statusCode, created.body).toBe(201)
    return created.json<Project>()
  }

  it('takes projects only this person was in, and leaves their work in shared ones', async () => {
    const fixture = await plain.createProject()
    const ann = fixture.member
    const solo = await project(plain, ann)
    const task = (
      await fixture.call(ann, 'POST', '/tasks', { title: 'Written by Ann' })
    ).json<Task>()

    const wrong = await plain.request(ann, 'POST', '/api/auth/me/delete', { password: 'nope' })
    const deleted = await plain.request(ann, 'POST', '/api/auth/me/delete', {
      password: TEST_PASSWORD,
    })

    expect([wrong.statusCode, deleted.statusCode]).toEqual([400, 204])
    expect(await plain.database.db.select().from(projects).where(eq(projects.id, solo.id))).toEqual(
      [],
    )
    const kept = await fixture.call(fixture.owner, 'GET', `/tasks/${task.id}`)
    expect(kept.json<Task>()).toMatchObject({ title: 'Written by Ann', reporter: null })
    expect((await login(plain, ann.email)).statusCode).toBe(401)
    expect((await plain.request(ann, 'GET', '/api/auth/me')).statusCode).toBe(401)
  })

  it('asks to hand over projects that would be left without an owner', async () => {
    const fixture = await plain.createProject()

    const refused = await plain.request(fixture.owner, 'POST', '/api/auth/me/delete', {
      password: TEST_PASSWORD,
    })

    expect(refused.statusCode).toBe(409)
    expect(refused.json()).toMatchObject({
      error: { details: [{ path: 'projects', message: fixture.project.name }] },
    })
    await fixture.call(fixture.owner, 'PATCH', `/members/${fixture.member.id}`, { role: 'owner' })
    const handedOver = await plain.request(fixture.owner, 'POST', '/api/auth/me/delete', {
      password: TEST_PASSWORD,
    })
    expect(handedOver.statusCode).toBe(204)
    expect((await fixture.call(fixture.member, 'GET', '')).statusCode).toBe(200)
  })
})
