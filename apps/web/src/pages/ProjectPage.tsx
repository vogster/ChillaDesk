import type { User } from '@chillawiki/shared'
import { Link, useParams } from 'react-router'
import { ApiError, errorMessage } from '../api/client'
import { Alert, Card, Spinner } from '../components/ui'
import { MembersPanel } from './MembersPanel'
import { NotFoundPage } from './NotFoundPage'
import { useProject } from './projectQueries'
import { ProjectSettings } from './ProjectSettings'

const UPCOMING = ['Tasks', 'Board', 'Wiki'] as const

export function ProjectPage({ currentUser }: { currentUser: User }) {
  const { projectId = '' } = useParams()
  const project = useProject(projectId)

  if (project.isPending) return <Spinner />
  if (project.isError) {
    // A malformed id fails validation; for the visitor that is also just a missing page.
    const missing =
      project.error instanceof ApiError &&
      (project.error.code === 'NOT_FOUND' || project.error.code === 'VALIDATION_ERROR')
    return missing ? <NotFoundPage /> : <Alert>{errorMessage(project.error)}</Alert>
  }

  const { data } = project
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

      <Card>
        <ul className="grid gap-3 sm:grid-cols-3">
          {UPCOMING.map((feature) => (
            <li
              key={feature}
              className="rounded-md border border-dashed border-slate-300 px-3 py-4 text-center dark:border-slate-700"
            >
              <p className="text-sm font-medium">{feature}</p>
              <p className="text-xs text-slate-500">Coming soon</p>
            </li>
          ))}
        </ul>
      </Card>

      <MembersPanel project={data} currentUser={currentUser} />
      {data.role === 'owner' && <ProjectSettings key={data.id} project={data} />}
    </div>
  )
}
