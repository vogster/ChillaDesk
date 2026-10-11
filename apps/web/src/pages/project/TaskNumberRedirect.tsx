import { taskSchema } from '@chillawiki/shared'
import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router'
import { ApiError, apiRequest, errorMessage } from '../../api/client'
import { Alert, Spinner } from '../../components/ui'
import { NotFoundPage } from '../NotFoundPage'
import { TASK_PARAM, useProjectContext } from './ProjectLayout'

/**
 * `/projects/:id/tasks/12`: where a task key such as `CHL-12` in a wiki page or comment
 * points. Opens that task on the board.
 */
export function TaskNumberRedirect() {
  const { project } = useProjectContext()
  const { number = '' } = useParams()
  const valid = /^[1-9]\d*$/.test(number)
  const task = useQuery({
    queryKey: ['projects', project.id, 'tasks', 'by-number', number],
    queryFn: () =>
      apiRequest(`/projects/${project.id}/tasks/by-number/${number}`, { schema: taskSchema }),
    enabled: valid,
    retry: false,
  })

  if (!valid) return <NotFoundPage />
  if (task.isPending) return <Spinner />
  if (task.isError) {
    const missing = task.error instanceof ApiError && task.error.code === 'NOT_FOUND'
    return missing ? <NotFoundPage /> : <Alert>{errorMessage(task.error)}</Alert>
  }
  return <Navigate to={`/projects/${project.id}?${TASK_PARAM}=${task.data.id}`} replace />
}
