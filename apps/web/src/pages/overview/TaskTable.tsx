import type { TaskInContext } from '@chillawiki/shared'
import { Link } from 'react-router'
import { LabelList } from '../project/labels/LabelChip'
import { TASK_PARAM } from '../project/ProjectLayout'
import { DueDate, PriorityBadge } from '../project/taskDisplay'

/** Where a task opens: on its project's board, in the task dialog. */
export const taskPath = (task: TaskInContext) =>
  `/projects/${task.project.id}?${TASK_PARAM}=${task.id}`

const headerClass = 'px-3 py-2'

/** Tasks from several projects in one table. */
export function TaskTable({ tasks, caption }: { tasks: TaskInContext[]; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-100 text-xs text-slate-600 uppercase dark:bg-slate-800 dark:text-slate-300">
          <tr>
            <th scope="col" className={headerClass}>
              Key
            </th>
            <th scope="col" className={headerClass}>
              Title
            </th>
            <th scope="col" className={headerClass}>
              Project
            </th>
            <th scope="col" className={headerClass}>
              Status
            </th>
            <th scope="col" className={headerClass}>
              Priority
            </th>
            <th scope="col" className={headerClass}>
              Due
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
          {tasks.map((task) => (
            <tr key={task.id}>
              <td className="px-3 py-2 font-mono text-xs whitespace-nowrap text-slate-500">
                {task.key}
              </td>
              <td className="px-3 py-2">
                <Link to={taskPath(task)} className="font-medium hover:underline">
                  {task.title}
                </Link>
                {task.labels.length > 0 && (
                  <div className="mt-1">
                    <LabelList labels={task.labels} />
                  </div>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <Link to={`/projects/${task.project.id}`} className="hover:underline">
                  {task.project.name}
                </Link>
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{task.status.name}</td>
              <td className="px-3 py-2">
                <PriorityBadge priority={task.priority} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <DueDate task={task} status={task.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
