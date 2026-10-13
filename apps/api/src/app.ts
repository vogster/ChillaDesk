import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import Fastify, { type FastifyInstance } from 'fastify'
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import packageJson from '../package.json' with { type: 'json' }
import type { AppConfig } from './config'
import type { Database } from './db/client'
import { AppError } from './errors'
import { registerErrorHandlers } from './http/error-handler'
import type { AccountMail } from './modules/auth/email-flows'
import { MCP_PATH, registerAuth, SESSION_COOKIE } from './modules/auth/plugin'
import { authRoutes } from './modules/auth/routes'
import { createEventBus, type EventBus } from './modules/events/bus'
import { eventRoutes, membersAmong, resourceOfRoute } from './modules/events/routes'
import { inviteRoutes, projectInviteRoutes } from './modules/invites/routes'
import { labelRoutes } from './modules/labels/routes'
import { mcpRoutes } from './modules/mcp/routes'
import { milestoneRoutes } from './modules/milestones/routes'
import { notificationRoutes } from './modules/notifications/routes'
import { overviewRoutes } from './modules/overview/routes'
import { projectRoutes } from './modules/projects/routes'
import { taskExtraRoutes } from './modules/tasks/extras.routes'
import { savedFilterRoutes } from './modules/tasks/filters.routes'
import { taskRoutes } from './modules/tasks/routes'
import { statusRoutes } from './modules/tasks/statuses.routes'
import { tokenRoutes } from './modules/tokens/routes'
import { wikiRoutes } from './modules/wiki/routes'
import { healthRoutes } from './routes/health'

declare module 'fastify' {
  interface FastifyInstance {
    /** Pushes changes to the event streams open on this process. */
    events: EventBus
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export interface AppOptions {
  database: Database
  logLevel: AppConfig['logLevel']
  trustProxy?: AppConfig['trustProxy']
  registrationEnabled?: boolean
  cookieSecure?: AppConfig['cookieSecure']
  /** Requests per minute per client across the whole API. */
  rateLimitMax?: number
  /** Register/login attempts per minute per client. */
  authRateLimitMax?: number
  /** Login attempts per 15 minutes for one email. */
  accountRateLimitMax?: number
  /** Members one user can add per minute; bounds probing for registered emails. */
  memberInviteRateLimitMax?: number
  /** Confirmation and reset emails one account can ask for per 15 minutes. */
  accountEmailRateLimitMax?: number
  /** How to send account emails; without it there is no confirmation or password reset. */
  mail?: AccountMail | undefined
  /** Invite links one client may look up or accept per minute. */
  inviteRateLimitMax?: number
  /** How long one event stream lives before the client has to reconnect. */
  eventStreamLifetimeMs?: number
}

export async function buildApp({
  database,
  logLevel,
  trustProxy = false,
  registrationEnabled = true,
  cookieSecure = 'auto',
  rateLimitMax = 600,
  authRateLimitMax = 10,
  accountRateLimitMax = 10,
  memberInviteRateLimitMax = 20,
  inviteRateLimitMax = 30,
  accountEmailRateLimitMax = 3,
  mail,
  eventStreamLifetimeMs,
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: logLevel },
    // Fastify's types omit the hop-count form, so it is expressed as the equivalent function.
    trustProxy: typeof trustProxy === 'number' ? (_address, hop) => hop < trustProxy : trustProxy,
  }).withTypeProvider<ZodTypeProvider>()
  const { db } = database

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  registerErrorHandlers(app)

  await app.register(cookie)
  await app.register(rateLimit, {
    max: rateLimitMax,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) =>
      new AppError('RATE_LIMITED', `Too many requests, retry in ${context.after}`),
  })

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ChillaDesk API',
        description: 'Tasks, kanban boards and wiki for your projects.',
        version: packageJson.version,
      },
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer' },
          cookie: { type: 'apiKey', in: 'cookie', name: SESSION_COOKIE },
        },
      },
      security: [{ bearer: [] }, { cookie: [] }],
    },
    transform: jsonSchemaTransform,
  })
  await app.register(swaggerUi, { routePrefix: '/api/docs' })

  registerAuth(app, db)

  const events = createEventBus({
    membersAmong: membersAmong(db),
    onError: (error) => app.log.warn({ err: error }, 'live event was not delivered'),
  })
  app.decorate('events', events)
  // Open streams would otherwise keep the server from closing.
  app.addHook('preClose', async () => events.closeAll())
  // Every successful change under /api/projects/:projectId is announced to that project.
  app.addHook('onResponse', async (request, reply) => {
    if (SAFE_METHODS.has(request.method) || reply.statusCode >= 400) return
    const { projectId } = (request.params ?? {}) as { projectId?: unknown }
    const resource = resourceOfRoute(request.routeOptions.url ?? '')
    if (typeof projectId === 'string' && resource) void events.publishProject(projectId, resource)
  })

  await app.register(healthRoutes, { prefix: '/api', database })
  await app.register(authRoutes, {
    prefix: '/api/auth',
    db,
    registrationEnabled,
    cookieSecure,
    rateLimitMax: authRateLimitMax,
    accountRateLimitMax,
    accountEmailRateLimitMax,
    mail,
  })
  await app.register(projectRoutes, {
    prefix: '/api/projects',
    db,
    memberInviteRateLimitMax,
    // Addresses can only be confirmed where the server sends email.
    confirmedMembersOnly: mail !== undefined,
  })
  await app.register(projectInviteRoutes, { prefix: '/api/projects/:projectId/invites', db })
  await app.register(inviteRoutes, { prefix: '/api/invites', db, rateLimitMax: inviteRateLimitMax })
  await app.register(labelRoutes, { prefix: '/api/projects/:projectId/labels', db })
  await app.register(milestoneRoutes, { prefix: '/api/projects/:projectId/milestones', db })
  await app.register(statusRoutes, { prefix: '/api/projects/:projectId/statuses', db })
  await app.register(taskRoutes, { prefix: '/api/projects/:projectId/tasks', db })
  await app.register(taskExtraRoutes, { prefix: '/api/projects/:projectId/tasks', db })
  await app.register(savedFilterRoutes, { prefix: '/api/projects/:projectId/filters', db })
  await app.register(tokenRoutes, { prefix: '/api/tokens', db })
  await app.register(overviewRoutes, { prefix: '/api', db })
  await app.register(notificationRoutes, { prefix: '/api/notifications', db })
  await app.register(mcpRoutes, { prefix: MCP_PATH, db, events })
  await app.register(eventRoutes, {
    prefix: '/api/events',
    events,
    ...(eventStreamLifetimeMs !== undefined ? { maxLifetimeMs: eventStreamLifetimeMs } : {}),
  })
  await app.register(wikiRoutes, { prefix: '/api/projects/:projectId/wiki', db })

  return app
}
