import { z } from 'zod'
import { listNotifications, markNotificationsRead } from '../notifications/service'
import { tool, type ToolDefinition } from './toolkit'

/** The token owner's own notifications. */
export const INBOX_TOOLS: ToolDefinition[] = [
  tool({
    name: 'list_notifications',
    title: 'List notifications',
    description:
      'Notifications of the token owner, newest first: tasks assigned to them, mentions, ' +
      'comments on and moves of tasks they watch. Use the ids with mark_notifications_read.',
    readOnly: true,
    inputSchema: {
      unreadOnly: z.boolean().default(true),
      limit: z.number().int().min(1).max(100).default(20),
    },
    run: async (input, { db, auth }) => {
      const { items, unreadCount } = await listNotifications(db, auth.user.id, {
        unread: input.unreadOnly,
        limit: input.limit,
      })
      return {
        unreadCount,
        notifications: items.map((item) => ({
          id: item.id,
          type: item.type,
          from: item.actor?.email ?? null,
          project: item.project.key,
          task: item.task?.key ?? null,
          page: item.page?.title ?? null,
          excerpt: item.excerpt,
          read: item.readAt !== null,
          createdAt: item.createdAt,
        })),
      }
    },
  }),

  tool({
    name: 'mark_notifications_read',
    title: 'Mark notifications as read',
    description: 'Marks the given notifications as read, or all of them when no ids are given.',
    readOnly: false,
    inputSchema: { ids: z.array(z.uuid()).max(100).optional() },
    run: async (input, { db, auth }) => {
      await markNotificationsRead(db, auth.user.id, input.ids ? { ids: input.ids } : {})
      const { unreadCount } = await listNotifications(db, auth.user.id, { unread: true, limit: 1 })
      return { unreadCount }
    },
  }),
]
