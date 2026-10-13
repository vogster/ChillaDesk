import {
  taskPrioritySchema,
  type Label,
  type ProjectMember,
  type Status,
  type TaskPriority,
} from '@chilladesk/shared'
import { useEffect, useState } from 'react'
import { selectClass } from '../../../components/ui'
import { useDebounce } from '../../../hooks/useDebounce'
import { useT } from '../../../i18n'
import type { ListState } from './listState'

const SEARCH_DELAY_MS = 300

interface ListFiltersProps {
  state: ListState
  onChange: (patch: Partial<ListState>) => void
  statuses: Status[] | undefined
  members: ProjectMember[] | undefined
  labels: Label[] | undefined
}

/** The controls that narrow the task list down. */
export function ListFilters({ state, onChange, statuses, members, labels }: ListFiltersProps) {
  const t = useT()
  const text = t.tasks.list
  // Typing stays local and reaches the address (and the server) once it pauses.
  const [search, setSearch] = useState(state.q)
  const debounced = useDebounce(search.trim(), SEARCH_DELAY_MS)
  // A saved filter or the back button changed the search from outside: the field follows.
  const [syncedQ, setSyncedQ] = useState(state.q)
  if (state.q !== syncedQ) {
    setSyncedQ(state.q)
    if (state.q !== search.trim()) setSearch(state.q)
  }

  useEffect(() => {
    // Only what was typed here and has settled; not a value the address has just set.
    if (debounced !== state.q && debounced === search.trim()) onChange({ q: debounced })
  }, [debounced, state.q, search, onChange])

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="min-w-48 flex-1">
        <label htmlFor="task-search" className="mb-1 block text-sm font-medium">
          {text.search}
        </label>
        <input
          id="task-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={text.searchPlaceholder}
          className="block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900"
        />
      </div>
      <label className="text-sm font-medium">
        <span className="mb-1 block">{text.status}</span>
        <select
          className={selectClass}
          value={state.statusId}
          onChange={(event) => onChange({ statusId: event.target.value })}
        >
          <option value="">{text.anyStatus}</option>
          {statuses?.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium">
        <span className="mb-1 block">{text.assignee}</span>
        <select
          className={selectClass}
          value={state.assigneeId}
          onChange={(event) => onChange({ assigneeId: event.target.value })}
        >
          <option value="">{text.anyone}</option>
          <option value="none">{text.unassigned}</option>
          {members?.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium">
        <span className="mb-1 block">{text.priority}</span>
        <select
          className={selectClass}
          value={state.priority}
          onChange={(event) => onChange({ priority: event.target.value as TaskPriority | '' })}
        >
          <option value="">{text.anyPriority}</option>
          {taskPrioritySchema.options.map((option) => (
            <option key={option} value={option}>
              {t.common.priority[option]}
            </option>
          ))}
        </select>
      </label>
      {labels && labels.length > 0 && (
        <label className="text-sm font-medium">
          <span className="mb-1 block">{text.label}</span>
          <select
            className={selectClass}
            value={state.labelId}
            onChange={(event) => onChange({ labelId: event.target.value })}
          >
            <option value="">{text.anyLabel}</option>
            {labels.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  )
}
