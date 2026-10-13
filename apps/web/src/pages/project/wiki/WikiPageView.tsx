import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ApiError, errorMessage } from '../../../api/client'
import { Alert, Button, Spinner } from '../../../components/ui'
import { intlLocale, useT } from '../../../i18n'
import { NotFoundPage } from '../../NotFoundPage'
import { useProjectContext } from '../ProjectLayout'
import { ProjectMarkdown } from '../ProjectMarkdown'
import { useDeleteWikiPage, useWikiPage } from './wikiQueries'

export const isMissing = (error: unknown) =>
  error instanceof ApiError && (error.code === 'NOT_FOUND' || error.code === 'VALIDATION_ERROR')

const secondaryLinkClass =
  'inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'

export function WikiPageView() {
  const t = useT()
  const { project, canEdit } = useProjectContext()
  const { pageId = '' } = useParams()
  const page = useWikiPage(project.id, pageId)
  const deletePage = useDeleteWikiPage(project.id, pageId)
  const navigate = useNavigate()
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  if (page.isPending) return <Spinner />
  if (page.isError) {
    return isMissing(page.error) ? <NotFoundPage /> : <Alert>{errorMessage(page.error)}</Alert>
  }

  const { data } = page
  const handleDelete = () =>
    deletePage.mutate(undefined, {
      onSuccess: () => navigate(`/projects/${project.id}/wiki`, { replace: true }),
    })

  return (
    <article className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-2xl font-semibold tracking-tight break-words">{data.title}</h2>
          <p className="mt-1 text-xs text-slate-500">
            {t.project.wiki.page.savedInfo(
              data.version,
              new Date(data.updatedAt).toLocaleString(intlLocale(), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
              data.updatedBy?.name,
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Link to="edit" className={secondaryLinkClass}>
              {t.common.edit}
            </Link>
          )}
          <Link to="history" className={secondaryLinkClass}>
            {t.project.wiki.history.heading}
          </Link>
        </div>
      </header>

      {data.content ? (
        <ProjectMarkdown project={project}>{data.content}</ProjectMarkdown>
      ) : (
        <p className="text-sm text-slate-500">{t.project.wiki.page.noContent}</p>
      )}

      {canEdit && (
        <footer className="border-t border-slate-200 pt-4 dark:border-slate-800">
          {deletePage.isError && (
            <div className="mb-3">
              <Alert>{errorMessage(deletePage.error)}</Alert>
            </div>
          )}
          {confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm">
                {t.project.wiki.page.deleteConfirm.before}
                <strong>{data.title}</strong>
                {t.project.wiki.page.deleteConfirm.after}
              </p>
              <Button variant="danger" onClick={handleDelete} disabled={deletePage.isPending}>
                {t.project.confirmDelete}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
                {t.common.cancel}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmingDelete(true)}>
              {t.project.wiki.page.deletePage}
            </Button>
          )}
        </footer>
      )}
    </article>
  )
}
