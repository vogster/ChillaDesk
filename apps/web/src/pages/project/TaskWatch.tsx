import type { TaskWatchers } from '@chilladesk/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage } from '../../api/client'
import { fetchWatchers, setWatching } from '../../api/tasks'
import { Alert, Button } from '../../components/ui'
import { useT } from '../../i18n'
import { taskKeys } from './taskQueries'

interface TaskWatchProps {
  projectId: string
  taskId: string
}

/** Lets the user follow a task: watchers hear about its comments and moves. */
export function TaskWatch({ projectId, taskId }: TaskWatchProps) {
  const texts = useT().tasks.watch
  const queryClient = useQueryClient()
  const queryKey = [...taskKeys.detail(projectId, taskId), 'watchers']
  const watchers = useQuery({ queryKey, queryFn: () => fetchWatchers(projectId, taskId) })
  const toggle = useMutation({
    mutationFn: (watching: boolean) => setWatching(projectId, taskId, watching),
    onSuccess: (result) => queryClient.setQueryData<TaskWatchers>(queryKey, result),
  })

  const data = watchers.data
  // An extra of the dialog: if it cannot be loaded the task is still fully usable without it.
  if (!data) return null
  const names = data.watchers.map((watcher) => watcher.name).join(', ')

  return (
    <div className="space-y-2">
      {toggle.isError && <Alert>{errorMessage(toggle.error)}</Alert>}
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Button
          variant="secondary"
          aria-pressed={data.watching}
          disabled={toggle.isPending}
          onClick={() => toggle.mutate(!data.watching)}
        >
          {data.watching ? texts.stop : texts.start}
        </Button>
        <span className="text-slate-500" title={names}>
          {texts.count(data.watchers.length)}
        </span>
      </div>
      <p className="text-xs text-slate-500">{texts.hint}</p>
    </div>
  )
}
