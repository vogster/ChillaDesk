import {
  createdInviteSchema,
  createInviteRequestSchema,
  errorResponseSchema,
  invitePreviewSchema,
  inviteTokenRequestSchema,
  projectInviteSchema,
  projectSchema,
} from '@chilladesk/shared'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { requireAuth, requireSession } from '../auth/plugin'
import { acceptInvite, createInvite, listInvites, previewInvite, revokeInvite } from './service'

const projectParams = z.object({ projectId: z.uuid() })
const inviteParams = projectParams.extend({ inviteId: z.uuid() })

const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
}

/**
 * Invite links of a project; mounted under `/api/projects/:projectId/invites`. Like the
 * rest of member management this needs a signed-in session, not an API token.
 */
export const projectInviteRoutes: FastifyPluginAsyncZod<{ db: Db }> = async (app, { db }) => {
  const tags = ['invites']

  app.get(
    '/',
    {
      schema: {
        tags,
        summary: 'Invite links of the project that still work (owner only)',
        params: projectParams,
        response: { 200: z.array(projectInviteSchema), ...errors },
      },
    },
    (request) => listInvites(db, requireSession(request).user.id, request.params.projectId),
  )

  app.post(
    '/',
    {
      schema: {
        tags,
        summary: 'Create an invite link (owner only)',
        description:
          'Anyone signed in who opens the link within a week can join with the given role. ' +
          'The token is in this response only.',
        params: projectParams,
        body: createInviteRequestSchema,
        response: { 201: createdInviteSchema, ...errors, 409: errorResponseSchema },
      },
    },
    async (request, reply) => {
      const invite = await createInvite(
        db,
        requireSession(request).user.id,
        request.params.projectId,
        request.body,
      )
      return reply.code(201).send(invite)
    },
  )

  app.delete(
    '/:inviteId',
    {
      schema: {
        tags,
        summary: 'Revoke an invite link (owner only)',
        params: inviteParams,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      const { projectId, inviteId } = request.params
      await revokeInvite(db, requireSession(request).user.id, projectId, inviteId)
      return reply.code(204).send(null)
    },
  )
}

export interface InviteRoutesOptions {
  db: Db
  /** Lookups and acceptances per minute per client; bounds guessing at tokens. */
  rateLimitMax: number
}

/** For the holder of an invite link; mounted under `/api/invites`. */
export const inviteRoutes: FastifyPluginAsyncZod<InviteRoutesOptions> = async (
  app,
  { db, rateLimitMax },
) => {
  const tags = ['invites']
  const config = { rateLimit: { max: rateLimitMax, timeWindow: '1 minute' } }
  const inviteErrors = { 401: errorResponseSchema, 404: errorResponseSchema }

  app.post(
    '/preview',
    {
      config,
      schema: {
        tags,
        summary: 'What an invite link leads to',
        body: inviteTokenRequestSchema,
        response: { 200: invitePreviewSchema, ...inviteErrors },
      },
    },
    (request) => previewInvite(db, requireAuth(request).user.id, request.body.token),
  )

  app.post(
    '/accept',
    {
      config,
      schema: {
        tags,
        summary: 'Join the project an invite link is for',
        description: 'Someone who is a member already keeps the role they have.',
        body: inviteTokenRequestSchema,
        response: { 200: projectSchema, ...inviteErrors, 403: errorResponseSchema },
      },
    },
    async (request) => {
      const userId = requireSession(request).user.id
      const { project, joined } = await acceptInvite(db, userId, request.body.token)
      if (joined) {
        app.events.publishAccessChange([userId])
        void app.events.publishProject(project.id, 'members')
      }
      return project
    },
  )
}
