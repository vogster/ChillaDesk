import { z } from 'zod'
import { projectRefSchema } from './overview'
import { userSummarySchema } from './tasks'

export const notificationTypeSchema = z.enum([
  /** A task was assigned to you. */
  'task_assigned',
  /** Someone commented on a task you are assigned to or created. */
  'task_commented',
  /** You were mentioned in a task, a comment or a wiki page. */
  'mentioned',
])
export type NotificationType = z.infer<typeof notificationTypeSchema>

export const notificationSchema = z.object({
  id: z.uuid(),
  type: notificationTypeSchema,
  /** Who caused it; null when their account was deleted. */
  actor: userSummarySchema.nullable(),
  project: projectRefSchema,
  /** The task it is about, if any. */
  task: z.object({ id: z.uuid(), key: z.string(), title: z.string() }).nullable(),
  /** The wiki page it is about, if any. */
  page: z.object({ id: z.uuid(), title: z.string() }).nullable(),
  /** The start of the text that caused it, as plain Markdown. */
  excerpt: z.string(),
  /** Null while unread. */
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
})
export type Notification = z.infer<typeof notificationSchema>

export const NOTIFICATIONS_PAGE_MAX = 100

export const notificationListQuerySchema = z.object({
  unread: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  limit: z.coerce.number().int().min(1).max(NOTIFICATIONS_PAGE_MAX).default(50),
})
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>

export const notificationListSchema = z.object({
  /** Newest first. */
  items: z.array(notificationSchema),
  /** All unread notifications of the user, not only those on this page. */
  unreadCount: z.number().int(),
})
export type NotificationList = z.infer<typeof notificationListSchema>

export const markNotificationsReadRequestSchema = z.object({
  /** The notifications to mark as read; leave out to mark all of them. */
  ids: z.array(z.uuid()).min(1).max(NOTIFICATIONS_PAGE_MAX).optional(),
})
export type MarkNotificationsReadRequest = z.infer<typeof markNotificationsReadRequestSchema>
