import {
  errorResponseSchema,
  myTasksQuerySchema,
  searchQuerySchema,
  searchResultsSchema,
  taskInContextSchema,
} from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { requireAuth } from '../auth/plugin'
import { listMyTasks, search } from './service'

const errors = { 400: errorResponseSchema, 401: errorResponseSchema }

/** Views across all of the user's projects; mounted under `/api`. */
export const overviewRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.addHook('onRequest', async (request) => {
    requireAuth(request)
  })

  app.get(
    '/me/tasks',
    {
      schema: {
        tags: ['overview'],
        summary: 'Tasks assigned to the current user, in every project',
        description: 'Earliest due date first, then highest priority. Finished tasks are left out.',
        querystring: myTasksQuerySchema,
        response: { 200: z.array(taskInContextSchema), ...errors },
      },
    },
    (request) => listMyTasks(db, requireAuth(request).user.id, request.query),
  )

  app.get(
    '/search',
    {
      schema: {
        tags: ['overview'],
        summary: 'Search tasks and wiki pages in every project of the current user',
        description: 'A task key such as `CHL-12` finds that task. Title matches come first.',
        querystring: searchQuerySchema,
        response: { 200: searchResultsSchema, ...errors },
      },
    },
    (request) => search(db, requireAuth(request).user.id, request.query.q),
  )
}
