import {
  authResponseSchema,
  errorResponseSchema,
  loginRequestSchema,
  registerRequestSchema,
  userSchema,
  type AuthResponse,
} from '@chillawiki/shared'
import type { FastifyReply } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { AppError } from '../../errors'
import { createAttemptLimiter } from './attempt-limiter'
import { requireAuth, SESSION_COOKIE } from './plugin'
import { login, logout, register } from './service'

export interface AuthRoutesOptions {
  db: Db
  registrationEnabled: boolean
  /** `auto` follows the request protocol; set `true` when TLS ends at an upstream proxy. */
  cookieSecure: boolean | 'auto'
  /** Register/login attempts per minute per client address. */
  rateLimitMax: number
  /** Login attempts per 15 minutes for one email, from any address. */
  accountRateLimitMax: number
}

export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (app, options) => {
  const { db } = options
  const perClient = { rateLimit: { max: options.rateLimitMax, timeWindow: '1 minute' } }
  const tags = ['auth']

  // Slows password guessing against one account from many addresses, at the cost of letting
  // an attacker delay that account's login for the window.
  const accountAttempts = createAttemptLimiter({
    max: options.accountRateLimitMax,
    windowMs: 15 * 60 * 1000,
  })

  const setSessionCookie = (reply: FastifyReply, session: AuthResponse): void => {
    reply.setCookie(SESSION_COOKIE, session.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: options.cookieSecure,
      expires: new Date(session.expiresAt),
    })
  }

  app.post(
    '/register',
    {
      config: perClient,
      schema: {
        tags,
        summary: 'Create an account and start a session',
        body: registerRequestSchema,
        response: { 201: authResponseSchema, 403: errorResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const session = await register(db, request.body, {
        registrationEnabled: options.registrationEnabled,
      })
      setSessionCookie(reply, session)
      return reply.code(201).send(session)
    },
  )

  app.post(
    '/login',
    {
      config: perClient,
      schema: {
        tags,
        summary: 'Start a session',
        description:
          'Sets an HTTP-only session cookie for browsers and also returns the token for ' +
          'clients that send it as `Authorization: Bearer <token>`.',
        body: loginRequestSchema,
        response: { 200: authResponseSchema, 401: errorResponseSchema, 429: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const attempt = accountAttempts.consume(request.body.email.toLowerCase())
      if (!attempt.allowed) {
        const minutes = Math.ceil(attempt.retryAfterMs / 60_000)
        throw new AppError(
          'RATE_LIMITED',
          `Too many login attempts for this account, retry in ${minutes} min`,
        )
      }
      const session = await login(db, request.body)
      setSessionCookie(reply, session)
      return session
    },
  )

  app.post(
    '/logout',
    {
      schema: {
        tags,
        summary: 'End the current session',
        description: 'Always succeeds, so a client with an expired session can still sign out.',
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      // An API token has no session to end; revoking it is done on the tokens page.
      if (request.auth?.sessionId) await logout(db, request.auth.sessionId)
      reply.clearCookie(SESSION_COOKIE, { path: '/' })
      return reply.code(204).send(null)
    },
  )

  app.get(
    '/me',
    {
      schema: {
        tags,
        summary: 'Current user',
        response: { 200: userSchema, 401: errorResponseSchema },
      },
    },
    async (request) => requireAuth(request).user,
  )
}
