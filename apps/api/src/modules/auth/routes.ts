import {
  authOptionsSchema,
  authResponseSchema,
  changePasswordRequestSchema,
  completeRegistrationSchema,
  emailTokenRequestSchema,
  errorResponseSchema,
  loginRequestSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerRequestSchema,
  registrationPendingSchema,
  updateProfileRequestSchema,
  userSchema,
  type AuthResponse,
} from '@chilladesk/shared'
import type { FastifyReply } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { AppError, forbidden } from '../../errors'
import { createAttemptLimiter } from './attempt-limiter'
import {
  addressOfLink,
  completeRegistration,
  registerByEmail,
  requestPasswordReset,
  resetPassword,
  sendVerification,
  verifyEmail,
  type AccountMail,
} from './email-flows'
import { requireAuth, requireSession, SESSION_COOKIE } from './plugin'
import { changePassword, login, logout, register, startSession, updateProfile } from './service'

export interface AuthRoutesOptions {
  db: Db
  registrationEnabled: boolean
  /** `auto` follows the request protocol; set `true` when TLS ends at an upstream proxy. */
  cookieSecure: boolean | 'auto'
  /** Register/login attempts per minute per client address. */
  rateLimitMax: number
  /** Login attempts per 15 minutes for one email, from any address. */
  accountRateLimitMax: number
  /** Emails one account can ask for per 15 minutes (confirmation, password reset). */
  accountEmailRateLimitMax: number
  /** Absent when the server is not set up to send email. */
  mail?: AccountMail | undefined
}

export const authRoutes: FastifyPluginAsyncZod<AuthRoutesOptions> = async (app, options) => {
  const { db } = options
  const perClient = { rateLimit: { max: options.rateLimitMax, timeWindow: '1 minute' } }
  const tags = ['auth']

  // Slows password guessing against one account from many addresses, at the cost of letting
  // an attacker delay that account's login for the window.
  const accountAttempts = createAttemptLimiter(db, {
    name: 'login',
    max: options.accountRateLimitMax,
    windowMs: 15 * 60 * 1000,
  })

  // Bounds how much mail one account can cause, whoever asks for it.
  const emailRequests = createAttemptLimiter(db, {
    name: 'account-email',
    max: options.accountEmailRateLimitMax,
    windowMs: 15 * 60 * 1000,
  })
  // Sign-ups of one address get their own count, so they cannot use up the password resets
  // of its owner (or the other way round).
  const signUpEmails = createAttemptLimiter(db, {
    name: 'sign-up-email',
    max: options.accountEmailRateLimitMax,
    windowMs: 15 * 60 * 1000,
  })
  const { mail } = options
  const requireMail = (): AccountMail => {
    if (!mail) throw new AppError('CONFLICT', 'This server is not set up to send email')
    return mail
  }
  const logMailFailure = (what: string) => (error: unknown) => {
    // Mail errors quote the address they were about, so only their codes are logged.
    const { code, responseCode } = (error ?? {}) as { code?: unknown; responseCode?: unknown }
    app.log.warn({ code, responseCode }, `${what} email was not sent`)
  }

  app.get(
    '/options',
    {
      schema: {
        tags,
        summary: 'What this server offers before anyone is signed in',
        response: { 200: authOptionsSchema },
      },
    },
    async () => ({
      registrationEnabled: options.registrationEnabled,
      emailEnabled: mail !== undefined,
    }),
  )

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
        summary: 'Create an account',
        description:
          'Without email set up on the server: creates the account and starts a session (201). ' +
          'With email: answers 202 whether or not the address already has an account, and ' +
          'emails either a link to finish the sign-up or a note to the existing owner.',
        body: registerRequestSchema,
        response: {
          201: authResponseSchema,
          202: registrationPendingSchema,
          403: errorResponseSchema,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (mail) {
        if (!options.registrationEnabled) throw forbidden('Registration is disabled on this server')
        // Not awaited, and silent when over the limit: neither the answer nor how long it
        // takes may depend on whether the address has an account.
        if ((await signUpEmails.consume(request.body.email.toLowerCase())).allowed) {
          void registerByEmail(db, mail, request.body).catch((error: unknown) => {
            // Neither the address nor the mail server's words go to the log; what failed does.
            const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown }
            app.log.warn({ name, code }, 'sign-up was not completed')
          })
        }
        return reply.code(202).send({ confirmationSent: true as const })
      }
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
      const attempt = await accountAttempts.consume(request.body.email.toLowerCase())
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

  app.patch(
    '/me',
    {
      schema: {
        tags,
        summary: 'Change your name, language or email preference',
        body: updateProfileRequestSchema,
        response: { 200: userSchema, 401: errorResponseSchema, 403: errorResponseSchema },
      },
    },
    // The account itself is out of reach for API tokens.
    async (request) => updateProfile(db, requireSession(request).user.id, request.body),
  )

  app.post(
    '/password',
    {
      config: perClient,
      schema: {
        tags,
        summary: 'Change your password',
        description: 'Ends every other session of the account; the current one stays.',
        body: changePasswordRequestSchema,
        response: { 204: z.null(), 400: errorResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const auth = requireSession(request)
      await changePassword(db, auth.user.id, auth.sessionId ?? '', request.body)
      return reply.code(204).send(null)
    },
  )

  app.post(
    '/verify-email',
    {
      config: perClient,
      schema: {
        tags,
        summary: 'Confirm your email address with the token from the confirmation email',
        description: 'Needs the session of the account the link was sent for.',
        body: emailTokenRequestSchema,
        response: { 204: z.null(), 400: errorResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await verifyEmail(db, requireSession(request).user.id, request.body.token)
      return reply.code(204).send(null)
    },
  )

  app.post(
    '/verify-email/complete',
    {
      config: perClient,
      schema: {
        tags,
        summary: 'Confirm the address from the email link while signed out, and sign in',
        description:
          'Needs the password of the account as well as the token, so the link alone cannot ' +
          'confirm an account somebody else made with this address.',
        body: completeRegistrationSchema,
        response: { 200: authResponseSchema, 400: errorResponseSchema, 401: errorResponseSchema },
      },
    },
    async (request, reply) => {
      requireMail()
      // Wrong passwords count against the account as on the login form, so a link cannot be
      // used to guess its password from many addresses.
      const address = await addressOfLink(db, request.body.token)
      if (address && !(await accountAttempts.consume(address)).allowed) {
        throw new AppError('RATE_LIMITED', 'Too many login attempts for this account, retry later')
      }
      const user = await completeRegistration(db, request.body.token, request.body.password)
      const session = await startSession(db, user, new Date())
      setSessionCookie(reply, session)
      return session
    },
  )

  app.post(
    '/verify-email/resend',
    {
      config: perClient,
      schema: {
        tags,
        summary: 'Send the confirmation email again',
        response: {
          204: z.null(),
          401: errorResponseSchema,
          409: errorResponseSchema,
          429: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { user } = requireSession(request)
      const sender = requireMail()
      if (!(await emailRequests.consume(user.id)).allowed) {
        throw new AppError('RATE_LIMITED', 'Too many emails requested, try again later')
      }
      try {
        await sendVerification(db, sender, user.id)
      } catch (error) {
        if (error instanceof AppError) throw error
        // The mail server's own words quote the address, so they stay out of the log.
        logMailFailure('confirmation')(error)
        throw new AppError('INTERNAL_ERROR', 'The email could not be sent, try again later')
      }
      return reply.code(204).send(null)
    },
  )

  app.post(
    '/password-reset',
    {
      config: perClient,
      schema: {
        tags,
        summary: 'Ask for an email with a link to choose a new password',
        description:
          'Always answers 204, whether or not the address belongs to an account, so it ' +
          'cannot be used to find out who is registered.',
        body: passwordResetRequestSchema,
        response: { 204: z.null(), 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const sender = requireMail()
      const email = request.body.email.toLowerCase()
      // Not awaited, and silent when over the limit: the answer and how long it takes
      // must not depend on whether the account exists.
      if ((await emailRequests.consume(email)).allowed) {
        void requestPasswordReset(db, sender, email).catch(logMailFailure('password reset'))
      }
      return reply.code(204).send(null)
    },
  )

  app.post(
    '/password-reset/confirm',
    {
      config: perClient,
      schema: {
        tags,
        summary: 'Choose a new password with the token from the reset email',
        description: 'Ends every session of the account.',
        body: passwordResetConfirmSchema,
        response: { 204: z.null(), 400: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await resetPassword(db, request.body.token, request.body.password)
      return reply.code(204).send(null)
    },
  )
}
