import type { Notification } from '@chillawiki/shared'
import { Link } from 'react-router'
import { errorMessage } from '../../api/client'
import { Alert, Button, Spinner } from '../../components/ui'
import { intlLocale, useT, type Messages } from '../../i18n'
import { wikiPagePath } from '../project/wiki/wikiModel'
import { useMarkNotificationsRead, useNotifications } from './notificationQueries'

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' })
}

type NotificationTexts = Messages['shell']['notifications']

/** Where the notification leads and what that place is called. */
function subjectOf(
  { project, task, page }: Notification,
  texts: NotificationTexts,
): { label: string; to: string } {
  if (task) {
    return {
      label: `${task.key} ${task.title}`,
      to: `/projects/${project.id}?${new URLSearchParams({ task: task.id })}`,
    }
  }
  if (page) return { label: texts.wikiPage(page.title), to: wikiPagePath(project.id, page.id) }
  return { label: project.name, to: `/projects/${project.id}` }
}

interface NotificationItemProps {
  notification: Notification
  onOpen: (notification: Notification) => void
}

function NotificationItem({ notification, onOpen }: NotificationItemProps) {
  const t = useT()
  const texts = t.shell.notifications
  const unread = notification.readAt === null
  const subject = subjectOf(notification, texts)
  // The excerpt of an assignment is the task title, which the line above already shows.
  const showExcerpt = notification.type !== 'task_assigned' && notification.excerpt !== ''

  return (
    <li
      className={`rounded-md border p-3 ${
        unread
          ? 'border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950'
          : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      <p className="text-sm">
        {unread && <span className="sr-only">{texts.unreadPrefix}</span>}
        {texts.sentence[notification.type](
          <span key="actor" className="font-medium">
            {notification.actor?.name ?? t.common.someone}
          </span>,
          <Link
            key="subject"
            to={subject.to}
            onClick={() => onOpen(notification)}
            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {subject.label}
          </Link>,
        )}
      </p>
      {showExcerpt && (
        <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
          {notification.excerpt}
        </p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        {notification.project.name} ·{' '}
        <time dateTime={notification.createdAt}>{formatTimestamp(notification.createdAt)}</time>
      </p>
    </li>
  )
}

/** `/notifications`: what happened to the user's tasks and where they were mentioned. */
export function NotificationsPage() {
  const texts = useT().shell.notifications
  const notifications = useNotifications()
  const markRead = useMarkNotificationsRead()
  const list = notifications.data

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{texts.title}</h1>
        <Button
          variant="secondary"
          disabled={!list || list.unreadCount === 0 || markRead.isPending}
          onClick={() => markRead.mutate(undefined)}
        >
          {texts.markAllRead}
        </Button>
      </div>

      {notifications.isPending && <Spinner />}
      {notifications.isError && <Alert>{errorMessage(notifications.error)}</Alert>}
      {markRead.isError && <Alert>{errorMessage(markRead.error)}</Alert>}
      {list?.items.length === 0 && <p className="text-sm text-slate-500">{texts.empty}</p>}
      {list && list.items.length > 0 && (
        <ul className="space-y-2">
          {list.items.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onOpen={(opened) => {
                if (opened.readAt === null) markRead.mutate([opened.id])
              }}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
