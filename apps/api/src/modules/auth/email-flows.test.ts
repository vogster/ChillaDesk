import type { AuthResponse, User } from '@chilladesk/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { emailTokens, notifications, users } from '../../db/schema'
import { createTestContext, TEST_PASSWORD, type TestContext } from '../../test/harness'
import { deliverPending, type MailMessage } from '../notifications/mailer'
import { register as registerAccount } from './service'

const PUBLIC_URL = 'https://desk.example.com/'
const NEW_PASSWORD = 'a brand new password'

let ctx: TestContext
let outbox: MailMessage[] = []
let mailDown = false

beforeAll(async () => {
  ctx = await createTestContext({
    accountEmailRateLimitMax: 3,
    accountRateLimitMax: 5,
    mail: {
      publicUrl: PUBLIC_URL,
      send: async (message) => {
        if (mailDown)
          throw Object.assign(new Error(`cannot reach ${message.to}`), { code: 'ECONN' })
        outbox.push(message)
      },
    },
  })
})

afterAll(async () => {
  await ctx.close()
})

beforeEach(() => {
  outbox = []
  mailDown = false
})

let counter = 0
const nextEmail = () => {
  counter += 1
  return `mail${counter}@example.com`
}

/**
 * A signed-in account whose address is not confirmed yet, as accounts made before the
 * server sent email are, and the confirmation email it asked for.
 */
async function register(extra: { locale?: 'en' | 'ru' } = {}) {
  const email = nextEmail()
  const { user, token } = await registerAccount(
    ctx.database.db,
    { email, name: 'Pat', password: TEST_PASSWORD, ...extra },
    { registrationEnabled: true },
  )
  const headers = { authorization: `Bearer ${token}` }
  const resent = await post('/verify-email/resend', undefined, headers)
  expect(resent.statusCode, resent.body).toBe(204)
  return { user, email, headers }
}

/** A sign-up through the API, as a visitor makes it. */
const signUp = (email: string, extra: Record<string, unknown> = {}) =>
  post('/register', { email, name: 'Pat', password: TEST_PASSWORD, ...extra })

const post = (url: string, payload?: Record<string, unknown>, headers?: Record<string, string>) =>
  ctx.app.inject({
    method: 'POST',
    url: `/api/auth${url}`,
    ...(payload ? { payload } : {}),
    ...(headers ? { headers } : {}),
  })

/** Waits for the email to an address and returns it with the token from its link. */
async function emailTo(address: string, subject: RegExp) {
  const find = () =>
    outbox.find((message) => message.to === address && subject.test(message.subject))
  await expect.poll(find).toBeDefined()
  const message = find() as MailMessage
  const [, page, token] =
    /https:\/\/desk\.example\.com\/([\w-]+)#token=(\S+)/.exec(message.text) ?? []
  return { message, page, token: token ?? '' }
}

const me = async (headers: Record<string, string>) =>
  (await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers })).json<User>()
const login = (email: string, password: string) => post('/login', { email, password })

describe('options', () => {
  it('says that this server sends email, and one without mail settings that it does not', async () => {
    const plain = await createTestContext({ registrationEnabled: false })

    const withMail = await ctx.app.inject({ method: 'GET', url: '/api/auth/options' })
    const without = await plain.app.inject({ method: 'GET', url: '/api/auth/options' })
    await plain.close()

    expect(withMail.json()).toEqual({ registrationEnabled: true, emailEnabled: true })
    expect(without.json()).toEqual({ registrationEnabled: false, emailEnabled: false })
  })
})

describe('signing up on a server that sends email', () => {
  it('answers the same for a free address and a taken one', async () => {
    const free = nextEmail()
    const { email: taken } = await register()
    outbox = []

    const first = await signUp(free)
    const second = await signUp(taken, { password: 'someone elses password' })

    expect([first.statusCode, second.statusCode]).toEqual([202, 202])
    expect(first.body).toBe(second.body)
    expect(first.headers['set-cookie']).toBeUndefined()
    // The owner of the taken address hears about it; their account is as it was.
    const notice = await emailTo(taken, /already have a ChillaDesk account/)
    expect(notice.message.text).toContain('https://desk.example.com/forgot-password')
    expect((await login(taken, TEST_PASSWORD)).statusCode).toBe(200)
    expect((await login(taken, 'someone elses password')).statusCode).toBe(401)
  })

  it('sends a link that finishes the sign-up with the password, in the chosen language', async () => {
    const english = nextEmail()
    const russian = nextEmail()
    await signUp(english)
    await signUp(russian, { locale: 'ru' })

    const first = await emailTo(english, /Confirm your email address/)
    const second = await emailTo(russian, /Подтвердите адрес почты/)
    expect(first.page).toBe('verify-email')
    expect(second.message.text).toContain('Здравствуйте!')
    // Nothing the registrant typed is carried to the address, which may not be theirs.
    expect(first.message.text + second.message.text).not.toContain('Pat')

    // Until then the account cannot be used, and says so no differently than a wrong password.
    const early = await login(english, TEST_PASSWORD)
    expect(early.statusCode).toBe(401)
    expect(early.body).toBe((await login(english, 'wrong password')).body)

    const wrong = await post('/verify-email/complete', { token: first.token, password: 'nope' })
    const done = await post('/verify-email/complete', {
      token: first.token,
      password: TEST_PASSWORD,
    })
    expect([wrong.statusCode, done.statusCode]).toEqual([401, 200])
    const session = done.json<AuthResponse>()
    expect(session.user).toMatchObject({ email: english, emailVerified: true })
    expect(done.headers['set-cookie']).toBeDefined()
    expect((await login(english, TEST_PASSWORD)).statusCode).toBe(200)
    expect(
      (await post('/verify-email/complete', { token: first.token, password: TEST_PASSWORD }))
        .statusCode,
    ).toBe(400)
  })

  it('cannot be finished by someone who has the link but not the password', async () => {
    const victim = nextEmail()
    // A stranger signs up with the victim's address and a password of their own.
    await signUp(victim, { password: 'the strangers password' })
    const strangers = await emailTo(victim, /Confirm/)

    // The victim clicks the link they did not ask for; without that password nothing happens.
    const attempt = await post('/verify-email/complete', {
      token: strangers.token,
      password: TEST_PASSWORD,
    })
    expect(attempt.statusCode).toBe(401)

    // Signing up themselves replaces the unfinished account, and the old link stops working.
    outbox = []
    await signUp(victim)
    const own = await emailTo(victim, /Confirm/)
    expect(
      (
        await post('/verify-email/complete', {
          token: strangers.token,
          password: 'the strangers password',
        })
      ).statusCode,
    ).toBe(400)
    expect(
      (await post('/verify-email/complete', { token: own.token, password: TEST_PASSWORD }))
        .statusCode,
    ).toBe(200)
  })

  it('is also finished by choosing a new password from a reset link', async () => {
    const email = nextEmail()
    await signUp(email)
    await emailTo(email, /Confirm/)
    await post('/password-reset', { email })
    const { token } = await emailTo(email, /Reset your/)

    await post('/password-reset/confirm', { token, password: NEW_PASSWORD })

    const session = await login(email, NEW_PASSWORD)
    expect(session.statusCode).toBe(200)
    expect(session.json<AuthResponse>().user.emailVerified).toBe(true)
  })

  it('answers the same when the mail server is down, and when signing up is turned off', async () => {
    mailDown = true
    expect((await signUp(nextEmail())).statusCode).toBe(202)

    const closed = await createTestContext({
      registrationEnabled: false,
      mail: { publicUrl: PUBLIC_URL, send: async () => undefined },
    })
    const refused = await closed.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: nextEmail(), name: 'Pat', password: TEST_PASSWORD },
    })
    await closed.close()
    expect(refused.statusCode).toBe(403)
  })

  it('sends one address no more emails than the limit, however often it is used', async () => {
    const email = nextEmail()
    for (let index = 0; index < 6; index += 1) {
      expect((await signUp(email)).statusCode).toBe(202)
    }
    await emailTo(email, /Confirm/)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(outbox.filter((message) => message.to === email)).toHaveLength(3)
  })
})

describe('unfinished sign-ups under pressure', () => {
  it('does not finish an account whose password changed after the link was opened', async () => {
    const email = nextEmail()
    await signUp(email)
    const { token } = await emailTo(email, /Confirm/)
    // As if a second sign-up of the address had just replaced the password.
    await ctx.database.db
      .update(users)
      .set({ passwordHash: 'replaced' })
      .where(eq(users.email, email))

    const late = await post('/verify-email/complete', { token, password: TEST_PASSWORD })

    expect(late.statusCode).toBe(401)
    const [stored] = await ctx.database.db.select().from(users).where(eq(users.email, email))
    expect(stored?.pendingSince).not.toBeNull()
  })

  it('counts wrong passwords at the link against the account', async () => {
    const email = nextEmail()
    await signUp(email)
    const { token } = await emailTo(email, /Confirm/)

    const statuses = []
    for (let index = 0; index < 6; index += 1) {
      statuses.push(
        (await post('/verify-email/complete', { token, password: `guess ${index}` })).statusCode,
      )
    }

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
  })

  it('keeps sign-ups from using up the password resets of an address', async () => {
    const { email } = await register()
    outbox = []
    for (let index = 0; index < 4; index += 1) await signUp(email)

    await post('/password-reset', { email })

    await emailTo(email, /Reset your/)
  })

  it('drops what a stranger typed when the owner finishes the sign-up with a reset', async () => {
    const email = nextEmail()
    await signUp(email, { name: 'Strange Name', locale: 'ru' })
    await emailTo(email, /Подтвердите/)
    await post('/password-reset', { email })
    const { token } = await emailTo(email, /Сброс пароля/)

    await post('/password-reset/confirm', { token, password: NEW_PASSWORD })

    const session = (await login(email, NEW_PASSWORD)).json<AuthResponse>()
    expect(session.user.name).toBe(email.split('@')[0])
    expect(session.user.locale).toBeNull()
  })

  it('forgets sign-ups nobody finished in time', async () => {
    const stale = nextEmail()
    await signUp(stale)
    await emailTo(stale, /Confirm/)
    await ctx.database.db
      .update(users)
      .set({ pendingSince: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) })
      .where(eq(users.email, stale))

    const fresh = nextEmail()
    await signUp(fresh)
    await emailTo(fresh, /Confirm/)

    expect(await ctx.database.db.select().from(users).where(eq(users.email, stale))).toEqual([])
  })

  it('lets a server without email reuse the address of an unfinished sign-up', async () => {
    const plain = await createTestContext()
    const email = nextEmail()
    await plain.database.db.insert(users).values({
      email,
      name: 'Left over',
      passwordHash: 'x',
      pendingSince: new Date(),
    })

    const response = await plain.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, name: 'Pat', password: TEST_PASSWORD },
    })
    await plain.close()

    expect(response.statusCode, response.body).toBe(201)
  })
})

describe('confirming the email address', () => {
  it('sends a link on request, in the language of the account', async () => {
    const english = await register()
    const russian = await register({ locale: 'ru' })

    const first = await emailTo(english.email, /Confirm your email address/)
    const second = await emailTo(russian.email, /Подтвердите адрес почты/)

    expect(first.page).toBe('verify-email')
    expect(first.message.text).toContain('Hello,')
    expect(second.message.text).toContain('Здравствуйте!')
    expect(first.message.text + second.message.text).not.toContain('Pat')
    expect(english.user.emailVerified).toBe(false)
  })

  it('marks the address as confirmed with the token, once', async () => {
    const { email, headers } = await register()
    const { token } = await emailTo(email, /Confirm/)

    const confirmed = await post('/verify-email', { token }, headers)
    const again = await post('/verify-email', { token }, headers)

    expect([confirmed.statusCode, again.statusCode]).toEqual([204, 400])
    expect((await me(headers)).emailVerified).toBe(true)
    // Only the hash was ever stored, and the used token is gone.
    expect(await ctx.database.db.select().from(emailTokens)).not.toContainEqual(
      expect.objectContaining({ tokenHash: token }),
    )
  })

  it('refuses a made-up token, an expired one and a token of the other kind', async () => {
    const { email, user, headers } = await register()
    const verify = await emailTo(email, /Confirm/)
    await post('/password-reset', { email })
    const reset = await emailTo(email, /Reset your/)
    await ctx.database.db
      .update(emailTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(emailTokens.userId, user.id))

    const answers = await Promise.all([
      post('/verify-email', { token: 'made-up' }, headers),
      post('/verify-email', { token: verify.token }, headers),
      post('/verify-email', { token: reset.token }, headers),
    ])

    expect(answers.map((response) => response.statusCode)).toEqual([400, 400, 400])
    expect(new Set(answers.map((response) => response.body)).size).toBe(1)
  })

  it('needs the session of that very account: the link alone confirms nothing', async () => {
    const squatter = await register()
    const someoneElse = await register()
    const { token } = await emailTo(squatter.email, /Confirm/)

    const anonymous = await post('/verify-email', { token })
    const other = await post('/verify-email', { token }, someoneElse.headers)

    expect([anonymous.statusCode, other.statusCode]).toEqual([401, 400])
    expect((await me(squatter.headers)).emailVerified).toBe(false)
    expect((await post('/verify-email', { token }, squatter.headers)).statusCode).toBe(204)
  })

  it('answers a failing mail server without quoting it, and logs no address', async () => {
    const { headers } = await register()
    mailDown = true

    const response = await post('/verify-email/resend', undefined, headers)

    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('example.com')
  })

  it('sends the link again on request, which replaces the old one', async () => {
    const { email, headers } = await register()
    const first = await emailTo(email, /Confirm/)
    outbox = []

    const resent = await post('/verify-email/resend', undefined, headers)
    const second = await emailTo(email, /Confirm/)

    expect(resent.statusCode, resent.body).toBe(204)
    expect(second.token).not.toBe(first.token)
    expect((await post('/verify-email', { token: first.token }, headers)).statusCode).toBe(400)
    expect((await post('/verify-email', { token: second.token }, headers)).statusCode).toBe(204)
    // Nothing more to confirm.
    expect((await post('/verify-email/resend', undefined, headers)).statusCode).toBe(409)
  })

  it('limits how many emails one account can ask for', async () => {
    const { headers } = await register()

    const statuses = []
    for (let index = 0; index < 3; index += 1) {
      statuses.push((await post('/verify-email/resend', undefined, headers)).statusCode)
    }

    // Registration sent the first of the three allowed.
    expect(statuses).toEqual([204, 204, 429])
    expect((await post('/verify-email/resend')).statusCode).toBe(401)
  })
})

describe('resetting a forgotten password', () => {
  it('emails a link that sets a new password and signs the account out everywhere', async () => {
    const { email, headers } = await register({ locale: 'ru' })

    const asked = await post('/password-reset', { email: email.toUpperCase() })
    const { token, page, message } = await emailTo(email, /Сброс пароля/)
    const done = await post('/password-reset/confirm', { token, password: NEW_PASSWORD })

    expect([asked.statusCode, done.statusCode]).toEqual([204, 204])
    expect(page).toBe('reset-password')
    expect(message.text).toContain('один час')
    expect((await login(email, TEST_PASSWORD)).statusCode).toBe(401)
    expect((await login(email, NEW_PASSWORD)).statusCode).toBe(200)
    const oldSession = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers })
    expect(oldSession.statusCode).toBe(401)
  })

  it('revokes the API tokens of the account and its other pending links', async () => {
    const { email, headers } = await register()
    const apiToken = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/tokens',
        headers,
        payload: { name: 'Left behind', scope: 'write' },
      })
    ).json<{ token: string }>().token
    const verify = await emailTo(email, /Confirm/)
    await post('/password-reset', { email })
    const { token } = await emailTo(email, /Reset your/)

    await post('/password-reset/confirm', { token, password: NEW_PASSWORD })

    const viaToken = await ctx.app.inject({
      method: 'GET',
      url: '/api/projects',
      headers: { authorization: `Bearer ${apiToken}` },
    })
    expect(viaToken.statusCode).toBe(401)
    const session = (await login(email, NEW_PASSWORD)).json<AuthResponse>()
    const reused = await post(
      '/verify-email',
      { token: verify.token },
      { authorization: `Bearer ${session.token}` },
    )
    expect(reused.statusCode).toBe(400)
  })

  it('is cancelled by changing the password the ordinary way', async () => {
    const { email, headers } = await register()
    await post('/password-reset', { email })
    const { token } = await emailTo(email, /Reset your/)

    await post('/password', { currentPassword: TEST_PASSWORD, newPassword: NEW_PASSWORD }, headers)
    const late = await post('/password-reset/confirm', { token, password: 'yet another password' })

    expect(late.statusCode).toBe(400)
    expect((await login(email, NEW_PASSWORD)).statusCode).toBe(200)
  })

  it('also confirms the address, since the link arrived there', async () => {
    const { email } = await register()
    await post('/password-reset', { email })
    const { token } = await emailTo(email, /Reset your/)

    await post('/password-reset/confirm', { token, password: NEW_PASSWORD })

    const session = (await login(email, NEW_PASSWORD)).json<AuthResponse>()
    expect(session.user.emailVerified).toBe(true)
  })

  it('works once, and not with a password that is too short', async () => {
    const { email } = await register()
    await post('/password-reset', { email })
    const { token } = await emailTo(email, /Reset your/)

    const short = await post('/password-reset/confirm', { token, password: 'short' })
    const first = await post('/password-reset/confirm', { token, password: NEW_PASSWORD })
    const second = await post('/password-reset/confirm', {
      token,
      password: 'yet another password',
    })

    expect([short.statusCode, first.statusCode, second.statusCode]).toEqual([400, 204, 400])
    expect((await login(email, NEW_PASSWORD)).statusCode).toBe(200)
  })

  it('answers the same for an address without an account, and sends nothing', async () => {
    const { email } = await register()
    outbox = []

    const known = await post('/password-reset', { email })
    const unknown = await post('/password-reset', { email: 'nobody-here@example.com' })
    await emailTo(email, /Reset your/)

    expect([known.statusCode, unknown.statusCode]).toEqual([204, 204])
    expect(known.body).toBe(unknown.body)
    expect(outbox.map((message) => message.to)).toEqual([email])
  })

  it('does not replace a link it has just sent, however often it is asked', async () => {
    const email = 'flooded@example.com'
    await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, name: 'Flo', password: TEST_PASSWORD },
    })
    await emailTo(email, /Confirm/)
    outbox = []

    const statuses = []
    for (let index = 0; index < 5; index += 1) {
      statuses.push((await post('/password-reset', { email })).statusCode)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))

    expect(statuses).toEqual([204, 204, 204, 204, 204])
    // A second email would make the first link useless to the person about to click it.
    expect(outbox).toHaveLength(1)
  })
})

describe('adding members by email on a server that confirms addresses', () => {
  it('treats an account with an unconfirmed address as if it did not exist', async () => {
    const fixture = await ctx.createProject()
    const squatter = await register()
    const add = () =>
      fixture.call(fixture.owner, 'POST', '/members', { email: squatter.email, role: 'member' })

    const unconfirmed = await add()
    const unknown = await fixture.call(fixture.owner, 'POST', '/members', {
      email: 'nobody-at-all@example.com',
      role: 'member',
    })
    await ctx.database.db
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.id, squatter.user.id))
    const confirmed = await add()

    expect([unconfirmed.statusCode, unknown.statusCode, confirmed.statusCode]).toEqual([
      404, 404, 201,
    ])
    expect(unconfirmed.body).toBe(unknown.body)
  })
})

describe('a server without mail settings', () => {
  it('sends nothing on registration and refuses the email flows', async () => {
    const plain = await createTestContext()
    const user = await plain.signUp()

    const resend = await plain.request(user, 'POST', '/api/auth/verify-email/resend')
    const reset = await plain.app.inject({
      method: 'POST',
      url: '/api/auth/password-reset',
      payload: { email: user.email },
    })
    await plain.close()

    expect([resend.statusCode, reset.statusCode]).toEqual([409, 409])
  })
})

describe('notification emails', () => {
  it('go only to addresses that were confirmed', async () => {
    const fixture = await ctx.createProject()
    await ctx.database.db.delete(notifications)
    await ctx.database.db
      .update(users)
      .set({ emailVerifiedAt: null })
      .where(eq(users.id, fixture.member.id))
    for (const assigneeId of [fixture.member.id, fixture.viewer.id]) {
      await fixture.call(fixture.owner, 'POST', '/tasks', { title: 'For you', assigneeId })
    }
    const sent: MailMessage[] = []

    await deliverPending(ctx.database.db, async (message) => void sent.push(message), {
      publicUrl: PUBLIC_URL,
    })

    expect(sent.map((message) => message.to)).toEqual([fixture.viewer.email])
  })
})
