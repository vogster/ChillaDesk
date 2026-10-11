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
import { requireAuth, SESSION_COOKIE } from './plugin'
import { login, logout, register } from './service'

export interface AuthRoutesOptions {
  db: Db
  registrationEnabled: boolean
  /** Attempts per minute per client on register and login. */
  rateLimitMax: number
}

function setSessionCookie(reply: FastifyReply, session: AuthResponse): void {
  reply.setCookie(SESSION_COOKIE, session.token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    expires: new Date(session.expiresAt),
  })
}

export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (app, options) => {
  const { db } = options
  const strictLimit = { rateLimit: { max: options.rateLimitMax, timeWindow: '1 minute' } }
  const tags = ['auth']

  app.post(
    '/register',
    {
      config: strictLimit,
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
      config: strictLimit,
      schema: {
        tags,
        summary: 'Start a session',
        description:
          'Sets an HTTP-only session cookie for browsers and also returns the token for ' +
          'clients that send it as `Authorization: Bearer <token>`.',
        body: loginRequestSchema,
        response: { 200: authResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
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
        response: { 204: z.null(), 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await logout(db, requireAuth(request).sessionId)
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
