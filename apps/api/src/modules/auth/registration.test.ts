import type { AuthResponse, CreatedInvite, ProjectMember } from '@chilladesk/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../../config'
import { createTestContext, TEST_PASSWORD, type TestContext } from '../../test/harness'
import type { MailMessage } from '../notifications/mailer'

let invitesOnly: TestContext
let invitesOnlyWithMail: TestContext
const outbox: MailMessage[] = []

beforeAll(async () => {
  invitesOnly = await createTestContext({ registration: 'invite' })
  // Someone is in already, so the rules for everyone after the first apply.
  await invitesOnly.signUp()
  invitesOnlyWithMail = await createTestContext({
    registration: 'invite',
    mail: { publicUrl: 'https://desk.example.com', send: async (m) => void outbox.push(m) },
  })
})

afterAll(async () => {
  await invitesOnly.close()
  await invitesOnlyWithMail.close()
})

let counter = 0
const newcomer = () => {
  counter += 1
  return { email: `newcomer${counter}@example.com`, name: 'New Person', password: TEST_PASSWORD }
}

async function inviteLink(ctx: TestContext, role: 'member' | 'viewer' = 'member') {
  const fixture = await ctx.createProject()
  const created = await fixture.call(fixture.owner, 'POST', '/invites', { role })
  expect(created.statusCode, created.body).toBe(201)
  return { fixture, token: created.json<CreatedInvite>().token }
}

const register = (ctx: TestContext, payload: Record<string, unknown>) =>
  ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload })

describe('signing up by invitation only', () => {
  it('lets the first person of a new server in without an invite', async () => {
    const fresh = await createTestContext({ registration: 'invite' })
    const before = await fresh.app.inject({ method: 'GET', url: '/api/auth/options' })
    const first = await register(fresh, newcomer())
    const second = await register(fresh, newcomer())
    const after = await fresh.app.inject({ method: 'GET', url: '/api/auth/options' })
    await fresh.close()

    expect(before.json()).toMatchObject({ registration: 'open' })
    expect([first.statusCode, second.statusCode]).toEqual([201, 403])
    expect(after.json()).toMatchObject({ registration: 'invite' })
  })

  it('says so in the options of the server', async () => {
    const options = await invitesOnly.app.inject({ method: 'GET', url: '/api/auth/options' })
    expect(options.json()).toMatchObject({ registrationEnabled: false, registration: 'invite' })
  })

  it('refuses a sign-up without a link that still works', async () => {
    const without = await register(invitesOnly, newcomer())
    const madeUp = await register(invitesOnly, { ...newcomer(), inviteToken: 'made-up' })

    expect([without.statusCode, madeUp.statusCode]).toEqual([403, 403])
    expect(without.json()).toMatchObject({ error: { message: /invitation only/ } })
  })

  it('takes a sign-up with an invite link and puts the newcomer in the project', async () => {
    const { fixture, token } = await inviteLink(invitesOnly, 'viewer')

    const response = await register(invitesOnly, { ...newcomer(), inviteToken: token })

    expect(response.statusCode, response.body).toBe(201)
    const { user } = response.json<AuthResponse>()
    const members = (await fixture.call(fixture.owner, 'GET', '/members')).json<ProjectMember[]>()
    expect(members).toContainEqual(expect.objectContaining({ userId: user.id, role: 'viewer' }))
  })

  it('with email, adds the newcomer once the sign-up is finished from the link', async () => {
    const { fixture, token } = await inviteLink(invitesOnlyWithMail)
    const person = newcomer()

    const started = await register(invitesOnlyWithMail, { ...person, inviteToken: token })
    expect(started.statusCode).toBe(202)
    const refused = await register(invitesOnlyWithMail, newcomer())
    expect(refused.statusCode).toBe(403)

    await expect.poll(() => outbox.find((message) => message.to === person.email)).toBeDefined()
    const link = outbox.find((message) => message.to === person.email)?.text ?? ''
    const confirmToken = /#token=(\S+)/.exec(link)?.[1] ?? ''
    const membersBefore = (await fixture.call(fixture.owner, 'GET', '/members')).json<
      ProjectMember[]
    >()
    expect(membersBefore.map((member) => member.email)).not.toContain(person.email)

    const done = await invitesOnlyWithMail.app.inject({
      method: 'POST',
      url: '/api/auth/verify-email/complete',
      payload: { token: confirmToken, password: TEST_PASSWORD },
    })
    expect(done.statusCode, done.body).toBe(200)
    const members = (await fixture.call(fixture.owner, 'GET', '/members')).json<ProjectMember[]>()
    expect(members.map((member) => member.email)).toContain(person.email)
  })

  it('is set with REGISTRATION_ENABLED=invite', () => {
    expect(loadConfig({ REGISTRATION_ENABLED: 'invite' }).registration).toBe('invite')
    expect(loadConfig({ REGISTRATION_ENABLED: 'false' }).registration).toBe('closed')
    expect(loadConfig({}).registration).toBe('open')
  })
})

describe('an invite link on a server open to everyone', () => {
  it('also puts the newcomer straight into the project', async () => {
    const open = await createTestContext()
    const { fixture, token } = await inviteLink(open)

    const response = await register(open, { ...newcomer(), inviteToken: token })
    const members = (await fixture.call(fixture.owner, 'GET', '/members')).json<ProjectMember[]>()
    await open.close()

    expect(response.statusCode).toBe(201)
    expect(members).toHaveLength(4)
  })
})
