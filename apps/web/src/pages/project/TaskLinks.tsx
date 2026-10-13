import { taskRelationSchema, type TaskLink, type TaskRelation } from '@chilladesk/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { errorMessage } from '../../api/client'
import { addTaskLink, fetchTaskLinks, removeTaskLink } from '../../api/taskExtras'
import { Alert, Button, selectClass } from '../../components/ui'
import { useT } from '../../i18n'
import { TASK_PARAM } from './ProjectLayout'
import { taskKeys } from './taskQueries'

const RELATIONS = taskRelationSchema.options

/** `12` from "12", "#12" or "CHL-12"; null for anything else. */
export function parseTaskNumber(input: string, projectKey: string): number | null {
  const match = new RegExp(`^(?:${projectKey}-|#)?([1-9]\\d{0,8})$`, 'i').exec(input.trim())
  return match?.[1] ? Number(match[1]) : null
}

interface TaskLinksProps {
  projectId: string
  projectKey: string
  taskId: string
  canEdit: boolean
}

/** How a task hangs together with others: what blocks it, what it is part of. */
export function TaskLinks({ projectId, projectKey, taskId, canEdit }: TaskLinksProps) {
  const t = useT()
  const texts = t.tasks.links
  const queryClient = useQueryClient()
  const queryKey = [...taskKeys.detail(projectId, taskId), 'links']
  const links = useQuery({ queryKey, queryFn: () => fetchTaskLinks(projectId, taskId) })
  const [invalid, setInvalid] = useState(false)

  const add = useMutation({
    mutationFn: (input: { relation: TaskRelation; taskNumber: number }) =>
      addTaskLink(projectId, taskId, input),
    // The other task shows the same link from its side; drop whatever is cached of it.
    onSuccess: (result) => {
      queryClient.setQueryData<TaskLink[]>(queryKey, result)
      return queryClient.invalidateQueries({ queryKey: taskKeys.all(projectId) })
    },
  })
  const remove = useMutation({
    mutationFn: (linkId: string) => removeTaskLink(projectId, taskId, linkId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.all(projectId) }),
  })
  const error = add.error ?? remove.error

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const relation = taskRelationSchema.safeParse(values.get('relation'))
    const taskNumber = parseTaskNumber(String(values.get('task') ?? ''), projectKey)
    setInvalid(taskNumber === null)
    if (!relation.success || taskNumber === null) return
    remove.reset()
    add.mutate({ relation: relation.data, taskNumber }, { onSuccess: () => form.reset() })
  }

  const items = links.data ?? []
  if (!canEdit && items.length === 0) return null

  return (
    <section aria-labelledby="task-links" className="space-y-2">
      <h3 id="task-links" className="text-sm font-semibold">
        {texts.heading}
      </h3>
      {error && <Alert>{errorMessage(error)}</Alert>}
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((link) => (
            <li key={link.id} className="flex flex-wrap items-baseline gap-2 text-sm">
              <span className="text-slate-500">{texts.relation[link.relation]}</span>
              <Link
                to={`/projects/${projectId}?${new URLSearchParams({ [TASK_PARAM]: link.task.id })}`}
                className={`min-w-0 text-indigo-600 hover:underline dark:text-indigo-400 ${
                  link.task.done ? 'line-through' : ''
                }`}
              >
                <span className="font-mono text-xs">{link.task.key}</span> {link.task.title}
              </Link>
              {link.task.done && <span className="sr-only">{texts.done}</span>}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove.mutate(link.id)}
                  aria-label={texts.removeLink(link.task.key)}
                  className="ml-auto text-xs text-slate-500 hover:text-red-600 hover:underline"
                >
                  {t.common.delete}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
          <div>
            <label htmlFor="link-relation" className="sr-only">
              {texts.relationLabel}
            </label>
            <select id="link-relation" name="relation" className={selectClass}>
              {RELATIONS.map((relation) => (
                <option key={relation} value={relation}>
                  {texts.relation[relation]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="link-task" className="sr-only">
              {texts.taskLabel}
            </label>
            <input
              id="link-task"
              name="task"
              placeholder={`${projectKey}-12`}
              aria-invalid={invalid ? true : undefined}
              aria-describedby={invalid ? 'link-task-error' : undefined}
              className="block w-32 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={add.isPending}>
            {texts.add}
          </Button>
          {invalid && (
            <p id="link-task-error" className="w-full text-xs text-red-600 dark:text-red-400">
              {texts.invalidTask(projectKey)}
            </p>
          )}
        </form>
      )}
    </section>
  )
}
