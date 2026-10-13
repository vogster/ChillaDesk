import {
  addMemberRequestSchema,
  createProjectRequestSchema,
  errorResponseSchema,
  projectMemberSchema,
  projectSchema,
  updateMemberRequestSchema,
  updateProjectRequestSchema,
} from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { requireAuth, requireSession } from '../auth/plugin'
import {
  addMember,
  createProject,
  deleteProject,
  getProject,
  listMembers,
  listProjects,
  removeMember,
  updateMemberRole,
  updateProject,
} from './service'

const projectParams = z.object({ projectId: z.uuid() })
const memberParams = projectParams.extend({ userId: z.uuid() })

const errors = {
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
}

/**
 * Who is in a project, and whether it exists at all, is changed only from a signed-in
 * session (`requireSession`), never with a personal API token: a leaked token could
 * otherwise add its thief as an owner, and that would outlast revoking the token.
 */
export interface ProjectRoutesOptions {
  db: Db
  memberInviteRateLimitMax: number
}

export const projectRoutes: FastifyPluginAsyncZod<ProjectRoutesOptions> = async (
  app,
  { db, memberInviteRateLimitMax },
) => {
  // onRequest runs before body validation, so anonymous callers get 401 rather than field errors.
  app.addHook('onRequest', async (request) => {
    requireAuth(request)
  })

  const tags = ['projects']
  const memberTags = ['project members']

  app.get(
    '/',
    {
      schema: {
        tags,
        summary: 'Projects the current user belongs to',
        response: { 200: z.array(projectSchema), 401: errorResponseSchema },
      },
    },
    (request) => listProjects(db, requireAuth(request).user.id),
  )

  app.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Create a project; the creator becomes its owner',
        body: createProjectRequestSchema,
        response: { 201: projectSchema, 401: errorResponseSchema, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const project = await createProject(db, requireAuth(request).user.id, request.body)
      return reply.code(201).send(project)
    },
  )

  app.get(
    '/:projectId',
    {
      schema: {
        tags,
        summary: 'Project details',
        params: projectParams,
        response: { 200: projectSchema, ...errors },
      },
    },
    (request) => getProject(db, requireAuth(request).user.id, request.params.projectId),
  )

  app.patch(
    '/:projectId',
    {
      schema: {
        tags,
        summary: 'Update a project (owner only)',
        params: projectParams,
        body: updateProjectRequestSchema,
        response: { 200: projectSchema, ...errors },
      },
    },
    (request) =>
      updateProject(db, requireAuth(request).user.id, request.params.projectId, request.body),
  )

  app.delete(
    '/:projectId',
    {
      schema: {
        tags,
        summary: 'Delete a project with all its data (owner only)',
        params: projectParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      await deleteProject(db, requireSession(request).user.id, request.params.projectId)
      return reply.code(204).send(null)
    },
  )

  app.get(
    '/:projectId/members',
    {
      schema: {
        tags: memberTags,
        summary: 'Project members',
        params: projectParams,
        response: { 200: z.array(projectMemberSchema), ...errors },
      },
    },
    (request) => listMembers(db, requireAuth(request).user.id, request.params.projectId),
  )

  app.post(
    '/:projectId/members',
    {
      // The answer reveals whether an email is registered, so each user gets a small budget.
      config: {
        rateLimit: {
          max: memberInviteRateLimitMax,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (request) => `invite:${request.auth?.user.id ?? request.ip}`,
        },
      },
      schema: {
        tags: memberTags,
        summary: 'Add a registered user to the project by email (owner only)',
        params: projectParams,
        body: addMemberRequestSchema,
        response: { 201: projectMemberSchema, ...errors, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const member = await addMember(
        db,
        requireSession(request).user.id,
        request.params.projectId,
        request.body,
      )
      return reply.code(201).send(member)
    },
  )

  app.patch(
    '/:projectId/members/:userId',
    {
      schema: {
        tags: memberTags,
        summary: "Change a member's role (owner only)",
        params: memberParams,
        body: updateMemberRequestSchema,
        response: { 200: projectMemberSchema, ...errors, 409: errorResponseSchema },
      },
    },
    (request) =>
      updateMemberRole(
        db,
        requireSession(request).user.id,
        request.params.projectId,
        request.params.userId,
        request.body.role,
      ),
  )

  app.delete(
    '/:projectId/members/:userId',
    {
      schema: {
        tags: memberTags,
        summary: 'Remove a member (owner), or leave the project (yourself)',
        params: memberParams,
        response: { 204: z.null(), ...errors, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      await removeMember(
        db,
        requireSession(request).user.id,
        request.params.projectId,
        request.params.userId,
      )
      return reply.code(204).send(null)
    },
  )
}
