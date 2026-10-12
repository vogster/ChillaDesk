import { notificationListSchema, type NotificationList } from '@chillawiki/shared'
import { apiRequest } from './client'

export const fetchNotifications = (): Promise<NotificationList> =>
  apiRequest('/notifications', { schema: notificationListSchema })

/** Marks the given notifications as read, or all of them when no ids are given. */
export const markNotificationsRead = (ids?: string[]): Promise<void> =>
  apiRequest('/notifications/read', { method: 'POST', body: ids ? { ids } : {} })
