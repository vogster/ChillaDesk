import { taskPrioritySchema, type TaskPriority } from '@chilladesk/shared'
import { useState } from 'react'
import { Link } from 'react-router'
import { errorMessage } from '../../api/client'
import type { TaskFilters } from '../../api/tasks'
import { Alert, selectClass, Spinner } from '../../components/ui'
import { useDebounce } from '../../hooks/useDebounce'
import { useT } from '../../i18n'
import { useTaskLink } from './board/TaskCard'
import { LabelList } from './labels/LabelChip'
import { useLabels } from './labels/labelQueries'
import { useProjectContext } from './ProjectLayout'
import { useMembers } from './projectQueries'
import { DueDate, PriorityBadge } from './taskDisplay'
import { useStatuses, useTasks } from './taskQueries'

const SEARCH_DELAY_MS = 300

function TaskTitleLink({ taskId, title }: { taskId: string; title: string }) {
  return (
    <Link to={useTaskLink(taskId)} className="font-medium hover:underline">
      {title}
    </Link>
  )
}

export function ListPage() {
  const t = useT()
  const text = t.tasks.list
  const { project } = useProjectContext()
  const [search, setSearch] = useState('')
  const [statusId, setStatusId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [priority, setPriority] = useState<TaskPriority | ''>('')
  const [labelId, setLabelId] = useState('')
  const debouncedSearch = useDebounce(search.trim(), SEARCH_DELAY_MS)

  const filters: TaskFilters = {
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(statusId ? { statusId } : {}),
    ...(assigneeId ? { assigneeId } : {}),
    ...(priority ? { priority } : {}),
    ...(labelId ? { labelId } : {}),
  }
  const statuses = useStatuses(project.id)
  const members = useMembers(project.id)
  const labels = useLabels(project.id)
  const tasks = useTasks(project.id, filters)
  const filtered = Object.keys(filters).length > 0
  const statusById = new Map((statuses.data ?? []).map((status) => [status.id, status]))

  return (
    <div className="space-y-4">
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
            value={statusId}
            onChange={(event) => setStatusId(event.target.value)}
          >
            <option value="">{text.anyStatus}</option>
            {statuses.data?.map((status) => (
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
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
          >
            <option value="">{text.anyone}</option>
            <option value="none">{text.unassigned}</option>
            {members.data?.map((member) => (
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
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority | '')}
          >
            <option value="">{text.anyPriority}</option>
            {taskPrioritySchema.options.map((option) => (
              <option key={option} value={option}>
                {t.common.priority[option]}
              </option>
            ))}
          </select>
        </label>
        {labels.data && labels.data.length > 0 && (
          <label className="text-sm font-medium">
            <span className="mb-1 block">{text.label}</span>
            <select
              className={selectClass}
              value={labelId}
              onChange={(event) => setLabelId(event.target.value)}
            >
              <option value="">{text.anyLabel}</option>
              {labels.data.map((label) => (
                <option key={label.id} value={label.id}>
                  {label.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {tasks.isPending && <Spinner />}
      {tasks.isError && <Alert>{errorMessage(tasks.error)}</Alert>}
      {tasks.isSuccess && tasks.data.items.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">
          {filtered ? text.noMatches : text.empty}
        </p>
      )}
      {tasks.isSuccess && tasks.data.items.length > 0 && (
        <>
          <p role="status" className="text-sm text-slate-500">
            {tasks.data.total === tasks.data.items.length
              ? text.count(tasks.data.total)
              : text.showing(tasks.data.items.length, tasks.data.total)}
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-slate-100 text-xs text-slate-600 uppercase dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    {text.columns.key}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {text.columns.title}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {text.columns.status}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {text.columns.priority}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {text.columns.assignee}
                  </th>
                  <th scope="col" className="px-3 py-2">
                    {text.columns.due}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
                {tasks.data.items.map((task) => {
                  const status = statusById.get(task.statusId)
                  return (
                    <tr key={task.id}>
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
        </>
      )}
    </div>
  )
}
