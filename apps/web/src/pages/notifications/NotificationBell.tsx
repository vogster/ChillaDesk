import { NavLink } from 'react-router'
import { useT } from '../../i18n'
import { useNotifications } from './notificationQueries'

/** The header link to the notifications, with the number still unread. */
export function NotificationBell() {
  const texts = useT().shell.notifications
  const unread = useNotifications().data?.unreadCount ?? 0

  return (
    <NavLink
      to="/notifications"
      aria-label={texts.bellLabel(unread)}
      title={texts.title}
      className={({ isActive }) =>
        `relative rounded-md p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 ${
          isActive ? 'text-slate-900 dark:text-slate-100' : 'text-slate-600 dark:text-slate-400'
        }`
      }
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </svg>
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -right-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 font-semibold text-white"
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </NavLink>
  )
}
