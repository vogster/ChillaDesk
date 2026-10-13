import { z } from 'zod'

/** The part of a project a change touched; clients reload only what depends on it. */
export const liveResourceSchema = z.enum([
  'project',
  'members',
  'invites',
  'statuses',
  'labels',
  'tasks',
  'wiki',
])
export type LiveResource = z.infer<typeof liveResourceSchema>

/**
 * What the server pushes over `GET /api/events` (server-sent events). An event says where
 * something changed, never what: the client then reloads what it is showing through the
 * ordinary endpoints, which do the access checks.
 */
export const liveEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('project_changed'),
    projectId: z.uuid(),
    resource: liveResourceSchema,
  }),
  /**
   * Which projects the receiver can see has changed: they were added to one, removed from
   * one, or one was deleted. Sent to that user only; reload everything.
   */
  z.object({ type: z.literal('access_changed') }),
])
export type LiveEvent = z.infer<typeof liveEventSchema>
