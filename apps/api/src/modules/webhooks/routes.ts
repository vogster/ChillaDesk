import {
  createdWebhookSchema,
  createWebhookRequestSchema,
  errorResponseSchema,
  updateWebhookRequestSchema,
  webhookDeliverySchema,
  webhookSchema,
} from '@chilladesk/shared'
import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { requireAuth } from '../auth/plugin'
import {
  createWebhook,
  deleteWebhook,
  listDeliveries,
  listWebhooks,
  pingWebhook,
  updateWebhook,
} from './service'

export interface WebhookRoutesOptions {
  db: Db
  /** Lets webhooks point at private addresses; off unless the server says so. */
  allowPrivate: boolean
}

const params = z.object({ projectId: z.uuid() })
const itemParams = params.extend({ webhookId: z.uuid() })
const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
}

/** A project's webhooks; mounted under `/api/projects/:projectId/webhooks`. Owners only. */
export const webhookRoutes: FastifyPluginAsyncZod<WebhookRoutesOptions> = async (
  app,
  { db, allowPrivate },
) => {
  const tags = ['webhooks']
  const userOf = (request: FastifyRequest) => requireAuth(request).user.id
  const policy = { allowPrivate }

  app.get(
    '/',
    {
      schema: {
        tags,
        summary: 'List webhooks with their last delivery',
        params,
        response: { 200: z.array(webhookSchema), ...errors },
      },
    },
    (request) => listWebhooks(db, userOf(request), request.params.projectId),
  )

  app.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Add a webhook',
        description:
          'The answer carries the secret deliveries are signed with; it is not shown again. ' +
          'Each delivery has `X-ChillaDesk-Timestamp` and `X-ChillaDesk-Signature: ' +
          'sha256=<hex>`, the HMAC-SHA256 of `<timestamp>.<body>` with that secret.',
        params,
        body: createWebhookRequestSchema,
        response: { 201: createdWebhookSchema, ...errors, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const created = await createWebhook(
        db,
        userOf(request),
        request.params.projectId,
        request.body,
        policy,
      )
      return reply.code(201).send(created)
    },
  )

  app.patch(
    '/:webhookId',
    {
      schema: {
        tags,
        summary: 'Change a webhook, or turn it off and on',
        params: itemParams,
        body: updateWebhookRequestSchema,
        response: { 200: webhookSchema, ...errors },
      },
    },
    (request) =>
      updateWebhook(
        db,
        userOf(request),
        request.params.projectId,
        request.params.webhookId,
        request.body,
        policy,
      ),
  )

  app.delete(
    '/:webhookId',
    {
      schema: {
        tags,
        summary: 'Delete a webhook',
        params: itemParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      await deleteWebhook(db, userOf(request), request.params.projectId, request.params.webhookId)
      return reply.code(204).send(null)
    },
  )

  app.get(
    '/:webhookId/deliveries',
    {
      schema: {
        tags,
        summary: 'Recent deliveries of a webhook',
        params: itemParams,
        response: { 200: z.array(webhookDeliverySchema), ...errors },
      },
    },
    (request) =>
      listDeliveries(db, userOf(request), request.params.projectId, request.params.webhookId),
  )

  app.post(
    '/:webhookId/test',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags,
        summary: 'Send a test message',
        description: 'Queued like any delivery; see how it went in the deliveries.',
        params: itemParams,
        response: { 202: webhookDeliverySchema, ...errors, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const delivery = await pingWebhook(
        db,
        userOf(request),
        request.params.projectId,
        request.params.webhookId,
      )
      return reply.code(202).send(delivery)
    },
  )
}
