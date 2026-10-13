import type { NotificationList } from '@chilladesk/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchNotifications, markNotificationsRead } from '../../api/notifications'

export const notificationsKey = ['notifications'] as const

/** How often the header asks whether something new has arrived. */
const POLL_INTERVAL_MS = 60_000

export const useNotifications = () =>
  useQuery({
    queryKey: notificationsKey,
    queryFn: fetchNotifications,
    refetchInterval: POLL_INTERVAL_MS,
  })

function withRead(list: NotificationList, ids: string[] | undefined, readAt: string) {
  const items = list.items.map((item) =>
    item.readAt === null && (!ids || ids.includes(item.id)) ? { ...item, readAt } : item,
  )
  const nowRead = items.filter((item, index) => item !== list.items[index]).length
  // Without ids everything is read, including what is not on this page of the list.
  return { items, unreadCount: ids ? Math.max(0, list.unreadCount - nowRead) : 0 }
}

/** Marks notifications as read; pass no ids for all of them. */
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids?: string[]) => markNotificationsRead(ids),
    onSuccess: (_result, ids) => {
      queryClient.setQueryData<NotificationList>(notificationsKey, (list) =>
        list ? withRead(list, ids, new Date().toISOString()) : list,
      )
    },
  })
}
