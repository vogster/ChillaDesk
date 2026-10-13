import { createSavedFilterSchema, errorResponseSchema, savedFilterSchema } from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { requireAuth } from '../auth/plugin'
import { createSavedFilter, deleteSavedFilter, listSavedFilters } from './bulk.service'

const projectParams = z.object({ projectId: z.uuid() })
const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  404: errorResponseSchema,
  409: errorResponseSchema,
}

/**
 * A person's own saved filters of the task list; mounted under
 * `/api/projects/:projectId/filters`. Even a viewer may keep some: they change nothing
 * anyone else sees.
 */
export const savedFilterRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  const tags = ['saved filters']

  app.get(
    '/',
    {
      schema: {
        tags,
        summary: 'Your saved filters of this project, by name',
        params: projectParams,
        response: { 200: z.array(savedFilterSchema), ...errors },
      },
    },
    (request) => listSavedFilters(db, requireAuth(request).user.id, request.params.projectId),
  )

  app.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Save a set of list filters under a name',
        params: projectParams,
        body: createSavedFilterSchema,
        response: { 201: savedFilterSchema, ...errors },
      },
    },
    async (request, reply) => {
      const filter = await createSavedFilter(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.body,
      )
      return reply.code(201).send(filter)
    },
  )

  app.delete(
    '/:filterId',
    {
      schema: {
        tags,
        summary: 'Delete one of your saved filters',
        params: projectParams.extend({ filterId: z.uuid() }),
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const { projectId, filterId } = request.params
      await deleteSavedFilter(db, requireAuth(request).user.id, projectId, filterId)
      return reply.code(204).send(null)
    },
  )
}
