import { authResponseSchema, userSchema } from '@chilladesk/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sessions, users } from '../../db/schema'
import { createTestContext, TEST_PASSWORD, type TestContext } from '../../test/harness'
import { SESSION_COOKIE } from './plugin'
import { authenticate, login, SESSION_TTL_MS } from './service'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

const register = (payload: Record<string, unknown>) =>
  ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload })
const logIn = (payload: Record<string, unknown>) =>
  ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload })

describe('POST /api/auth/register', () => {
  it('creates a user, returns a token and sets an HTTP-only cookie', async () => {
    const response = await register({
      email: 'Ann@Example.com',
      name: 'Ann',
      password: TEST_PASSWORD,
    })

    expect(response.statusCode).toBe(201)
    const body = authResponseSchema.parse(response.json())
    expect(body.user).toMatchObject({ email: 'ann@example.com', name: 'Ann' })
    expect(response.body).not.toContain('passwordHash')

    const cookie = response.cookies.find((item) => item.name === SESSION_COOKIE)
    expect(cookie).toMatchObject({ value: body.token, httpOnly: true, sameSite: 'Lax', path: '/' })
  })

  it('never stores the password or the session token in plain text', async () => {
    const response = await register({
      email: 'plain@example.com',
      name: 'Plain',
      password: TEST_PASSWORD,
    })
    const { token, user } = authResponseSchema.parse(response.json())

    const [userRow] = await ctx.database.db.select().from(users).where(eq(users.id, user.id))
    const sessionRows = await ctx.database.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user.id))

    expect(userRow?.passwordHash).toMatch(/^scrypt\$/)
    expect(userRow?.passwordHash).not.toContain(TEST_PASSWORD)
    expect(sessionRows).toHaveLength(1)
    expect(sessionRows[0]?.tokenHash).not.toBe(token)
  })

  it('rejects an email that is already registered, ignoring case', async () => {
    await register({ email: 'dup@example.com', name: 'First', password: TEST_PASSWORD })

    const response = await register({
      email: 'DUP@example.com',
      name: 'Second',
      password: TEST_PASSWORD,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toMatchObject({ error: { code: 'CONFLICT' } })
  })

  it('reports which fields failed validation', async () => {
    const response = await register({ email: 'nope', name: 'X', password: 'short' })

    expect(response.statusCode).toBe(400)
    const { error } = response.json<{ error: { code: string; details: { path: string }[] } }>()
    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.details.map((detail) => detail.path).sort()).toEqual(['email', 'password'])
  })

  it('rejects control characters that PostgreSQL cannot store', async () => {
    const response = await register({
      email: 'nul@example.com',
      name: 'Nul\u0000Name',
      password: TEST_PASSWORD,
    })

    expect(response.statusCode).toBe(400)
  })

  it('marks the cookie Secure when configured, whatever protocol the proxy reports', async () => {
    const secure = await createTestContext({ cookieSecure: true })

    const response = await secure.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'secure@example.com', name: 'Secure', password: TEST_PASSWORD },
    })

    expect(response.cookies.find((item) => item.name === SESSION_COOKIE)?.secure).toBe(true)
    await secure.close()
  })

  it('is refused when registration is disabled', async () => {
    const closed = await createTestContext({ registrationEnabled: false })

    const response = await closed.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'late@example.com', name: 'Late', password: TEST_PASSWORD },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
    await closed.close()
  })
})

describe('POST /api/auth/login', () => {
  it('starts a session for valid credentials, ignoring email case', async () => {
    const user = await ctx.signUp()

    const response = await logIn({ email: user.email.toUpperCase(), password: TEST_PASSWORD })

    expect(response.statusCode).toBe(200)
    const body = authResponseSchema.parse(response.json())
    expect(body.user.id).toBe(user.id)
    expect(body.token).not.toBe(user.token)
  })

  it('answers identically for a wrong password and an unknown email', async () => {
    const user = await ctx.signUp()

    const wrongPassword = await logIn({ email: user.email, password: 'wrong password' })
    const unknownEmail = await logIn({ email: 'ghost@example.com', password: TEST_PASSWORD })

    expect(wrongPassword.statusCode).toBe(401)
    expect(unknownEmail.statusCode).toBe(401)
    expect(wrongPassword.json()).toEqual(unknownEmail.json())
  })

  it('removes the expired sessions of that user', async () => {
    const user = await ctx.signUp()
    const afterExpiry = new Date(Date.now() + SESSION_TTL_MS + 1000)

    await login(ctx.database.db, { email: user.email, password: TEST_PASSWORD }, afterExpiry)

    const rows = await ctx.database.db.select().from(sessions).where(eq(sessions.userId, user.id))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.expiresAt.getTime()).toBeGreaterThan(afterExpiry.getTime())
  })

  it('is rate limited per account, however many clients try', async () => {
    const limited = await createTestContext({ accountRateLimitMax: 2 })
    const attempt = (email: string, ip: string) =>
      limited.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: ip,
        payload: { email, password: 'guess' },
      })

    const first = await attempt('victim@example.com', '10.0.0.1')
    const second = await attempt('VICTIM@example.com', '10.0.0.2')
    const third = await attempt('victim@example.com', '10.0.0.3')
    const otherAccount = await attempt('other@example.com', '10.0.0.3')

    expect([first.statusCode, second.statusCode, third.statusCode]).toEqual([401, 401, 429])
    expect(otherAccount.statusCode).toBe(401)
    await limited.close()
  })

  it('is rate limited per client', async () => {
    const limited = await createTestContext({ authRateLimitMax: 2 })
    const attempt = () =>
      limited.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@example.com', password: 'guess' },
      })

    const statuses = [await attempt(), await attempt(), await attempt()].map(
      (response) => response.statusCode,
    )
    const third = await attempt()

    expect(statuses).toEqual([401, 401, 429])
    expect(third.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })
    await limited.close()
  })
})

describe('GET /api/auth/me', () => {
  it('returns the user for a bearer token', async () => {
    const user = await ctx.signUp('Bearer Bob')

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: user.headers,
    })

    expect(response.statusCode).toBe(200)
    expect(userSchema.parse(response.json())).toMatchObject({ id: user.id, name: 'Bearer Bob' })
  })

  it('returns the user for a session cookie', async () => {
    const user = await ctx.signUp()

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { [SESSION_COOKIE]: user.token },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: user.id })
  })

  it.each([
    ['no credentials', {}],
    ['an unknown token', { authorization: 'Bearer not-a-real-token' }],
    ['a non-bearer scheme', { authorization: 'Basic abc' }],
  ])('rejects %s', async (_label, headers) => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/auth/me', headers })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } })
  })

  it('rejects an expired session', async () => {
    const user = await ctx.signUp()
    const afterExpiry = new Date(Date.now() + SESSION_TTL_MS + 1000)

    await expect(
      authenticate(ctx.database.db, user.token, { viaHeader: true }),
    ).resolves.not.toBeNull()
    await expect(
      authenticate(ctx.database.db, user.token, { viaHeader: true, now: afterExpiry }),
    ).resolves.toBeNull()
  })
})

describe('POST /api/auth/logout', () => {
  it('invalidates the session and clears the cookie', async () => {
    const user = await ctx.signUp()

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: user.headers,
    })
    const afterLogout = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: user.headers,
    })

    expect(response.statusCode).toBe(204)
    expect(response.cookies.find((item) => item.name === SESSION_COOKIE)?.value).toBe('')
    expect(afterLogout.statusCode).toBe(401)
  })

  it('succeeds and clears the cookie even when the session is already gone', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: 'expired-or-unknown' },
    })

    expect(response.statusCode).toBe(204)
    expect(response.cookies.find((item) => item.name === SESSION_COOKIE)?.value).toBe('')
  })
})

describe('cross-site request protection', () => {
  const logoutWith = (headers: Record<string, string>, cookieToken?: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { host: 'wiki.example.com', ...headers },
      ...(cookieToken ? { cookies: { [SESSION_COOKIE]: cookieToken } } : {}),
    })

  it('blocks a cookie-authenticated write from another origin', async () => {
    const user = await ctx.signUp()

    const response = await logoutWith({ origin: 'https://evil.example' }, user.token)

    expect(response.statusCode).toBe(403)
    expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  it('blocks a cookie-authenticated write with a malformed origin', async () => {
    const user = await ctx.signUp()

    const response = await logoutWith({ origin: 'null' }, user.token)

    expect(response.statusCode).toBe(403)
  })

  it('allows a cookie-authenticated write from the same origin', async () => {
    const user = await ctx.signUp()

    const response = await logoutWith({ origin: 'https://wiki.example.com' }, user.token)

    expect(response.statusCode).toBe(204)
  })

  it('trusts Sec-Fetch-Site over Origin, so a proxy that rewrites Host does not break the app', async () => {
    const user = await ctx.signUp()

    // What the API sees behind a dev proxy: the browser origin differs from the forwarded Host.
    const response = await logoutWith(
      { origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' },
      user.token,
    )

    expect(response.statusCode).toBe(204)
  })

  it.each(['cross-site', 'same-site'])(
    'blocks a cookie-authenticated write marked %s by the browser',
    async (site) => {
      const user = await ctx.signUp()

      const response = await logoutWith(
        { origin: 'https://wiki.example.com', 'sec-fetch-site': site },
        user.token,
      )

      expect(response.statusCode).toBe(403)
    },
  )

  it('allows cookie-authenticated reads from anywhere', async () => {
    const user = await ctx.signUp()

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      cookies: { [SESSION_COOKIE]: user.token },
    })

    expect(response.statusCode).toBe(200)
  })

  it('does not apply to bearer tokens, which browsers never send on their own', async () => {
    const user = await ctx.signUp()

    const response = await logoutWith({ origin: 'https://evil.example', ...user.headers })

    expect(response.statusCode).toBe(204)
  })
})
