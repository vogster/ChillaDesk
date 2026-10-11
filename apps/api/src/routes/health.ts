import { healthResponseSchema } from '@chillawiki/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import packageJson from '../../package.json' with { type: 'json' }
import type { Database } from '../db/client'

export const healthRoutes: FastifyPluginAsyncZod<{ database: Database }> = async (
  app,
  { database },
) => {
  app.get(
    '/health',
    {
      // Container health probes hit this every few seconds; keep them out of the request log.
      logLevel: 'warn',
      config: { rateLimit: false },
      schema: {
        tags: ['system'],
        summary: 'Service health',
        response: { 200: healthResponseSchema, 503: healthResponseSchema },
      },
    },
    async (_request, reply) => {
      const databaseUp = await database.ping()
      return reply.code(databaseUp ? 200 : 503).send({
        status: databaseUp ? 'ok' : 'degraded',
        version: packageJson.version,
        database: databaseUp ? 'up' : 'down',
      })
    },
  )
}
