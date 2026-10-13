import type { Status, Task, TaskPriority, UserSummary } from '@chilladesk/shared'
import { currentMessages, intlLocale, useT } from '../../i18n'

/** The name of a priority in the current language, for code outside components. */
export const priorityLabel = (priority: TaskPriority): string =>
  currentMessages().common.priority[priority]

/** Priority names in the current language; components read `t.common.priority` instead. */
export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  get low() {
    return priorityLabel('low')
  },
  get medium() {
    return priorityLabel('medium')
  },
  get high() {
    return priorityLabel('high')
  },
  get urgent() {
    return priorityLabel('urgent')
  },
}

const PRIORITY_STYLES: Record<TaskPriority, string> = {
  low: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  medium: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  high: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  urgent: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200',
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const t = useT()
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${PRIORITY_STYLES[priority]}`}>
      {t.common.priority[priority]}
    </span>
  )
}

/** `YYYY-MM-DD` of the local calendar day. */
export function todayIso(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** A task is overdue when its date has passed and it is not in a "done" column. */
export function isOverdue(task: Task, status: Status | undefined, today = todayIso()): boolean {
  return task.dueDate !== null && task.dueDate < today && status?.category !== 'done'
}

// Parsed as a local date: `new Date('2026-12-31')` would be UTC midnight and can show the day before.
export function formatDueDate(dueDate: string): string {
  const [year, month, day] = dueDate.split('-').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString(intlLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function DueDate({ task, status }: { task: Task; status: Status | undefined }) {
  const t = useT()
  if (!task.dueDate) return null
  const overdue = isOverdue(task, status)
  return (
    <span
      className={`text-xs ${overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-slate-500'}`}
    >
      {overdue && <span className="sr-only">{t.tasks.display.overdue}</span>}
      {formatDueDate(task.dueDate)}
    </span>
  )
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/)
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')).toUpperCase()
}

export function Avatar({ user }: { user: UserSummary }) {
  const t = useT()
  return (
    <span
      title={user.name}
      aria-label={t.tasks.display.assignedTo(user.name)}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-[0.65rem] font-semibold text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100"
    >
      {initials(user.name)}
    </span>
  )
}
