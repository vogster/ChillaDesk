import {
  createLabelRequestSchema,
  errorResponseSchema,
  labelSchema,
  updateLabelRequestSchema,
} from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { requireAuth } from '../auth/plugin'
import { createLabel, deleteLabel, listLabels, updateLabel } from './service'

const projectParams = z.object({ projectId: z.uuid() })
const labelParams = projectParams.extend({ labelId: z.uuid() })

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
}

/** Task labels of a project; mounted under `/api/projects/:projectId/labels`. */
export const labelRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.addHook('onRequest', async (request) => {
    requireAuth(request)
  })

  const tags = ['labels']

  app.get(
    '/',
    {
      schema: {
        tags,
        summary: 'Labels of a project, by name',
        params: projectParams,
        response: { 200: z.array(labelSchema), ...errors },
      },
    },
    (request) => listLabels(db, requireAuth(request).user.id, request.params.projectId),
  )

  app.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Create a label',
        params: projectParams,
        body: createLabelRequestSchema,
        response: { 201: labelSchema, ...errors, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const label = await createLabel(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.body,
      )
      return reply.code(201).send(label)
    },
  )

  app.patch(
    '/:labelId',
    {
      schema: {
        tags,
        summary: 'Rename or recolour a label',
        params: labelParams,
        body: updateLabelRequestSchema,
        response: { 200: labelSchema, ...errors, 409: errorResponseSchema },
      },
    },
    (request) =>
      updateLabel(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.labelId,
        request.body,
      ),
  )

  app.delete(
    '/:labelId',
    {
      schema: {
        tags,
        summary: 'Delete a label and take it off every task',
        params: labelParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      await deleteLabel(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.labelId,
      )
      return reply.code(204).send(null)
    },
  )
}
