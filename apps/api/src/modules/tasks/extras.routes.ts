import {
  checklistItemSchema,
  createChecklistItemSchema,
  createTaskLinkSchema,
  errorResponseSchema,
  taskLinkSchema,
  updateChecklistItemSchema,
} from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { requireAuth } from '../auth/plugin'
import {
  addChecklistItem,
  deleteChecklistItem,
  listChecklist,
  updateChecklistItem,
} from './checklist.service'
import { addLink, listLinks, removeLink } from './links.service'

const taskParams = z.object({ projectId: z.uuid(), taskId: z.uuid() })
const itemParams = taskParams.extend({ itemId: z.uuid() })
const linkParams = taskParams.extend({ linkId: z.uuid() })

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
}
const withConflict = { ...errors, 409: errorResponseSchema }

/**
 * What hangs off a task besides comments: its checklist and its links to other tasks.
 * Mounted under `/api/projects/:projectId/tasks`, next to the task routes.
 */
export const taskExtraRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.addHook('onRequest', async (request) => {
    requireAuth(request)
  })
  const userOf = (request: Parameters<typeof requireAuth>[0]) => requireAuth(request).user.id

  const checklistTags = ['task checklist']

  app.get(
    '/:taskId/checklist',
    {
      schema: {
        tags: checklistTags,
        summary: 'The checklist of a task, in the order the items were added',
        params: taskParams,
        response: { 200: z.array(checklistItemSchema), ...errors },
      },
    },
    (request) => {
      const { projectId, taskId } = request.params
      return listChecklist(db, userOf(request), projectId, taskId)
    },
  )

  app.post(
    '/:taskId/checklist',
    {
      schema: {
        tags: checklistTags,
        summary: 'Add an item to the checklist',
        params: taskParams,
        body: createChecklistItemSchema,
        response: { 201: checklistItemSchema, ...withConflict },
      },
    },
    async (request, reply) => {
      const { projectId, taskId } = request.params
      const item = await addChecklistItem(db, userOf(request), projectId, taskId, request.body)
      return reply.code(201).send(item)
    },
  )

  app.patch(
    '/:taskId/checklist/:itemId',
    {
      schema: {
        tags: checklistTags,
        summary: 'Tick, untick or reword a checklist item',
        params: itemParams,
        body: updateChecklistItemSchema,
        response: { 200: checklistItemSchema, ...errors },
      },
    },
    (request) => {
      const { projectId, taskId, itemId } = request.params
      return updateChecklistItem(db, userOf(request), projectId, taskId, itemId, request.body)
    },
  )

  app.delete(
    '/:taskId/checklist/:itemId',
    {
      schema: {
        tags: checklistTags,
        summary: 'Remove a checklist item',
        params: itemParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const { projectId, taskId, itemId } = request.params
      await deleteChecklistItem(db, userOf(request), projectId, taskId, itemId)
      return reply.code(204).send(null)
    },
  )

  const linkTags = ['task links']

  app.get(
    '/:taskId/links',
    {
      schema: {
        tags: linkTags,
        summary: 'Links of a task to other tasks, read from this task',
        params: taskParams,
        response: { 200: z.array(taskLinkSchema), ...errors },
      },
    },
    (request) => {
      const { projectId, taskId } = request.params
      return listLinks(db, userOf(request), projectId, taskId)
    },
  )

  app.post(
    '/:taskId/links',
    {
      schema: {
        tags: linkTags,
        summary: 'Link a task to another task of the project',
        description:
          'The relation is read from this task: `blocked_by` means the other task blocks ' +
          'this one. Two tasks can have one link between them. Answers with all links.',
        params: taskParams,
        body: createTaskLinkSchema,
        response: { 201: z.array(taskLinkSchema), ...withConflict },
      },
    },
    async (request, reply) => {
      const { projectId, taskId } = request.params
      const links = await addLink(db, userOf(request), projectId, taskId, request.body)
      return reply.code(201).send(links)
    },
  )

  app.delete(
    '/:taskId/links/:linkId',
    {
      schema: {
        tags: linkTags,
        summary: 'Remove a link (from either of its two tasks)',
        params: linkParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const { projectId, taskId, linkId } = request.params
      await removeLink(db, userOf(request), projectId, taskId, linkId)
      return reply.code(204).send(null)
    },
  )
}
