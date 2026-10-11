import { taskPrioritySchema, type TaskPriority } from '@chillawiki/shared'
import { useState } from 'react'
import { Link } from 'react-router'
import { errorMessage } from '../../api/client'
import type { TaskFilters } from '../../api/tasks'
import { Alert, selectClass, Spinner } from '../../components/ui'
import { useDebounce } from '../../hooks/useDebounce'
import { useTaskLink } from './board/TaskCard'
import { useProjectContext } from './ProjectLayout'
import { useMembers } from './projectQueries'
import { DueDate, PRIORITY_LABELS, PriorityBadge } from './taskDisplay'
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
  const { project } = useProjectContext()
  const [search, setSearch] = useState('')
  const [statusId, setStatusId] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [priority, setPriority] = useState<TaskPriority | ''>('')
  const debouncedSearch = useDebounce(search.trim(), SEARCH_DELAY_MS)

  const filters: TaskFilters = {
    ...(debouncedSearch ? { q: debouncedSearch } : {}),
    ...(statusId ? { statusId } : {}),
    ...(assigneeId ? { assigneeId } : {}),
    ...(priority ? { priority } : {}),
  }
  const statuses = useStatuses(project.id)
  const members = useMembers(project.id)
  const tasks = useTasks(project.id, filters)
  const filtered = Object.keys(filters).length > 0
  const statusById = new Map((statuses.data ?? []).map((status) => [status.id, status]))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <label htmlFor="task-search" className="mb-1 block text-sm font-medium">
            Search
          </label>
          <input
            id="task-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Title or description"
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
        <label className="text-sm font-medium">
          <span className="mb-1 block">Status</span>
          <select
            className={selectClass}
            value={statusId}
            onChange={(event) => setStatusId(event.target.value)}
          >
            <option value="">Any status</option>
            {statuses.data?.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          <span className="mb-1 block">Assignee</span>
          <select
            className={selectClass}
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
          >
            <option value="">Anyone</option>
            <option value="none">Unassigned</option>
            {members.data?.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          <span className="mb-1 block">Priority</span>
          <select
            className={selectClass}
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority | '')}
          >
            <option value="">Any priority</option>
            {taskPrioritySchema.options.map((option) => (
              <option key={option} value={option}>
                {PRIORITY_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {tasks.isPending && <Spinner />}
      {tasks.isError && <Alert>{errorMessage(tasks.error)}</Alert>}
      {tasks.isSuccess && tasks.data.items.length === 0 && (
        <p className="py-8 text-center text-sm text-slate-500">
          {filtered ? 'No tasks match these filters.' : 'No tasks yet. Add one on the board.'}
        </p>
      )}
      {tasks.isSuccess && tasks.data.items.length > 0 && (
        <>
          <p role="status" className="text-sm text-slate-500">
            {tasks.data.total === tasks.data.items.length
              ? `${tasks.data.total} ${tasks.data.total === 1 ? 'task' : 'tasks'}`
              : `Showing ${tasks.data.items.length} of ${tasks.data.total} tasks`}
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-slate-100 text-xs text-slate-600 uppercase dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Key
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Title
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Priority
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Assignee
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Due
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
