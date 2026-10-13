import type { TaskChange } from '@chilladesk/shared'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { errorMessage } from '../../api/client'
import { fetchTaskHistory } from '../../api/tasks'
import { Alert, Spinner } from '../../components/ui'
import { intlLocale, useT, type Messages } from '../../i18n'
import { formatDueDate } from './taskDisplay'
import { taskKeys } from './taskQueries'

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' })
}

/** One history entry as a sentence in the language of the interface. */
function describeChange(change: TaskChange, t: Messages): string {
  const texts = t.tasks.history
  switch (change.field) {
    case 'created':
      return texts.created
    case 'title':
      return texts.title(change.from, change.to)
    case 'description':
      return texts.description
    case 'status':
      return texts.status(change.from, change.to)
    case 'priority':
      return texts.priority(t.common.priority[change.from], t.common.priority[change.to])
    case 'assignee':
      return texts.assignee(change.from, change.to)
    case 'dueDate':
      return texts.dueDate(
        change.from === null ? null : formatDueDate(change.from),
        change.to === null ? null : formatDueDate(change.to),
      )
    case 'milestone':
      return texts.milestone(change.from, change.to)
    case 'labels':
      return texts.labels(change.added, change.removed)
  }
}

interface TaskHistoryProps {
  projectId: string
  taskId: string
}

/** Who changed what on a task, and when. Loaded when the section is opened. */
export function TaskHistory({ projectId, taskId }: TaskHistoryProps) {
  const t = useT()
  const texts = t.tasks.history
  const [open, setOpen] = useState(false)
  const history = useQuery({
    queryKey: [...taskKeys.detail(projectId, taskId), 'history'],
    queryFn: () => fetchTaskHistory(projectId, taskId),
    enabled: open,
  })

  return (
    <section className="text-sm">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="text-sm font-semibold hover:underline"
      >
        {open ? '▾' : '▸'} {texts.heading}
      </button>
      {open && (
        <div className="mt-3">
          {history.isPending && <Spinner />}
          {history.isError && <Alert>{errorMessage(history.error)}</Alert>}
          {history.data && (
            <ol aria-label={texts.heading} className="space-y-2">
              {history.data.map((event) => (
                <li
                  key={event.id}
                  className="border-l-2 border-slate-200 pl-3 dark:border-slate-700"
                >
                  <p>{describeChange(event.change, t)}</p>
                  <p className="text-xs text-slate-500">
                    {event.actor?.name ?? t.common.deletedUser} ·{' '}
                    <time dateTime={event.createdAt}>{formatTimestamp(event.createdAt)}</time>
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}
