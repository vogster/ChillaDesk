import { createLabelRequestSchema, type Label, type Task } from '@chillawiki/shared'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '../../../api/client'
import { Alert, Button, selectClass } from '../../../components/ui'
import { ColorOptions, LabelChip, LabelList } from './LabelChip'
import { useLabelMutations, useLabels } from './labelQueries'

interface TaskLabelsProps {
  projectId: string
  task: Task
  canEdit: boolean
  /** Saves the complete new set of labels of the task. */
  onChange: (labelIds: string[]) => void
}

/** The labels of a task in its dialog, with a picker for those who may change them. */
export function TaskLabels({ projectId, task, canEdit, onChange }: TaskLabelsProps) {
  const labels = useLabels(projectId)
  const { create } = useLabelMutations(projectId)
  const [picking, setPicking] = useState(false)
  const [nameError, setNameError] = useState<string>()
  const selected = new Set(task.labels.map((label) => label.id))

  const toggle = (label: Label) =>
    onChange(
      selected.has(label.id)
        ? task.labels.filter((item) => item.id !== label.id).map((item) => item.id)
        : [...selected, label.id],
    )

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    // The dialog's own forms must not see this submit.
    event.stopPropagation()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const parsed = createLabelRequestSchema.safeParse({
      name: String(form.get('label-name') ?? ''),
      color: form.get('label-color'),
    })
    setNameError(parsed.success ? undefined : (parsed.error.issues[0]?.message ?? 'Invalid name'))
    if (!parsed.success) return
    create.mutate(parsed.data, {
      // A label made from a task is meant for that task.
      onSuccess: (label) => {
        formElement.reset()
        onChange([...selected, label.id])
      },
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {task.labels.length > 0 ? (
          <LabelList labels={task.labels} />
        ) : (
          <span className="text-sm text-slate-500">No labels</span>
        )}
        {canEdit && (
          <button
            type="button"
            aria-expanded={picking}
            onClick={() => setPicking(!picking)}
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {picking ? 'Done' : 'Edit labels'}
          </button>
        )}
      </div>

      {picking && (
        <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
          {labels.isError && <Alert>{errorMessage(labels.error)}</Alert>}
          {labels.isSuccess && labels.data.length === 0 && (
            <p className="text-sm text-slate-500">This project has no labels yet.</p>
          )}
          {labels.isSuccess && labels.data.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {labels.data.map((label) => (
                <li key={label.id}>
                  <label className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(label.id)}
                      onChange={() => toggle(label)}
                      aria-label={label.name}
                    />
                    <LabelChip label={label} />
                  </label>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={handleCreate} noValidate className="flex flex-wrap items-start gap-2">
            {create.isError && (
              <div className="w-full">
                <Alert>{errorMessage(create.error)}</Alert>
              </div>
            )}
            <div className="min-w-40 flex-1">
              <label htmlFor="new-label-name" className="sr-only">
                New label
              </label>
              <input
                id="new-label-name"
                name="label-name"
                maxLength={40}
                placeholder="New label"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? 'new-label-error' : undefined}
                className="block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900"
              />
              {nameError && (
                <p id="new-label-error" className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {nameError}
                </p>
              )}
            </div>
            <label htmlFor="new-label-color" className="sr-only">
              Colour of the new label
            </label>
            <select
              id="new-label-color"
              name="label-color"
              defaultValue="gray"
              className={selectClass}
            >
              <ColorOptions />
            </select>
            <Button type="submit" variant="secondary" disabled={create.isPending}>
              Create label
            </Button>
          </form>
        </div>
      )}
    </div>
  )
}
