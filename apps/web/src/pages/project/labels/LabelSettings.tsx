import { createLabelRequestSchema, type Label, type LabelColor } from '@chillawiki/shared'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '../../../api/client'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../../../components/form'
import { Alert, Button, Card, selectClass, Spinner, TextField } from '../../../components/ui'
import { ColorOptions, LabelChip } from './LabelChip'
import { useLabelMutations, useLabels } from './labelQueries'

/** Owner settings: the labels tasks of this project can carry. */
export function LabelSettings({ projectId }: { projectId: string }) {
  const labels = useLabels(projectId)
  const { create, update, remove } = useLabelMutations(projectId)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const mutations = [create, update, remove]
  const actionError = mutations.find((mutation) => mutation.error)?.error

  // Each action starts clean, so the alert always belongs to the latest one.
  const clearErrors = () => mutations.forEach((mutation) => mutation.reset())

  const handleAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const parsed = parseForm(createLabelRequestSchema, {
      name: String(form.get('name') ?? ''),
      color: form.get('color'),
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

  const handleRename = (label: Label, input: HTMLInputElement) => {
    const name = input.value.trim()
    if (!name) {
      // A label needs a name; put the saved one back instead of leaving the field blank.
      input.value = label.name
      return
    }
    if (name === label.name) return
    clearErrors()
    update.mutate({ labelId: label.id, patch: { name } })
  }

  return (
    <Card>
      <h2 className="mb-1 text-base font-semibold">Labels</h2>
      <p className="mb-4 text-sm text-slate-500">
        Deleting a label takes it off every task that has it.
      </p>
      {actionError && (
        <div className="mb-4">
          <Alert>{errorMessage(actionError)}</Alert>
        </div>
      )}
      {labels.isPending && <Spinner />}
      {labels.isError && <Alert>{errorMessage(labels.error)}</Alert>}
      {labels.isSuccess && labels.data.length === 0 && (
        <p className="text-sm text-slate-500">No labels yet.</p>
      )}
      {labels.isSuccess && labels.data.length > 0 && (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {labels.data.map((label) => (
            <li key={label.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="w-28 shrink-0">
                <LabelChip label={label} />
              </span>
              <input
                // Remount when the saved name changes so the field shows the server's value.
                key={label.name}
                defaultValue={label.name}
                maxLength={40}
                aria-label={`Name of label ${label.name}`}
                onBlur={(event) => handleRename(label, event.target)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
                className="min-w-32 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900"
              />
              <select
                aria-label={`Colour of ${label.name}`}
                className={selectClass}
                value={label.color}
                onChange={(event) => {
                  clearErrors()
                  update.mutate({
                    labelId: label.id,
                    patch: { color: event.target.value as LabelColor },
                  })
                }}
              >
                <ColorOptions />
              </select>
              <Button
                variant="secondary"
                aria-label={`Delete label ${label.name}`}
                disabled={remove.isPending}
                onClick={() => {
                  clearErrors()
                  remove.mutate(label.id)
                }}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={handleAdd}
        noValidate
        className="mt-4 flex flex-wrap items-start gap-3 border-t border-slate-200 pt-4 dark:border-slate-800"
      >
        <TextField
          label="New label"
          name="name"
          maxLength={40}
          required
          error={fieldErrors.name}
          className="min-w-48 flex-1"
        />
        <div>
          <label htmlFor="settings-label-color" className="mb-1 block text-sm font-medium">
            Colour
          </label>
          <select
            id="settings-label-color"
            name="color"
            defaultValue="gray"
            className={`${selectClass} py-2`}
          >
            <ColorOptions />
          </select>
        </div>
        <Button type="submit" className="mt-6" disabled={create.isPending}>
          Add label
        </Button>
      </form>
    </Card>
  )
}
