import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { errorMessage } from '../../../api/client'
import { Alert, Button, Spinner } from '../../../components/ui'
import { NotFoundPage } from '../../NotFoundPage'
import { useProjectContext } from '../ProjectLayout'
import { ProjectMarkdown } from '../ProjectMarkdown'
import { wikiPagePath } from './wikiModel'
import { isMissing } from './WikiPageView'
import { useUpdateWikiPage, useWikiPage, useWikiVersion, useWikiVersions } from './wikiQueries'

const VERSION_PARAM = 'v'

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function WikiHistory() {
  const { project, canEdit } = useProjectContext()
  const { pageId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const page = useWikiPage(project.id, pageId)
  const versions = useWikiVersions(project.id, pageId)
  const requested = Number(searchParams.get(VERSION_PARAM))
  const selected = Number.isInteger(requested) && requested > 0 ? requested : null
  const version = useWikiVersion(project.id, pageId, selected)
  const restore = useUpdateWikiPage(project.id, pageId)

  if (page.isPending || versions.isPending) return <Spinner />
  if (page.isError) {
    return isMissing(page.error) ? <NotFoundPage /> : <Alert>{errorMessage(page.error)}</Alert>
  }
  if (versions.isError) return <Alert>{errorMessage(versions.error)}</Alert>

  const pagePath = wikiPagePath(project.id, pageId)
  const current = page.data
  const handleRestore = () => {
    if (!version.data) return
    // Restoring saves the old text as a new version; nothing in the history is lost.
    restore.mutate(
      { title: version.data.title, content: version.data.content, baseVersion: current.version },
      { onSuccess: () => navigate(pagePath) },
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          to={pagePath}
          className="text-sm text-indigo-600 hover:underline dark:text-indigo-400"
        >
          ← {current.title}
        </Link>
        <h2 className="mt-1 text-xl font-semibold">History</h2>
      </div>

      <ol className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {versions.data.map((item) => (
          <li key={item.version}>
            <Link
              to={`?${VERSION_PARAM}=${item.version}`}
              aria-current={item.version === selected ? 'true' : undefined}
              className={`flex flex-wrap items-baseline gap-x-3 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 ${
                item.version === selected ? 'bg-indigo-50 dark:bg-indigo-950' : ''
              }`}
            >
              <span className="font-medium">Version {item.version}</span>
              {item.version === current.version && (
                <span className="rounded bg-slate-200 px-1.5 text-xs dark:bg-slate-700">
                  current
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-400">
                {item.title}
              </span>
              <span className="text-xs text-slate-500">
                {item.author?.name ?? 'Deleted user'}, {formatTimestamp(item.createdAt)}
              </span>
            </Link>
          </li>
        ))}
      </ol>

      {selected !== null && (
        <section aria-label={`Version ${selected}`} className="space-y-3">
          {version.isPending && <Spinner />}
          {version.isError && (
            <Alert>
              {isMissing(version.error)
                ? `This page has no version ${selected}.`
                : errorMessage(version.error)}
            </Alert>
          )}
          {version.isSuccess && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-lg font-semibold break-words">{version.data.title}</h3>
                {canEdit && selected !== current.version && (
                  <Button onClick={handleRestore} disabled={restore.isPending}>
                    Restore this version
                  </Button>
                )}
              </div>
              {restore.isError && <Alert>{errorMessage(restore.error)}</Alert>}
              <div className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                {version.data.content ? (
                  <ProjectMarkdown project={project}>{version.data.content}</ProjectMarkdown>
                ) : (
                  <p className="text-sm text-slate-500">This version had no content.</p>
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}
