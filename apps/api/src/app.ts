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
import { MCP_PATH, registerAuth, SESSION_COOKIE } from './modules/auth/plugin'
import { authRoutes } from './modules/auth/routes'
import { labelRoutes } from './modules/labels/routes'
import { mcpRoutes } from './modules/mcp/routes'
import { overviewRoutes } from './modules/overview/routes'
import { projectRoutes } from './modules/projects/routes'
import { taskRoutes } from './modules/tasks/routes'
import { statusRoutes } from './modules/tasks/statuses.routes'
import { tokenRoutes } from './modules/tokens/routes'
import { wikiRoutes } from './modules/wiki/routes'
import { healthRoutes } from './routes/health'

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
        title: 'ChillaWiki API',
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

  await app.register(healthRoutes, { prefix: '/api', database })
  await app.register(authRoutes, {
    prefix: '/api/auth',
    db,
    registrationEnabled,
    cookieSecure,
    rateLimitMax: authRateLimitMax,
    accountRateLimitMax,
  })
  await app.register(projectRoutes, {
    prefix: '/api/projects',
    db,
    memberInviteRateLimitMax,
  })
  await app.register(labelRoutes, { prefix: '/api/projects/:projectId/labels', db })
  await app.register(statusRoutes, { prefix: '/api/projects/:projectId/statuses', db })
  await app.register(taskRoutes, { prefix: '/api/projects/:projectId/tasks', db })
  await app.register(tokenRoutes, { prefix: '/api/tokens', db })
  await app.register(overviewRoutes, { prefix: '/api', db })
  await app.register(mcpRoutes, { prefix: MCP_PATH, db })
  await app.register(wikiRoutes, { prefix: '/api/projects/:projectId/wiki', db })

  return app
}
