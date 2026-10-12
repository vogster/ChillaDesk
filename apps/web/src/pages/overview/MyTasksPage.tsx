import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { errorMessage } from '../../api/client'
import { fetchMyTasks } from '../../api/overview'
import { Alert, Card, Spinner } from '../../components/ui'
import { TaskTable } from './TaskTable'

/** Everything assigned to the signed-in user, across projects. */
export function MyTasksPage() {
  const [includeDone, setIncludeDone] = useState(false)
  const tasks = useQuery({
    queryKey: ['my-tasks', includeDone],
    queryFn: () => fetchMyTasks(includeDone),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">My tasks</h1>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeDone}
            onChange={(event) => setIncludeDone(event.target.checked)}
          />
          Show finished
        </label>
      </div>

      {tasks.isPending && <Spinner />}
      {tasks.isError && <Alert>{errorMessage(tasks.error)}</Alert>}
      {tasks.isSuccess && tasks.data.length === 0 && (
        <Card className="text-center">
          <p className="font-medium">Nothing assigned to you</p>
          <p className="mt-1 text-sm text-slate-500">
            Tasks show up here when someone makes you the assignee.
          </p>
        </Card>
      )}
      {tasks.isSuccess && tasks.data.length > 0 && (
        <>
          <p role="status" className="text-sm text-slate-500">
            {tasks.data.length} {tasks.data.length === 1 ? 'task' : 'tasks'}, earliest due date
            first
          </p>
          <TaskTable tasks={tasks.data} caption="Tasks assigned to you" />
        </>
      )}
    </div>
  )
}
