import { searchQuerySchema } from '@chillawiki/shared'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { errorMessage } from '../../api/client'
import { searchEverything } from '../../api/overview'
import { Alert, Spinner } from '../../components/ui'
import { useT } from '../../i18n'
import { wikiPagePath } from '../project/wiki/wikiModel'
import { TaskTable } from './TaskTable'

/** `/search?q=…`: results from tasks and wiki pages of all the user's projects. */
export function SearchPage() {
  const texts = useT().shell.search
  const [searchParams] = useSearchParams()
  const parsed = searchQuerySchema.safeParse({ q: searchParams.get('q') ?? '' })
  const q = parsed.success ? parsed.data.q : null
  const results = useQuery({
    queryKey: ['search', q],
    queryFn: () => searchEverything(q ?? ''),
    enabled: q !== null,
    placeholderData: keepPreviousData,
  })
  const found = results.data
  const nothing = found !== undefined && found.tasks.length === 0 && found.pages.length === 0

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        {q ? texts.resultsFor(q) : texts.title}
      </h1>

      {q === null && <p className="text-sm text-slate-500">{texts.hint}</p>}
      {q !== null && results.isPending && <Spinner label={texts.searching} />}
      {results.isError && <Alert>{errorMessage(results.error)}</Alert>}
      {q !== null && nothing && <p className="text-sm text-slate-500">{texts.nothing}</p>}

      {q !== null && found && found.tasks.length > 0 && (
        <section aria-labelledby="search-tasks" className="space-y-3">
          <h2 id="search-tasks" className="text-base font-semibold">
            {texts.tasks}
          </h2>
          <TaskTable tasks={found.tasks} caption={texts.tasksCaption} />
        </section>
      )}

      {q !== null && found && found.pages.length > 0 && (
        <section aria-labelledby="search-pages" className="space-y-3">
          <h2 id="search-pages" className="text-base font-semibold">
            {texts.pages}
          </h2>
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
            {found.pages.map((page) => (
              <li key={page.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2 text-sm">
                <Link
                  to={wikiPagePath(page.project.id, page.id)}
                  className="font-medium hover:underline"
                >
                  {page.title}
                </Link>
                <span className="text-xs text-slate-500">{page.project.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
