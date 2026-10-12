import type { Project, User } from '@chillawiki/shared'
import { Link, NavLink, Outlet, useOutletContext, useParams, useSearchParams } from 'react-router'
import { z } from 'zod'
import { ApiError, errorMessage } from '../../api/client'
import { Alert, Spinner } from '../../components/ui'
import { NotFoundPage } from '../NotFoundPage'
import { useProject } from './projectQueries'
import { TaskDialog } from './TaskDialog'

export interface ProjectContext {
  project: Project
  currentUser: User
  /** Owners and members can change tasks; viewers only read. */
  canEdit: boolean
}

/** The project every page under `/projects/:projectId` is rendered for. */
export const useProjectContext = () => useOutletContext<ProjectContext>()

/** Query parameter that holds the id of the task shown in the dialog. */
export const TASK_PARAM = 'task'

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `border-b-2 px-1 pb-2 text-sm font-medium ${
    isActive
      ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
      : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
  }`

export function ProjectLayout({ currentUser }: { currentUser: User }) {
  const { projectId = '' } = useParams()
  const project = useProject(projectId)
  const [searchParams, setSearchParams] = useSearchParams()
  // The value goes into request paths, so anything that is not an id is ignored.
  const taskParam = z.uuid().safeParse(searchParams.get(TASK_PARAM))
  const openTaskId = taskParam.success ? taskParam.data : null

  if (project.isPending) return <Spinner />
  // Only when there is nothing to show: a failed reload in the background must not take
  // the board, or a half-written comment, off the screen.
  if (project.isError && !project.data) {
    // A malformed id fails validation; for the visitor that is also just a missing page.
    const missing =
      project.error instanceof ApiError &&
      (project.error.code === 'NOT_FOUND' || project.error.code === 'VALIDATION_ERROR')
    return missing ? <NotFoundPage /> : <Alert>{errorMessage(project.error)}</Alert>
  }

  const { data } = project
  const context: ProjectContext = {
    project: data,
    currentUser,
    canEdit: data.role !== 'viewer',
  }
  const closeTask = () =>
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete(TASK_PARAM)
      return next
    })

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
          ← Projects
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{data.name}</h1>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {data.key}
          </span>
        </div>
        {data.description && (
          <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            {data.description}
          </p>
        )}
      </div>

      <nav
        aria-label="Project sections"
        className="flex gap-5 border-b border-slate-200 dark:border-slate-800"
      >
        <NavLink to="." end className={tabClass}>
          Board
        </NavLink>
        <NavLink to="list" className={tabClass}>
          List
        </NavLink>
        <NavLink to="wiki" className={tabClass}>
          Wiki
        </NavLink>
        <NavLink to="members" className={tabClass}>
          Members
        </NavLink>
        {data.role === 'owner' && (
          <NavLink to="settings" className={tabClass}>
            Settings
          </NavLink>
        )}
      </nav>

      <Outlet context={context} />

      {openTaskId && (
        <TaskDialog key={openTaskId} context={context} taskId={openTaskId} onClose={closeTask} />
      )}
    </div>
  )
}
