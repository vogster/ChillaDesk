import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { errorMessage } from '../../api/client'
import { fetchMyTasks } from '../../api/overview'
import { Alert, Card, Spinner } from '../../components/ui'
import { useT } from '../../i18n'
import { TaskTable } from './TaskTable'

/** Everything assigned to the signed-in user, across projects. */
export function MyTasksPage() {
  const texts = useT().shell.myTasks
  const [includeDone, setIncludeDone] = useState(false)
  const tasks = useQuery({
    queryKey: ['my-tasks', includeDone],
    queryFn: () => fetchMyTasks(includeDone),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{texts.title}</h1>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeDone}
            onChange={(event) => setIncludeDone(event.target.checked)}
          />
          {texts.showFinished}
        </label>
      </div>

      {tasks.isPending && <Spinner />}
      {tasks.isError && <Alert>{errorMessage(tasks.error)}</Alert>}
      {tasks.isSuccess && tasks.data.length === 0 && (
        <Card className="text-center">
          <p className="font-medium">{texts.empty}</p>
          <p className="mt-1 text-sm text-slate-500">{texts.emptyHint}</p>
        </Card>
      )}
      {tasks.isSuccess && tasks.data.length > 0 && (
        <>
          <p role="status" className="text-sm text-slate-500">
            {texts.count(tasks.data.length)}
          </p>
          <TaskTable tasks={tasks.data} caption={texts.caption} />
        </>
      )}
    </div>
  )
}
