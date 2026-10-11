import { Link, Navigate } from 'react-router'
import { errorMessage } from '../../../api/client'
import { Alert, Card, Spinner } from '../../../components/ui'
import { useProjectContext } from '../ProjectLayout'
import { buildTree, newWikiPagePath, wikiPagePath } from './wikiModel'
import { useWikiPages } from './wikiQueries'

/** `/wiki` itself: opens the first page, or invites to write one. */
export function WikiHome() {
  const { project, canEdit } = useProjectContext()
  const pages = useWikiPages(project.id)

  if (pages.isPending) return <Spinner />
  if (pages.isError) return <Alert>{errorMessage(pages.error)}</Alert>

  const first = buildTree(pages.data)[0]
  if (first) return <Navigate to={wikiPagePath(project.id, first.page.id)} replace />

  return (
    <Card className="text-center">
      <p className="font-medium">This wiki is empty</p>
      <p className="mt-1 text-sm text-slate-500">
        Keep notes, decisions and how-tos next to the tasks they belong to.
      </p>
      {canEdit && (
        <Link
          to={newWikiPagePath(project.id)}
          className="mt-4 inline-flex rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Write the first page
        </Link>
      )}
    </Card>
  )
}
