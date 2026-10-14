import {
  addMemberRequestSchema,
  createProjectRequestSchema,
  errorResponseSchema,
  memberInvitedSchema,
  projectMemberSchema,
  projectSchema,
  updateMemberRequestSchema,
  updateProjectRequestSchema,
} from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { createAttemptLimiter } from '../auth/attempt-limiter'
import type { AccountMail } from '../auth/email-flows'
import { requireAuth, requireSession } from '../auth/plugin'
import { inviteByEmail } from '../invites/service'
import {
  addMember,
  createProject,
  deleteProject,
  memberIdsOf,
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
  /** With it, adding by email sends an invite link instead of adding at once. */
  mail?: AccountMail | undefined
  /** Emails one address may get per 15 minutes, shared with the other account emails. */
  accountEmailRateLimitMax: number
}

export const projectRoutes: FastifyPluginAsyncZod<ProjectRoutesOptions> = async (
  app,
  { db, memberInviteRateLimitMax, mail, accountEmailRateLimitMax },
) => {
  const inviteEmails = createAttemptLimiter(db, {
    name: 'account-email',
    max: accountEmailRateLimitMax,
    windowMs: 15 * 60 * 1000,
  })
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
      const { projectId } = request.params
      const userId = requireSession(request).user.id
      // Read before the project goes: afterwards nobody is a member of it any more.
      const members = await memberIdsOf(db, projectId)
      await deleteProject(db, userId, projectId)
      app.events.publishAccessChange(members)
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
        summary: 'Add someone to the project by email (owner only)',
        description:
          'Without email set up on the server: adds the registered user at once (201). With ' +
          'email: sends an invite link to the address (202) whether or not it has an account, ' +
          'so the answer does not tell who is registered; they join when they open it.',
        params: projectParams,
        body: addMemberRequestSchema,
        response: {
          201: projectMemberSchema,
          202: memberInvitedSchema,
          ...errors,
          409: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      if (mail) {
        await inviteByEmail(
          db,
          mail,
          requireSession(request).user.id,
          request.params.projectId,
          request.body,
          {
            allowEmail: async (email) => (await inviteEmails.consume(email)).allowed,
            onError: (error) => {
              const { name, code } = (error ?? {}) as { name?: unknown; code?: unknown }
              app.log.warn({ name, code }, 'invite email was not sent')
            },
          },
        )
        return reply.code(202).send({ invited: true as const })
      }
      const member = await addMember(
        db,
        requireSession(request).user.id,
        request.params.projectId,
        request.body,
      )
      // Their project list has a new entry.
      app.events.publishAccessChange([member.userId])
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
      // No longer a member, so the project's own events do not reach them any more.
      app.events.publishAccessChange([request.params.userId])
      return reply.code(204).send(null)
    },
  )
}
