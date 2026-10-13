import {
  apiTokenSchema,
  createApiTokenRequestSchema,
  createdApiTokenSchema,
  errorResponseSchema,
} from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { requireSession } from '../auth/plugin'
import { createApiToken, listApiTokens, revokeApiToken } from './service'

const errors = { 401: errorResponseSchema, 403: errorResponseSchema }

/**
 * Personal API tokens; mounted under `/api/tokens`. Only a browser session can manage them:
 * a token that could create tokens would let a leak outlive its own revocation.
 */
export const tokenRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.addHook('onRequest', async (request) => {
    requireSession(request)
  })

  const tags = ['api tokens']

  app.get(
    '/',
    {
      schema: {
        tags,
        summary: 'Your API tokens, newest first',
        response: { 200: z.array(apiTokenSchema), ...errors },
      },
    },
    (request) => listApiTokens(db, requireSession(request).user.id),
  )

  app.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Create an API token',
        description:
          'The `token` in the response is shown only once. Send it as `Authorization: Bearer <token>`.',
        body: createApiTokenRequestSchema,
        response: { 201: createdApiTokenSchema, ...errors, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const token = await createApiToken(db, requireSession(request).user.id, request.body)
      return reply.code(201).send(token)
    },
  )

  app.delete(
    '/:tokenId',
    {
      schema: {
        tags,
        summary: 'Revoke an API token',
        params: z.object({ tokenId: z.uuid() }),
        response: { 204: z.null(), ...errors, 404: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await revokeApiToken(db, requireSession(request).user.id, request.params.tokenId)
      return reply.code(204).send(null)
    },
  )
}
