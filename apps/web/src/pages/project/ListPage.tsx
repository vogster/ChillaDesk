import type { TaskSort } from '@chilladesk/shared'
import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router'
import { errorMessage } from '../../api/client'
import { Alert, Spinner } from '../../components/ui'
import { useT } from '../../i18n'
import { useLabels } from './labels/labelQueries'
import { BulkBar } from './list/BulkBar'
import { ListFilters } from './list/ListFilters'
import {
  isFiltered,
  listQuery,
  parseListState,
  sortedBy,
  toTaskFilters,
  withListState,
  type ListState,
} from './list/listState'
import { ListTable } from './list/ListTable'
import { SavedFilters } from './list/SavedFilters'
import { useProjectContext } from './ProjectLayout'
import { useMembers } from './projectQueries'
import { useStatuses, useTasks } from './taskQueries'

export function ListPage() {
  const text = useT().tasks.list
  const { project, canEdit } = useProjectContext()
  const [searchParams, setSearchParams] = useSearchParams()
  const state = parseListState(searchParams)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // The filters live in the address: a filtered list can be bookmarked and sent to someone.
  const change = useCallback(
    (patch: Partial<ListState>) =>
      setSearchParams((params) => withListState(params, { ...parseListState(params), ...patch }), {
        replace: true,
      }),
    [setSearchParams],
  )
  const apply = (query: string) =>
    setSearchParams((params) => withListState(params, parseListState(new URLSearchParams(query))))

  const statuses = useStatuses(project.id)
  const members = useMembers(project.id)
  const labels = useLabels(project.id)
  const tasks = useTasks(project.id, toTaskFilters(state))
  const items = tasks.data?.items ?? []
  // Only what is on screen can be acted on: a task filtered away is not silently included.
  const selectedIds = items.filter((task) => selected.has(task.id)).map((task) => task.id)

  const toggle = (taskId: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(taskId)) next.add(taskId)
      return next
    })
  const toggleAll = () =>
    setSelected(
      selectedIds.length === items.length ? new Set() : new Set(items.map((task) => task.id)),
    )

  return (
    <div className="space-y-4">
      <ListFilters
        state={state}
        onChange={change}
        statuses={statuses.data}
        members={members.data}
        labels={labels.data}
      />
      <SavedFilters projectId={project.id} currentQuery={listQuery(state)} onApply={apply} />

      {tasks.isPending && <Spinner />}
      {tasks.isError && <Alert>{errorMessage(tasks.error)}</Alert>}
      {tasks.isSuccess && items.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">
          {isFiltered(state) ? text.noMatches : text.empty}
        </p>
      )}
      {tasks.isSuccess && items.length > 0 && (
        <>
          {selectedIds.length > 0 ? (
            <BulkBar
              projectId={project.id}
              taskIds={selectedIds}
              statuses={statuses.data}
              members={members.data}
              onDone={() => setSelected(new Set())}
            />
          ) : (
            <p role="status" className="text-sm text-slate-500">
              {tasks.data.total === items.length
                ? text.count(tasks.data.total)
                : text.showing(items.length, tasks.data.total)}
            </p>
          )}
          <ListTable
            tasks={items}
            statuses={statuses.data}
            state={state}
            onSort={(sort: TaskSort) => change(sortedBy(state, sort))}
            {...(canEdit
              ? { selection: { selected, onToggle: toggle, onToggleAll: toggleAll } }
              : {})}
          />
        </>
      )}
    </div>
  )
}
