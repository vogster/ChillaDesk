import {
  createStatusRequestSchema,
  errorResponseSchema,
  reorderStatusesRequestSchema,
  statusSchema,
  updateStatusRequestSchema,
} from '@chillawiki/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { requireAuth } from '../auth/plugin'
import {
  createStatus,
  deleteStatus,
  listStatuses,
  reorderStatuses,
  updateStatus,
} from './statuses.service'

const projectParams = z.object({ projectId: z.uuid() })
const statusParams = projectParams.extend({ statusId: z.uuid() })

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
}

/** Board columns; mounted under `/api/projects/:projectId/statuses`. */
export const statusRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.addHook('onRequest', async (request) => {
    requireAuth(request)
  })

  const tags = ['board']

  app.get(
    '/',
    {
      schema: {
        tags,
        summary: 'Board columns, left to right',
        params: projectParams,
        response: { 200: z.array(statusSchema), ...errors },
      },
    },
    (request) => listStatuses(db, requireAuth(request).user.id, request.params.projectId),
  )

  app.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Add a column at the right edge (owner only)',
        params: projectParams,
        body: createStatusRequestSchema,
        response: { 201: statusSchema, ...errors },
      },
    },
    async (request, reply) => {
      const status = await createStatus(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.body,
      )
      return reply.code(201).send(status)
    },
  )

  app.put(
    '/order',
    {
      schema: {
        tags,
        summary: 'Reorder the columns (owner only)',
        params: projectParams,
        body: reorderStatusesRequestSchema,
        response: { 200: z.array(statusSchema), ...errors },
      },
    },
    (request) =>
      reorderStatuses(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.body.statusIds,
      ),
  )

  app.patch(
    '/:statusId',
    {
      schema: {
        tags,
        summary: 'Rename a column or change its category (owner only)',
        params: statusParams,
        body: updateStatusRequestSchema,
        response: { 200: statusSchema, ...errors },
      },
    },
    (request) =>
      updateStatus(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.statusId,
        request.body,
      ),
  )

  app.delete(
    '/:statusId',
    {
      schema: {
        tags,
        summary: 'Delete an empty column (owner only)',
        params: statusParams,
        response: { 204: z.null(), ...errors, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await deleteStatus(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.statusId,
      )
      return reply.code(204).send(null)
    },
  )
}
