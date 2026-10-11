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
import { healthRoutes } from './routes/health'

export interface AppOptions {
  database: Database
  logLevel: AppConfig['logLevel']
  trustProxy?: boolean
}

export async function buildApp({
  database,
  logLevel,
  trustProxy = false,
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: logLevel },
    trustProxy,
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'ChillaWiki API',
        description: 'Tasks, kanban boards and wiki for your projects.',
        version: packageJson.version,
      },
    },
    transform: jsonSchemaTransform,
  })
  await app.register(swaggerUi, { routePrefix: '/api/docs' })

  await app.register(healthRoutes, { prefix: '/api', database })

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({ error: 'Not Found', message: `Route ${request.url} not found` }),
  )

  return app
}
