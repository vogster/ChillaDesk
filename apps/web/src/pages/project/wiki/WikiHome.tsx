import { Link, Navigate } from 'react-router'
import { errorMessage } from '../../../api/client'
import { Alert, Card, Spinner } from '../../../components/ui'
import { useT } from '../../../i18n'
import { useProjectContext } from '../ProjectLayout'
import { buildTree, newWikiPagePath, wikiPagePath } from './wikiModel'
import { useWikiPages } from './wikiQueries'

/** `/wiki` itself: opens the first page, or invites to write one. */
export function WikiHome() {
  const t = useT()
  const { project, canEdit } = useProjectContext()
  const pages = useWikiPages(project.id)

  if (pages.isPending) return <Spinner />
  if (pages.isError) return <Alert>{errorMessage(pages.error)}</Alert>

  const first = buildTree(pages.data)[0]
  if (first) return <Navigate to={wikiPagePath(project.id, first.page.id)} replace />

  return (
    <Card className="text-center">
      <p className="font-medium">{t.project.wiki.empty.title}</p>
      <p className="mt-1 text-sm text-slate-500">{t.project.wiki.empty.hint}</p>
      {canEdit && (
        <Link
          to={newWikiPagePath(project.id)}
          className="mt-4 inline-flex rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          {t.project.wiki.empty.action}
        </Link>
      )}
    </Card>
  )
}
