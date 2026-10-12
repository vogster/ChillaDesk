import {
  errorResponseSchema,
  markNotificationsReadRequestSchema,
  notificationListQuerySchema,
  notificationListSchema,
} from '@chillawiki/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { requireAuth } from '../auth/plugin'
import { listNotifications, markNotificationsRead } from './service'

const errors = { 400: errorResponseSchema, 401: errorResponseSchema }

/** The current user's notifications; mounted under `/api/notifications`. */
export const notificationRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.addHook('onRequest', async (request) => {
    requireAuth(request)
  })

  const tags = ['notifications']

  app.get(
    '/',
    {
      schema: {
        tags,
        summary: 'Your notifications, newest first, with the number still unread',
        querystring: notificationListQuerySchema,
        response: { 200: notificationListSchema, ...errors },
      },
    },
    (request) => listNotifications(db, requireAuth(request).user.id, request.query),
  )

  app.post(
    '/read',
    {
      schema: {
        tags,
        summary: 'Mark notifications as read',
        description: 'Send `ids` to mark some, or an empty object to mark all.',
        body: markNotificationsReadRequestSchema,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      await markNotificationsRead(db, requireAuth(request).user.id, request.body)
      return reply.code(204).send(null)
    },
  )
}
