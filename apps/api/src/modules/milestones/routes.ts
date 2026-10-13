import {
  createMilestoneRequestSchema,
  errorResponseSchema,
  milestoneSchema,
  updateMilestoneRequestSchema,
} from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { requireAuth } from '../auth/plugin'
import { createMilestone, deleteMilestone, listMilestones, updateMilestone } from './service'

const projectParams = z.object({ projectId: z.uuid() })
const milestoneParams = projectParams.extend({ milestoneId: z.uuid() })

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
}
const withConflict = { ...errors, 409: errorResponseSchema }

/** Milestones of a project; mounted under `/api/projects/:projectId/milestones`. */
export const milestoneRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  const tags = ['milestones']
  const userOf = (request: Parameters<typeof requireAuth>[0]) => requireAuth(request).user.id

  app.get(
    '/',
    {
      schema: {
        tags,
        summary: 'Milestones with their progress: open ones first, by date',
        params: projectParams,
        response: { 200: z.array(milestoneSchema), ...errors },
      },
    },
    (request) => listMilestones(db, userOf(request), request.params.projectId),
  )

  app.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Create a milestone',
        params: projectParams,
        body: createMilestoneRequestSchema,
        response: { 201: milestoneSchema, ...withConflict },
      },
    },
    async (request, reply) => {
      const milestone = await createMilestone(
        db,
        userOf(request),
        request.params.projectId,
        request.body,
      )
      return reply.code(201).send(milestone)
    },
  )

  app.patch(
    '/:milestoneId',
    {
      schema: {
        tags,
        summary: 'Rename a milestone, change its date, close or reopen it',
        params: milestoneParams,
        body: updateMilestoneRequestSchema,
        response: { 200: milestoneSchema, ...withConflict },
      },
    },
    (request) => {
      const { projectId, milestoneId } = request.params
      return updateMilestone(db, userOf(request), projectId, milestoneId, request.body)
    },
  )

  app.delete(
    '/:milestoneId',
    {
      schema: {
        tags,
        summary: 'Delete a milestone; its tasks stay',
        params: milestoneParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const { projectId, milestoneId } = request.params
      await deleteMilestone(db, userOf(request), projectId, milestoneId)
      return reply.code(204).send(null)
    },
  )
}
