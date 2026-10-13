import { createChecklistItemSchema, type ChecklistItem } from '@chilladesk/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '../../api/client'
import {
  addChecklistItem,
  deleteChecklistItem,
  fetchChecklist,
  updateChecklistItem,
} from '../../api/taskExtras'
import { Alert, Button } from '../../components/ui'
import { useT } from '../../i18n'
import { taskKeys } from './taskQueries'

interface TaskChecklistProps {
  projectId: string
  taskId: string
  canEdit: boolean
}

/** The small steps of a task, ticked off one by one. */
export function TaskChecklist({ projectId, taskId, canEdit }: TaskChecklistProps) {
  const t = useT()
  const texts = t.tasks.checklist
  const queryClient = useQueryClient()
  const queryKey = [...taskKeys.detail(projectId, taskId), 'checklist']
  const checklist = useQuery({ queryKey, queryFn: () => fetchChecklist(projectId, taskId) })
  const [invalid, setInvalid] = useState(false)

  // The progress is part of the task itself, so cards and lists are refreshed as well.
  const refresh = () => queryClient.invalidateQueries({ queryKey: taskKeys.all(projectId) })
  const add = useMutation({
    mutationFn: (text: string) => addChecklistItem(projectId, taskId, text),
    onSuccess: refresh,
  })
  const update = useMutation({
    mutationFn: ({ id, done }: Pick<ChecklistItem, 'id' | 'done'>) =>
      updateChecklistItem(projectId, taskId, id, { done }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (itemId: string) => deleteChecklistItem(projectId, taskId, itemId),
    onSuccess: refresh,
  })
  const error = add.error ?? update.error ?? remove.error

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const parsed = createChecklistItemSchema.safeParse({ text: new FormData(form).get('text') })
    setInvalid(!parsed.success)
    if (!parsed.success) return
    update.reset()
    remove.reset()
    add.mutate(parsed.data.text, { onSuccess: () => form.reset() })
  }

  const items = checklist.data ?? []
  // Nothing to show to someone who can neither read items nor add one.
  if (!canEdit && items.length === 0) return null
  const done = items.filter((item) => item.done).length

  return (
    <section aria-labelledby="task-checklist" className="space-y-2">
      <h3 id="task-checklist" className="text-sm font-semibold">
        {texts.heading}
        {items.length > 0 && (
          <span className="ml-2 font-normal text-slate-500">
            {texts.progress(done, items.length)}
          </span>
        )}
      </h3>
      {error && <Alert>{errorMessage(error)}</Alert>}
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-sm">
              <label className="flex min-w-0 flex-1 items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={item.done}
                  disabled={!canEdit}
                  onChange={(event) => update.mutate({ id: item.id, done: event.target.checked })}
                />
                <span className={item.done ? 'text-slate-500 line-through' : ''}>{item.text}</span>
              </label>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove.mutate(item.id)}
                  aria-label={texts.removeItem(item.text)}
                  className="text-xs text-slate-500 hover:text-red-600 hover:underline"
                >
                  {t.common.delete}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={handleAdd} className="flex flex-wrap items-start gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="checklist-new" className="sr-only">
              {texts.newItem}
            </label>
            <input
              id="checklist-new"
              name="text"
              placeholder={texts.newItem}
              aria-invalid={invalid ? true : undefined}
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={add.isPending}>
            {t.common.add}
          </Button>
        </form>
      )}
    </section>
  )
}
