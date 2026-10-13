import {
  createStatusRequestSchema,
  statusCategorySchema,
  type Status,
  type StatusCategory,
} from '@chilladesk/shared'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '../../api/client'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../../components/form'
import { Alert, Button, Card, selectClass, Spinner, TextField } from '../../components/ui'
import { useT } from '../../i18n'
import { useStatusMutations, useStatuses } from './taskQueries'

function CategoryOptions() {
  const t = useT()
  return statusCategorySchema.options.map((category) => (
    <option key={category} value={category}>
      {t.project.columns.category[category]}
    </option>
  ))
}

/** Returns the ids with the item at `index` swapped with its neighbour in `direction`. */
function swapped(statuses: Status[], index: number, direction: -1 | 1): string[] {
  const ids = statuses.map((status) => status.id)
  const neighbour = index + direction
  return ids.map((id, position) =>
    position === index ? (ids[neighbour] ?? id) : position === neighbour ? (ids[index] ?? id) : id,
  )
}

/** Owner-only: the columns of the board. */
export function StatusSettings({ projectId }: { projectId: string }) {
  const t = useT()
  const statuses = useStatuses(projectId)
  const { create, update, reorder, remove } = useStatusMutations(projectId)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const mutations = [create, update, reorder, remove]
  const actionError = mutations.find((mutation) => mutation.error)?.error
  // A rename saves on blur; if that disabled the buttons, the click that caused the blur
  // would be lost. Only changes to the set or order of columns block each other.
  const busy = [create, reorder, remove].some((mutation) => mutation.isPending)

  // Each action starts clean, so the alert always belongs to the latest one.
  const clearErrors = () => mutations.forEach((mutation) => mutation.reset())

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const parsed = parseForm(createStatusRequestSchema, {
      name: String(form.get('name') ?? ''),
      category: form.get('category'),
    })
    clearErrors()
    if (!parsed.ok) {
      setFieldErrors(parsed.errors)
      focusFirstInvalid(formElement, parsed.errors)
      return
    }
    setFieldErrors({})
    create.mutate(parsed.data, { onSuccess: () => formElement.reset() })
  }

  const handleRename = (status: Status, input: HTMLInputElement) => {
    const trimmed = input.value.trim()
    if (!trimmed) {
      // A column needs a name; put the saved one back instead of leaving the field blank.
      input.value = status.name
      return
    }
    if (trimmed === status.name) return
    clearErrors()
    update.mutate({ statusId: status.id, patch: { name: trimmed } })
  }

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">{t.project.columns.heading}</h2>
      <p className="mb-4 text-sm text-slate-500">{t.project.columns.hint}</p>
      {actionError && (
        <div className="mb-4">
          <Alert>{errorMessage(actionError)}</Alert>
        </div>
      )}
      {statuses.isPending && <Spinner />}
      {statuses.isError && <Alert>{errorMessage(statuses.error)}</Alert>}
      {statuses.isSuccess && (
        <ol className="divide-y divide-slate-200 dark:divide-slate-800">
          {statuses.data.map((status, index) => (
            <li key={status.id} className="flex flex-wrap items-center gap-2 py-2">
              <input
                // Remount when the saved name changes so the field shows the server's value.
                key={status.name}
                defaultValue={status.name}
                maxLength={40}
                aria-label={t.project.columns.nameOf(index + 1)}
                onBlur={(event) => handleRename(status, event.target)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
                className="min-w-32 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900"
              />
              <select
                aria-label={t.project.columns.kindOf(status.name)}
                className={selectClass}
                value={status.category}
                disabled={update.isPending}
                onChange={(event) => {
                  clearErrors()
                  update.mutate({
                    statusId: status.id,
                    patch: { category: event.target.value as StatusCategory },
                  })
                }}
              >
                <CategoryOptions />
              </select>
              <Button
                variant="secondary"
                aria-label={t.project.columns.moveLeft(status.name)}
                disabled={busy || index === 0}
                onClick={() => {
                  clearErrors()
                  reorder.mutate(swapped(statuses.data, index, -1))
                }}
              >
                ←
              </Button>
              <Button
                variant="secondary"
                aria-label={t.project.columns.moveRight(status.name)}
                disabled={busy || index === statuses.data.length - 1}
                onClick={() => {
                  clearErrors()
                  reorder.mutate(swapped(statuses.data, index, 1))
                }}
              >
                →
              </Button>
              <Button
                variant="secondary"
                aria-label={t.project.columns.deleteColumn(status.name)}
                disabled={busy || statuses.data.length === 1}
                onClick={() => {
                  clearErrors()
                  remove.mutate(status.id)
                }}
              >
                {t.common.delete}
              </Button>
            </li>
          ))}
        </ol>
      )}

      <form
        onSubmit={handleAdd}
        noValidate
        className="mt-4 flex flex-wrap items-start gap-3 border-t border-slate-200 pt-4 dark:border-slate-800"
      >
        <TextField
          label={t.project.columns.newColumn}
          name="name"
          maxLength={40}
          required
          error={fieldErrors.name}
          className="min-w-48 flex-1"
        />
        <div>
          <label htmlFor="new-status-category" className="mb-1 block text-sm font-medium">
            {t.project.columns.kind}
          </label>
          <select
            id="new-status-category"
            name="category"
            defaultValue="todo"
            className={`${selectClass} py-2`}
          >
            <CategoryOptions />
          </select>
        </div>
        <Button type="submit" className="mt-6" disabled={create.isPending}>
          {t.project.columns.add}
        </Button>
      </form>
    </Card>
  )
}
