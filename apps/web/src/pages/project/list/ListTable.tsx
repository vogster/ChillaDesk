import type { Status, Task, TaskSort } from '@chilladesk/shared'
import { Link } from 'react-router'
import { useT } from '../../../i18n'
import { useTaskLink } from '../board/TaskCard'
import { LabelList } from '../labels/LabelChip'
import { DueDate, PriorityBadge } from '../taskDisplay'
import type { ListState } from './listState'

function TaskTitleLink({ taskId, title }: { taskId: string; title: string }) {
  return (
    <Link to={useTaskLink(taskId)} className="font-medium hover:underline">
      {title}
    </Link>
  )
}

interface ColumnHeadingProps {
  label: string
  /** What a click sorts by; a column without it cannot be sorted. */
  sort?: TaskSort
  state: ListState
  onSort: (sort: TaskSort) => void
}

function ColumnHeading({ label, sort, state, onSort }: ColumnHeadingProps) {
  const texts = useT().tasks.list
  const active = sort !== undefined && state.sort === sort
  const direction = state.order === 'asc' ? 'ascending' : 'descending'

  return (
    <th scope="col" aria-sort={active ? direction : undefined} className="px-3 py-2">
      {sort === undefined ? (
        label
      ) : (
        <button
          type="button"
          onClick={() => onSort(sort)}
          title={texts.sortBy(label)}
          className="inline-flex items-center gap-1 uppercase hover:underline"
        >
          {label}
          <span aria-hidden="true">{active ? (state.order === 'asc' ? '▲' : '▼') : ''}</span>
        </button>
      )}
    </th>
  )
}

interface ListTableProps {
  tasks: Task[]
  statuses: Status[] | undefined
  state: ListState
  onSort: (sort: TaskSort) => void
  /** Absent for someone who cannot change tasks: then there is nothing to select. */
  selection?: { selected: Set<string>; onToggle: (taskId: string) => void; onToggleAll: () => void }
}

/** The task list as a table, with headings that sort and rows that can be ticked. */
export function ListTable({ tasks, statuses, state, onSort, selection }: ListTableProps) {
  const text = useT().tasks.list
  const statusById = new Map((statuses ?? []).map((status) => [status.id, status]))
  const allSelected = tasks.length > 0 && tasks.every((task) => selection?.selected.has(task.id))
  const heading = { state, onSort }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead className="bg-slate-100 text-xs text-slate-600 uppercase dark:bg-slate-800 dark:text-slate-300">
          <tr>
            {selection && (
              <th scope="col" className="w-8 px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={text.selectAll}
                  checked={allSelected}
                  onChange={selection.onToggleAll}
                />
              </th>
            )}
            <ColumnHeading label={text.columns.key} sort="number" {...heading} />
            <ColumnHeading label={text.columns.title} sort="title" {...heading} />
            <ColumnHeading label={text.columns.status} sort="board" {...heading} />
            <ColumnHeading label={text.columns.priority} sort="priority" {...heading} />
            <ColumnHeading label={text.columns.assignee} {...heading} />
            <ColumnHeading label={text.columns.due} sort="due" {...heading} />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
          {tasks.map((task) => {
            const status = statusById.get(task.statusId)
            return (
              <tr key={task.id}>
                {selection && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label={text.selectTask(task.key)}
                      checked={selection.selected.has(task.id)}
                      onChange={() => selection.onToggle(task.id)}
                    />
                  </td>
                )}
                <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-slate-500">
                  {task.key}
                </td>
                <td className="px-3 py-2">
                  <TaskTitleLink taskId={task.id} title={task.title} />
                  {task.labels.length > 0 && (
                    <div className="mt-1">
                      <LabelList labels={task.labels} />
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{status?.name}</td>
                <td className="px-3 py-2">
                  <PriorityBadge priority={task.priority} />
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {task.assignee?.name ?? <span className="text-slate-400">—</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <DueDate task={task} status={status} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
