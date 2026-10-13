import { createSavedFilterSchema } from '@chilladesk/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '../../../api/client'
import { createSavedFilter, deleteSavedFilter, fetchSavedFilters } from '../../../api/taskExtras'
import { Alert, Button, selectClass } from '../../../components/ui'
import { useT } from '../../../i18n'

interface SavedFiltersProps {
  projectId: string
  /** The filters and order on screen, as a query string. */
  currentQuery: string
  onApply: (query: string) => void
}

/** A person's own named filters of the list: pick one, save the current one, delete one. */
export function SavedFilters({ projectId, currentQuery, onApply }: SavedFiltersProps) {
  const text = useT().tasks.list.saved
  const queryClient = useQueryClient()
  const queryKey = ['projects', projectId, 'filters']
  const filters = useQuery({ queryKey, queryFn: () => fetchSavedFilters(projectId) })
  const [naming, setNaming] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey })
  const save = useMutation({
    mutationFn: (name: string) => createSavedFilter(projectId, { name, query: currentQuery }),
    onSuccess: async () => {
      await refresh()
      setNaming(false)
    },
  })
  const remove = useMutation({
    mutationFn: (filterId: string) => deleteSavedFilter(projectId, filterId),
    onSuccess: refresh,
  })

  const saved = filters.data ?? []
  // The one on screen right now, if what is on screen was saved before.
  const current = saved.find((filter) => filter.query === currentQuery)
  const error = save.error ?? remove.error

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = createSavedFilterSchema.safeParse({
      name: new FormData(event.currentTarget).get('name'),
      query: currentQuery,
    })
    setInvalid(!parsed.success)
    if (!parsed.success) return
    remove.reset()
    save.mutate(parsed.data.name)
  }

  return (
    <div className="space-y-2">
      {error && <Alert>{errorMessage(error)}</Alert>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {saved.length > 0 && (
          <select
            aria-label={text.label}
            className={selectClass}
            value={current?.id ?? ''}
            onChange={(event) => {
              const chosen = saved.find((filter) => filter.id === event.target.value)
              if (chosen) onApply(chosen.query)
            }}
          >
            <option value="">{text.choose}</option>
            {saved.map((filter) => (
              <option key={filter.id} value={filter.id}>
                {filter.name}
              </option>
            ))}
          </select>
        )}
        {current ? (
          <button
            type="button"
            disabled={remove.isPending}
            onClick={() => remove.mutate(current.id)}
            className="text-xs text-slate-500 hover:text-red-600 hover:underline"
          >
            {text.delete(current.name)}
          </button>
        ) : (
          currentQuery !== '' &&
          !naming && (
            <Button variant="secondary" onClick={() => setNaming(true)}>
              {text.save}
            </Button>
          )
        )}
        {naming && !current && (
          <form onSubmit={handleSave} className="flex flex-wrap items-center gap-2">
            <label htmlFor="filter-name" className="sr-only">
              {text.name}
            </label>
            <input
              id="filter-name"
              name="name"
              autoFocus
              maxLength={60}
              placeholder={text.name}
              aria-invalid={invalid ? true : undefined}
              className="block w-48 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900"
            />
            <Button type="submit" disabled={save.isPending}>
              {text.save}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setNaming(false)
                setInvalid(false)
                save.reset()
              }}
            >
              {text.cancel}
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}
