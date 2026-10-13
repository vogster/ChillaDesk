import { liveResourceSchema, type LiveEvent, type LiveResource } from '@chilladesk/shared'
import { and, eq, inArray } from 'drizzle-orm'
import type { FastifyPluginAsync } from 'fastify'
import type { Db } from '../../db/client'
import { projectMembers } from '../../db/schema'
import { AppError } from '../../errors'
import { requireAuth } from '../auth/plugin'
import type { EventBus } from './bus'

/** For the event bus: of the given users, those who are members of the project. */
export const membersAmong =
  (db: Db) =>
  async (projectId: string, userIds: string[]): Promise<string[]> => {
    const rows = await db
      .select({ userId: projectMembers.userId })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.userId, userIds)))
    return rows.map((row) => row.userId)
  }

/**
 * Which part of a project a route changes, from its pattern: the segment after
 * `/api/projects/:projectId`, e.g. `tasks` for `/api/projects/:projectId/tasks/:taskId/move`.
 * Null for routes whose changes nobody else needs to hear about.
 */
export function resourceOfRoute(routePattern: string): LiveResource | null {
  const [, segment] = /\/:projectId\/([^/]+)/.exec(routePattern) ?? []
  // Personal things under a project concern nobody else, so nothing is announced.
  if (segment && PERSONAL_SEGMENTS.has(segment)) return null
  const parsed = liveResourceSchema.safeParse(segment)
  return parsed.success ? parsed.data : 'project'
}

/** Parts of a project that belong to one person: their saved filters. */
const PERSONAL_SEGMENTS = new Set(['filters'])

/** A client that reads slower than events arrive is dropped once this much is waiting. */
const MAX_BUFFERED_BYTES = 64_000

export interface EventRouteOptions {
  events: EventBus
  /** A comment line this often keeps proxies from closing a quiet stream. */
  heartbeatMs?: number
  /**
   * A stream is ended after this long and the browser reconnects, which checks the session
   * again: a signed-out or removed user stops receiving events within that time.
   */
  maxLifetimeMs?: number
  /** Streams one user may hold open at a time. */
  maxPerUser?: number
}

/** Server-sent events for the signed-in user; mounted under `/api/events`. */
export const eventRoutes: FastifyPluginAsync<EventRouteOptions> = async (
  app,
  { events, heartbeatMs = 25_000, maxLifetimeMs = 15 * 60_000, maxPerUser = 10 },
) => {
  app.get(
    '/',
    {
      schema: {
        tags: ['events'],
        summary: 'Stream of changes in your projects (server-sent events)',
        description:
          'Each `data:` line is `{"type":"project_changed","projectId":"…","resource":"tasks"}`: ' +
          'something in that part of the project changed, reload what you show of it. ' +
          'The stream ends after a while; reconnect.',
      },
    },
    (request, reply) => {
      const { user } = requireAuth(request)
      // Refused rather than swapped for an older stream: that one would reconnect and push
      // out the next, forever.
      if (events.countOf(user.id) >= maxPerUser) {
        throw new AppError('RATE_LIMITED', 'Too many open event streams, close some first')
      }
      const stream = reply.raw

      // From here on the response is written by hand, past Fastify's serializer.
      reply.hijack()
      stream.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        // Tells nginx-style proxies not to collect the stream into buffers.
        'X-Accel-Buffering': 'no',
      })
      // How long the browser waits before reconnecting.
      stream.write('retry: 3000\n\n')

      let open = true
      const close = () => {
        if (!open) return
        open = false
        clearInterval(heartbeat)
        clearTimeout(lifetime)
        unsubscribe()
        stream.end()
      }
      const write = (chunk: string) => {
        if (stream.writableLength > MAX_BUFFERED_BYTES) {
          // Nobody is reading: waiting for the buffer to drain would keep it in memory.
          stream.destroy()
          close()
          return
        }
        stream.write(chunk)
      }
      const heartbeat = setInterval(() => write(': ping\n\n'), heartbeatMs)
      const lifetime = setTimeout(close, maxLifetimeMs)
      const unsubscribe = events.subscribe({
        userId: user.id,
        send: (event: LiveEvent) => write(`data: ${JSON.stringify(event)}\n\n`),
        close,
      })
      request.raw.on('close', close)
    },
  )
}
