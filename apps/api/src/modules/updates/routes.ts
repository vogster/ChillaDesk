import { errorResponseSchema, versionInfoSchema } from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { requireAuth } from '../auth/plugin'
import type { UpdateChecker } from './checker'

/** The running version and newer releases; mounted under `/api/version`. */
export const versionRoutes: FastifyPluginAsyncZod<{ checker: UpdateChecker }> = async (
  app,
  { checker },
) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['version'],
        summary: 'The running version, and what was released since, with its changelog',
        response: { 200: versionInfoSchema, 401: errorResponseSchema },
      },
    },
    (request) => {
      requireAuth(request)
      return checker.info()
    },
  )
}
