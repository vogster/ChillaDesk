import {
  changeEmailRequestSchema,
  deleteAccountRequestSchema,
  emailTokenRequestSchema,
  errorResponseSchema,
  registrationPendingSchema,
  userSchema,
} from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { AppError } from '../../errors'
import { changeEmail, confirmEmailChange, deleteAccount } from './account.service'
import { createAttemptLimiter } from './attempt-limiter'
import type { AccountMail } from './email-flows'
import { requireSession, SESSION_COOKIE } from './plugin'

export interface AccountRoutesOptions {
  db: Db
  mail?: AccountMail | undefined
  /** Requests per minute from one client. */
  rateLimitMax: number
  /** Password attempts per account per 15 minutes; shared with the login form. */
  accountRateLimitMax: number
  /** Emails one account can cause per 15 minutes; shared with the other account emails. */
  accountEmailRateLimitMax: number
}

/** The account itself: its address and its deletion. Mounted under `/api/auth`. */
export const accountRoutes: FastifyPluginAsyncZod<AccountRoutesOptions> = async (app, options) => {
  const { db, mail } = options
  const perClient = { rateLimit: { max: options.rateLimitMax, timeWindow: '1 minute' } }
  const tags = ['auth']
  const window = 15 * 60 * 1000
  // The same names as on the login form, so all of them count together.
  const passwordAttempts = createAttemptLimiter(db, {
    name: 'login',
    max: options.accountRateLimitMax,
    windowMs: window,
  })
  const emailRequests = createAttemptLimiter(db, {
    name: 'account-email',
    max: options.accountEmailRateLimitMax,
    windowMs: window,
  })

  /** Every password typed here counts like a login attempt of the account. */
  const limitPasswords = async (email: string) => {
    if (!(await passwordAttempts.consume(email)).allowed) {
      throw new AppError('RATE_LIMITED', 'Too many login attempts for this account, retry later')
    }
  }

  app.post(
    '/email',
    {
      config: perClient,
      schema: {
        tags,
        summary: 'Move the account to another email address',
        description:
          'Without email set up on the server the address changes at once (200). With email ' +
          'a link goes to the new address (202), which changes it when opened by the ' +
          'signed-in owner; the answer is the same whether or not the address is taken.',
        body: changeEmailRequestSchema,
        response: {
          200: userSchema,
          202: registrationPendingSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          409: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { user } = requireSession(request)
      await limitPasswords(user.email)
      if (mail && !(await emailRequests.consume(user.id)).allowed) {
        throw new AppError('RATE_LIMITED', 'Too many emails requested, try again later')
      }
      const result = await changeEmail(db, mail, user.id, request.body, {
        onError: (error) => {
          const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown }
          app.log.warn({ name, code }, 'change of address email was not sent')
        },
      })
      return 'user' in result ? result.user : reply.code(202).send(result)
    },
  )

  app.post(
    '/email/confirm',
    {
      config: perClient,
      schema: {
        tags,
        summary: 'Make the address from a change link the account address',
        body: emailTokenRequestSchema,
        response: {
          200: userSchema,
          400: errorResponseSchema,
          401: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request) => {
      if (!mail) throw new AppError('CONFLICT', 'This server is not set up to send email')
      const { user } = requireSession(request)
      return confirmEmailChange(db, mail, user.id, request.body.token)
    },
  )

  app.post(
    '/me/delete',
    {
      config: perClient,
      schema: {
        tags,
        summary: 'Delete your account',
        description:
          'Projects only you are in are deleted with it; in the others your work stays, ' +
          'under "deleted user". Make someone else an owner of projects with other members ' +
          'first (409 lists them).',
        body: deleteAccountRequestSchema,
        response: {
          204: z.null(),
          400: errorResponseSchema,
          401: errorResponseSchema,
          409: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { user } = requireSession(request)
      await limitPasswords(user.email)
      await deleteAccount(db, user.id, request.body.password)
      reply.clearCookie(SESSION_COOKIE, { path: '/' })
      return reply.code(204).send(null)
    },
  )
}
