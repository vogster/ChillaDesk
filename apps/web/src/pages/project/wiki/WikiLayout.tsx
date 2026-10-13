import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { errorMessage } from '../../../api/client'
import { Alert, Spinner } from '../../../components/ui'
import { useDebounce } from '../../../hooks/useDebounce'
import { useT } from '../../../i18n'
import { useProjectContext } from '../ProjectLayout'
import { buildTree, newWikiPagePath, wikiPagePath, type TreeNode } from './wikiModel'
import { useWikiPages } from './wikiQueries'

const SEARCH_DELAY_MS = 300

const pageLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block truncate rounded px-2 py-1 text-sm ${
    isActive
      ? 'bg-indigo-50 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200'
      : 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
  }`

function Tree({ projectId, nodes }: { projectId: string; nodes: TreeNode[] }) {
  return (
    <ul className="space-y-0.5">
      {nodes.map(({ page, children }) => (
        <li key={page.id}>
          <NavLink to={wikiPagePath(projectId, page.id)} className={pageLinkClass}>
            {page.title}
          </NavLink>
          {children.length > 0 && (
            <div className="ml-3 border-l border-slate-200 pl-1 dark:border-slate-800">
              <Tree projectId={projectId} nodes={children} />
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

/** The wiki section: page navigation on the side, the selected page next to it. */
export function WikiLayout() {
  const t = useT()
  const context = useProjectContext()
  const { project, canEdit } = context
  const [search, setSearch] = useState('')
  const query = useDebounce(search.trim(), SEARCH_DELAY_MS)
  const pages = useWikiPages(project.id, query)
  // While a new search loads, the previous result is still on screen: go by what it is,
  // not by what was typed, when choosing between the tree and the flat result list.
  const showingResults = query !== '' && !pages.isPlaceholderData

  return (
    <div className="grid gap-6 md:grid-cols-[16rem_minmax(0,1fr)]">
      <aside className="space-y-3">
        <div>
          <label htmlFor="wiki-search" className="sr-only">
            {t.project.wiki.search}
          </label>
          <input
            id="wiki-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t.project.wiki.search}
            className="block w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900"
          />
        </div>
        {canEdit && (
          <Link
            to={newWikiPagePath(project.id)}
            className="block rounded-md border border-dashed border-slate-300 px-2 py-1.5 text-center text-sm text-slate-600 hover:border-indigo-400 hover:text-indigo-700 dark:border-slate-700 dark:text-slate-300"
          >
            {t.project.wiki.newPageLink}
          </Link>
        )}
        <nav aria-label={t.project.wiki.pagesNav}>
          {pages.isPending && <Spinner />}
          {pages.isError && <Alert>{errorMessage(pages.error)}</Alert>}
          {pages.isSuccess && pages.data.length === 0 && (
            <p className="px-2 text-sm text-slate-500">
              {query ? t.project.wiki.noMatches : t.project.wiki.noPages}
            </p>
          )}
          {pages.isSuccess && pages.data.length > 0 && (
            // Search results are a flat list: a match may sit deep inside a branch that
            // does not match itself.
            <Tree
              projectId={project.id}
              nodes={
                showingResults
                  ? pages.data.map((page) => ({ page, children: [] }))
                  : buildTree(pages.data)
              }
            />
          )}
        </nav>
      </aside>
      <div className="min-w-0">
        <Outlet context={context} />
      </div>
    </div>
  )
}
