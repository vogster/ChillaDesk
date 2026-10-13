import {
  commentRequestSchema,
  commentSchema,
  createTaskRequestSchema,
  errorResponseSchema,
  moveTaskRequestSchema,
  taskEventSchema,
  taskListQuerySchema,
  taskListSchema,
  taskSchema,
  updateTaskRequestSchema,
} from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { requireAuth } from '../auth/plugin'
import { addComment, deleteComment, listComments, updateComment } from './comments.service'
import { listTaskHistory } from './history.service'
import {
  createTask,
  deleteTask,
  getTask,
  getTaskByNumber,
  listTasks,
  moveTask,
  updateTask,
} from './service'

const projectParams = z.object({ projectId: z.uuid() })
const taskParams = projectParams.extend({ taskId: z.uuid() })
const commentParams = taskParams.extend({ commentId: z.uuid() })
const numberParams = projectParams.extend({
  number: z.coerce.number().int().min(1).max(2147483647),
})

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
}

/** Tasks and their comments; mounted under `/api/projects/:projectId/tasks`. */
export const taskRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  app.addHook('onRequest', async (request) => {
    requireAuth(request)
  })

  const tags = ['tasks']
  const commentTags = ['task comments']

  app.get(
    '/',
    {
      schema: {
        tags,
        summary: 'Tasks of a project, in board order',
        description: 'Sorted by column, then by position within the column.',
        params: projectParams,
        querystring: taskListQuerySchema,
        response: { 200: taskListSchema, ...errors },
      },
    },
    (request) =>
      listTasks(db, requireAuth(request).user.id, request.params.projectId, request.query),
  )

  app.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Create a task at the end of a column',
        params: projectParams,
        body: createTaskRequestSchema,
        response: { 201: taskSchema, ...errors },
      },
    },
    async (request, reply) => {
      const task = await createTask(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.body,
      )
      return reply.code(201).send(task)
    },
  )

  app.get(
    '/by-number/:number',
    {
      schema: {
        tags,
        summary: 'Task by its number, the part after the dash in a key such as CHL-12',
        params: numberParams,
        response: { 200: taskSchema, ...errors },
      },
    },
    (request) =>
      getTaskByNumber(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.number,
      ),
  )

  app.get(
    '/:taskId',
    {
      schema: {
        tags,
        summary: 'Task details',
        params: taskParams,
        response: { 200: taskSchema, ...errors },
      },
    },
    (request) =>
      getTask(db, requireAuth(request).user.id, request.params.projectId, request.params.taskId),
  )

  app.patch(
    '/:taskId',
    {
      schema: {
        tags,
        summary: 'Edit a task',
        description: 'Use the move endpoint to change the column or the order.',
        params: taskParams,
        body: updateTaskRequestSchema,
        response: { 200: taskSchema, ...errors },
      },
    },
    (request) =>
      updateTask(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.taskId,
        request.body,
      ),
  )

  app.post(
    '/:taskId/move',
    {
      schema: {
        tags,
        summary: 'Move a task to a column and position',
        params: taskParams,
        body: moveTaskRequestSchema,
        response: { 200: taskSchema, ...errors },
      },
    },
    (request) =>
      moveTask(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.taskId,
        request.body,
      ),
  )

  app.delete(
    '/:taskId',
    {
      schema: {
        tags,
        summary: 'Delete a task and its comments',
        params: taskParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      await deleteTask(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.taskId,
      )
      return reply.code(204).send(null)
    },
  )

  app.get(
    '/:taskId/comments',
    {
      schema: {
        tags: commentTags,
        summary: 'Comments on a task, oldest first',
        params: taskParams,
        response: { 200: z.array(commentSchema), ...errors },
      },
    },
    (request) =>
      listComments(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.taskId,
      ),
  )

  app.get(
    '/:taskId/history',
    {
      schema: {
        tags,
        summary: 'What happened to a task, oldest first',
        params: taskParams,
        response: { 200: z.array(taskEventSchema), ...errors },
      },
    },
    (request) =>
      listTaskHistory(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.taskId,
      ),
  )

  app.post(
    '/:taskId/comments',
    {
      schema: {
        tags: commentTags,
        summary: 'Add a comment',
        params: taskParams,
        body: commentRequestSchema,
        response: { 201: commentSchema, ...errors },
      },
    },
    async (request, reply) => {
      const comment = await addComment(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.taskId,
        request.body,
      )
      return reply.code(201).send(comment)
    },
  )

  app.patch(
    '/:taskId/comments/:commentId',
    {
      schema: {
        tags: commentTags,
        summary: 'Edit your own comment',
        params: commentParams,
        body: commentRequestSchema,
        response: { 200: commentSchema, ...errors },
      },
    },
    (request) =>
      updateComment(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.taskId,
        request.params.commentId,
        request.body,
      ),
  )

  app.delete(
    '/:taskId/comments/:commentId',
    {
      schema: {
        tags: commentTags,
        summary: 'Delete a comment (its author or a project owner)',
        params: commentParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      await deleteComment(
        db,
        requireAuth(request).user.id,
        request.params.projectId,
        request.params.taskId,
        request.params.commentId,
      )
      return reply.code(204).send(null)
    },
  )
}
