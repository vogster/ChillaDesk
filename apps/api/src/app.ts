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
import { registerAuth, SESSION_COOKIE } from './modules/auth/plugin'
import { authRoutes } from './modules/auth/routes'
import { projectRoutes } from './modules/projects/routes'
import { healthRoutes } from './routes/health'

export interface AppOptions {
  database: Database
  logLevel: AppConfig['logLevel']
  trustProxy?: boolean
  registrationEnabled?: boolean
  /** Requests per minute per client across the whole API. */
  rateLimitMax?: number
  /** Register/login attempts per minute per client. */
  authRateLimitMax?: number
}

export async function buildApp({
  database,
  logLevel,
  trustProxy = false,
  registrationEnabled = true,
  rateLimitMax = 300,
  authRateLimitMax = 10,
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: logLevel },
    trustProxy,
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
    rateLimitMax: authRateLimitMax,
  })
  await app.register(projectRoutes, { prefix: '/api/projects', db })

  return app
}
