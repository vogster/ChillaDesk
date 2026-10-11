import type { Project, WikiPage, WikiVersion } from '@chillawiki/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ann,
  apiError,
  bob,
  makeMember,
  makeProject,
  makeTask,
  makeWikiPage,
  mockApi,
  noContent,
  ok,
  renderApp,
  summary,
  todo,
  type ApiRoutes,
} from '../../../test/render'

const project = makeProject()
const url = `/api/projects/${project.id}`
const wikiPath = `/projects/${project.id}/wiki`
const TIMESTAMP = '2026-01-01T00:00:00.000Z'

const guides = makeWikiPage(1, {
  title: 'Guides',
  content: 'See [[Deploy]] and [[Roadmap]]. Fixes CHL-2.',
})
const deploy = makeWikiPage(2, {
  title: 'Deploy',
  parentId: guides.id,
  content: '`docker compose up`',
})
const about = makeWikiPage(3, { title: 'About', content: '# About us' })

interface ServerOptions {
  role?: Project['role']
  pages?: WikiPage[]
  extra?: ApiRoutes
}

/** An in-memory stand-in for the wiki endpoints, so refetches return what the UI changed. */
function server({ role = 'owner', extra = {}, ...initial }: ServerOptions = {}) {
  let pages = initial.pages ?? [guides, deploy, about]
  const history = new Map<string, WikiVersion[]>(
    pages.map((page) => [
      page.id,
      [
        {
          version: 1,
          title: page.title,
          content: page.content,
          author: summary(ann),
          createdAt: TIMESTAMP,
        },
      ],
    ]),
  )
  const summaryOf = ({ id, projectId, parentId, title, updatedAt }: WikiPage) => ({
    id,
    projectId,
    parentId,
    title,
    updatedAt,
  })
  const routes: ApiRoutes = {}

  const definePageRoutes = (page: WikiPage) => {
    const pageUrl = `${url}/wiki/${page.id}`
    const current = () => pages.find((item) => item.id === page.id)
    routes[`GET ${pageUrl}`] = () => {
      const found = current()
      return found ? ok(found) : apiError(404, 'NOT_FOUND', 'Wiki page not found')
    }
    routes[`PATCH ${pageUrl}`] = (body) => {
      const { baseVersion, ...changes } = body as Partial<WikiPage> & { baseVersion: number }
      const stored = current() as WikiPage
      if (stored.version !== baseVersion) {
        return {
          status: 409,
          body: {
            error: {
              code: 'CONFLICT',
              message: 'This page was changed by someone else while you were editing.',
              details: [{ path: 'baseVersion', message: 'Stale' }],
            },
          },
        }
      }
      const clash = pages.some(
        (item) => item.id !== page.id && item.title.toLowerCase() === changes.title?.toLowerCase(),
      )
      if (clash) return apiError(409, 'CONFLICT', `A page titled "${changes.title}" already exists`)
      const next = { ...stored, ...changes, version: stored.version + 1 }
      pages = pages.map((item) => (item.id === page.id ? next : item))
      history.get(page.id)?.unshift({
        version: next.version,
        title: next.title,
        content: next.content,
        author: summary(ann),
        createdAt: TIMESTAMP,
      })
      return ok(next)
    }
    routes[`DELETE ${pageUrl}`] = () => {
      pages = pages.filter((item) => item.id !== page.id)
      return noContent()
    }
    routes[`GET ${pageUrl}/versions`] = () =>
      ok((history.get(page.id) ?? []).map(({ content: _content, ...rest }) => rest))
    for (const version of [1, 2, 3]) {
      routes[`GET ${pageUrl}/versions/${version}`] = () => {
        const found = history.get(page.id)?.find((item) => item.version === version)
        return found ? ok(found) : apiError(404, 'NOT_FOUND', 'Version not found')
      }
    }
  }
  pages.forEach(definePageRoutes)

  Object.assign(routes, {
    'GET /api/auth/me': () => ok(ann),
    [`GET ${url}`]: () => ok(makeProject({ role })),
    [`GET ${url}/members`]: () => ok([makeMember(ann, role), makeMember(bob, 'member')]),
    [`GET ${url}/statuses`]: () => ok([todo]),
    [`GET ${url}/tasks`]: () => ok({ items: [makeTask(2)], total: 1 }),
    [`GET ${url}/tasks/by-number/2`]: () => ok(makeTask(2)),
    [`GET ${url}/tasks/${makeTask(2).id}`]: () => ok(makeTask(2)),
    [`GET ${url}/tasks/${makeTask(2).id}/comments`]: () => ok([]),
    [`GET ${url}/wiki`]: (_body, query) => {
      const q = query.get('q')?.toLowerCase()
      return ok(
        pages
          .filter((page) => !q || `${page.title} ${page.content}`.toLowerCase().includes(q))
          .map(summaryOf)
          .sort((left, right) => left.title.localeCompare(right.title)),
      )
    },
    [`POST ${url}/wiki`]: (body) => {
      const input = body as Pick<WikiPage, 'title' | 'content' | 'parentId'>
      if (pages.some((page) => page.title.toLowerCase() === input.title.toLowerCase())) {
        return apiError(409, 'CONFLICT', `A page titled "${input.title}" already exists`)
      }
      const created = makeWikiPage(pages.length + 10, input)
      pages = [...pages, created]
      history.set(created.id, [
        {
          version: 1,
          title: created.title,
          content: created.content,
          author: summary(ann),
          createdAt: TIMESTAMP,
        },
      ])
      definePageRoutes(created)
      return ok(created, 201)
    },
    ...extra,
  } satisfies ApiRoutes)
  // mockApi keeps this object, so routes defined later (for pages created in a test) count.
  const calls = mockApi(routes)

  return {
    calls,
    bodyOf: (key: string) => calls.findLast((call) => call.key === key)?.body,
    /** Changes a page behind the UI's back, as another user would. */
    editElsewhere: (page: WikiPage, content: string) => {
      pages = pages.map((item) =>
        item.id === page.id ? { ...item, content, version: item.version + 1 } : item,
      )
    },
    stored: (page: WikiPage) => pages.find((item) => item.id === page.id),
  }
}

const nav = () => screen.findByRole('navigation', { name: 'Wiki pages' })
const pageHeading = (name: string) => screen.findByRole('heading', { name, level: 2 })

describe('wiki navigation', () => {
  it('invites to write the first page when the wiki is empty', async () => {
    server({ pages: [] })
    renderApp(wikiPath)

    expect(await screen.findByText('This wiki is empty')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Write the first page' })).toHaveAttribute(
      'href',
      `${wikiPath}/new`,
    )
  })

  it('opens the first top-level page and shows the tree with subpages nested', async () => {
    server()
    renderApp(wikiPath)

    expect(await pageHeading('About')).toBeInTheDocument()
    const tree = await nav()
    const links = within(tree)
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(links).toEqual(['About', 'Guides', 'Deploy'])
    // Deploy sits in a nested list under Guides.
    const guidesItem = within(tree)
      .getByRole('link', { name: 'Guides' })
      .closest('li') as HTMLElement
    expect(within(guidesItem).getByRole('link', { name: 'Deploy' })).toBeInTheDocument()
  })

  it('navigates between pages from the tree', async () => {
    server()
    const { user } = renderApp(wikiPath)

    await user.click(await within(await nav()).findByRole('link', { name: 'Deploy' }))

    expect(await pageHeading('Deploy')).toBeInTheDocument()
    expect(screen.getByText('docker compose up')).toBeInTheDocument()
  })

  it('searches titles and content', async () => {
    server()
    const { user } = renderApp(wikiPath)
    await nav()

    await user.type(screen.getByLabelText('Search the wiki'), 'docker')
    await waitFor(async () =>
      expect(
        within(await nav())
          .getAllByRole('link')
          .map((link) => link.textContent),
      ).toEqual(['Deploy']),
    )

    await user.clear(screen.getByLabelText('Search the wiki'))
    await user.type(screen.getByLabelText('Search the wiki'), 'zzz')
    expect(await screen.findByText('No pages match your search.')).toBeInTheDocument()
  })

  it('shows a not-found page for an unknown page id', async () => {
    server()
    renderApp(`${wikiPath}/77777777-7777-4777-8777-999999999999`)

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})

describe('wiki links', () => {
  it('links [[titles]] to pages, marks missing ones, and links task keys', async () => {
    server()
    renderApp(`${wikiPath}/${guides.id}`)
    await pageHeading('Guides')
    const article = screen.getByRole('article')

    expect(within(article).getByRole('link', { name: 'Deploy' })).toHaveAttribute(
      'href',
      `${wikiPath}/${deploy.id}`,
    )
    const missing = within(article).getByRole('link', { name: 'Roadmap' })
    expect(missing).toHaveAttribute('href', `${wikiPath}/new?title=Roadmap`)
    expect(missing).toHaveAttribute('title', expect.stringContaining('does not exist yet'))
    expect(within(article).getByRole('link', { name: 'CHL-2' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/tasks/2`,
    )
  })

  it('opens the task behind a key', async () => {
    server()
    const { user } = renderApp(`${wikiPath}/${guides.id}`)

    await user.click(await screen.findByRole('link', { name: 'CHL-2' }))

    expect(await screen.findByRole('dialog', { name: 'CHL-2: Task 2' })).toBeInTheDocument()
  })

  it('offers to create a missing page with its title filled in', async () => {
    server()
    const { user } = renderApp(`${wikiPath}/${guides.id}`)

    await user.click(await screen.findByRole('link', { name: 'Roadmap' }))

    expect(await screen.findByRole('heading', { name: 'New page' })).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Roadmap')
  })

  it('reports an unknown task number as not found', async () => {
    server()
    renderApp(`/projects/${project.id}/tasks/99`)

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})

describe('creating a page', () => {
  it('creates a page under a parent and opens it', async () => {
    const { bodyOf } = server()
    const { user } = renderApp(wikiPath)

    await user.click(await screen.findByRole('link', { name: '+ New page' }))
    await user.type(screen.getByLabelText('Title'), 'Runbook')
    await user.selectOptions(screen.getByLabelText('Parent page'), 'Guides')
    await user.type(screen.getByLabelText('Content'), 'Step one')
    await user.click(screen.getByRole('button', { name: 'Create page' }))

    expect(await pageHeading('Runbook')).toBeInTheDocument()
    expect(bodyOf(`POST ${url}/wiki`)).toEqual({
      title: 'Runbook',
      content: 'Step one',
      parentId: guides.id,
    })
    expect(within(await nav()).getByRole('link', { name: 'Runbook' })).toBeInTheDocument()
  })

  it('validates the title and shows a taken title from the server', async () => {
    const { calls } = server()
    const { user } = renderApp(`${wikiPath}/new`)

    await user.click(await screen.findByRole('button', { name: 'Create page' }))
    expect(screen.getByLabelText('Title')).toBeInvalid()

    // `[[` is how user-event types a literal `[`.
    await user.type(screen.getByLabelText('Title'), 'Notes [[old]')
    await user.click(screen.getByRole('button', { name: 'Create page' }))
    expect(screen.getByLabelText('Title')).toBeInvalid()
    expect(calls.some((call) => call.key === `POST ${url}/wiki`)).toBe(false)

    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'about')
    await user.click(screen.getByRole('button', { name: 'Create page' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })

  it('previews the Markdown before saving', async () => {
    server()
    const { user } = renderApp(`${wikiPath}/new`)

    await user.click(await screen.findByRole('tab', { name: 'Preview' }))
    expect(screen.getByText('Nothing to preview yet.')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Write' }))
    await user.type(screen.getByLabelText('Content'), '**important** and [[[[Deploy]]')
    await user.click(screen.getByRole('tab', { name: 'Preview' }))

    expect(screen.getByText('important').tagName).toBe('STRONG')
    expect(screen.getAllByRole('link', { name: 'Deploy' }).at(-1)).toHaveAttribute(
      'href',
      `${wikiPath}/${deploy.id}`,
    )
  })

  it('returns to the wiki on cancel', async () => {
    server()
    const { user } = renderApp(`${wikiPath}/new`)

    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(await pageHeading('About')).toBeInTheDocument()
  })
})

describe('editing a page', () => {
  it('saves a change against the version the edit started from', async () => {
    const { bodyOf } = server()
    const { user } = renderApp(`${wikiPath}/${about.id}`)

    await user.click(await screen.findByRole('link', { name: 'Edit' }))
    const content = await screen.findByLabelText('Content')
    await user.clear(content)
    await user.type(content, 'Rewritten')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText(/Version 2/)).toBeInTheDocument()
    expect(await screen.findByText('Rewritten')).toBeInTheDocument()
    // Only the changed field is sent, so an untouched title or parent cannot undo
    // someone else's rename or move.
    expect(bodyOf(`PATCH ${url}/wiki/${about.id}`)).toEqual({
      content: 'Rewritten',
      baseVersion: 1,
    })
  })

  it('loads the latest text before editing, not the copy that was on screen', async () => {
    const api = server()
    const { user } = renderApp(`${wikiPath}/${about.id}`, { staleTime: 30_000 })
    await pageHeading('About')
    api.editElsewhere(about, 'Their newer text')

    await user.click(screen.getByRole('link', { name: 'Edit' }))

    expect(await screen.findByLabelText('Content')).toHaveValue('Their newer text')
  })

  it('goes back without a request when nothing was changed', async () => {
    const { calls } = server()
    const { user } = renderApp(`${wikiPath}/${about.id}/edit`)

    await user.click(await screen.findByRole('button', { name: 'Save' }))

    expect(await pageHeading('About')).toBeInTheDocument()
    expect(calls.some((call) => call.key.startsWith('PATCH'))).toBe(false)
  })

  it('keeps unsaved text when the user wanders off and comes back', async () => {
    server()
    const { user } = renderApp(`${wikiPath}/${about.id}/edit`)
    await user.type(await screen.findByLabelText('Content'), ' half a thought')

    await user.click(within(await nav()).getByRole('link', { name: 'Guides' }))
    await pageHeading('Guides')
    await user.click(within(await nav()).getByRole('link', { name: 'About' }))
    await user.click(await screen.findByRole('link', { name: 'Edit' }))

    expect(await screen.findByLabelText('Content')).toHaveValue('# About us half a thought')
    expect(screen.getByRole('status')).toHaveTextContent(
      'unsaved changes from earlier were restored',
    )

    await user.click(screen.getByRole('button', { name: 'Discard them' }))
    expect(screen.getByLabelText('Content')).toHaveValue('# About us')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('forgets the draft once it has been saved or cancelled', async () => {
    server()
    const { user } = renderApp(`${wikiPath}/${about.id}/edit`)
    await user.type(await screen.findByLabelText('Content'), ' draft')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await user.click(await screen.findByRole('link', { name: 'Edit' }))

    expect(await screen.findByLabelText('Content')).toHaveValue('# About us')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('opens preview links in a new tab so the editor is not left', async () => {
    server()
    const { user } = renderApp(`${wikiPath}/${about.id}/edit`)
    await user.type(await screen.findByLabelText('Content'), ' [[[[Guides]] CHL-2')

    await user.click(screen.getByRole('tab', { name: 'Preview' }))

    const preview = screen.getByRole('tablist').parentElement as HTMLElement
    for (const name of ['Guides', 'CHL-2']) {
      expect(within(preview).getByRole('link', { name })).toHaveAttribute('target', '_blank')
    }
  })

  it('reports a taken title as such, without offering to overwrite', async () => {
    server()
    const { user } = renderApp(`${wikiPath}/${about.id}/edit`)
    const title = await screen.findByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'guides')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(
      screen.queryByRole('button', { name: 'save your version over theirs' }),
    ).not.toBeInTheDocument()
  })

  it('does not offer the page itself or its subpages as a parent', async () => {
    server()
    renderApp(`${wikiPath}/${guides.id}/edit`)

    const select = await screen.findByLabelText('Parent page')
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent)

    expect(options).toEqual(['None (top level)', 'About'])
  })

  it('keeps the text and offers to overwrite when someone else saved first', async () => {
    const api = server()
    const { user } = renderApp(`${wikiPath}/${about.id}/edit`)
    const content = await screen.findByLabelText('Content')
    await user.type(content, ' plus mine')
    api.editElsewhere(about, 'Their text')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('changed by someone else')
    expect(screen.getByLabelText('Content')).toHaveValue('# About us plus mine')
    expect(api.stored(about)?.content).toBe('Their text')

    await user.click(screen.getByRole('button', { name: 'save your version over theirs' }))

    expect(await screen.findByText(/Version 3/)).toBeInTheDocument()
    expect(api.stored(about)?.content).toBe('# About us plus mine')
    expect(api.bodyOf(`PATCH ${url}/wiki/${about.id}`)).toEqual({
      title: 'About',
      content: '# About us plus mine',
      baseVersion: 2,
    })
  })

  it('goes back to the page on cancel without saving', async () => {
    const { calls } = server()
    const { user } = renderApp(`${wikiPath}/${about.id}/edit`)

    await user.type(await screen.findByLabelText('Content'), ' draft')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await pageHeading('About')).toBeInTheDocument()
    expect(calls.some((call) => call.key.startsWith('PATCH'))).toBe(false)
  })
})

describe('deleting a page', () => {
  it('asks first, then returns to the wiki', async () => {
    const { calls } = server()
    const { user } = renderApp(`${wikiPath}/${about.id}`)

    await user.click(await screen.findByRole('button', { name: 'Delete page…' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Delete page…' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

    expect(await pageHeading('Guides')).toBeInTheDocument()
    expect(within(await nav()).queryByRole('link', { name: 'About' })).not.toBeInTheDocument()
  })
})

describe('page history', () => {
  async function editedOnce() {
    const api = server()
    const view = renderApp(`${wikiPath}/${about.id}/edit`)
    const content = await screen.findByLabelText('Content')
    await view.user.clear(content)
    await view.user.type(content, 'Second text')
    await view.user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText(/Version 2/)
    await view.user.click(screen.getByRole('link', { name: 'History' }))
    return { ...api, ...view }
  }

  it('lists versions, shows an old one and restores it as a new version', async () => {
    const { user, bodyOf, stored } = await editedOnce()

    const versions = await screen.findAllByRole('link', { name: /^Version \d/ })
    expect(versions.map((link) => link.textContent)).toEqual([
      expect.stringContaining('Version 2current'),
      expect.stringContaining('Version 1'),
    ])

    await user.click(versions[1] as HTMLElement)
    const old = await screen.findByRole('region', { name: 'Version 1' })
    expect(await within(old).findByRole('heading', { name: 'About us' })).toBeInTheDocument()

    await user.click(within(old).getByRole('button', { name: 'Restore this version' }))

    expect(await screen.findByText(/Version 3/)).toBeInTheDocument()
    expect(bodyOf(`PATCH ${url}/wiki/${about.id}`)).toEqual({
      title: 'About',
      content: '# About us',
      baseVersion: 2,
    })
    expect(stored(about)?.content).toBe('# About us')
  })

  it('does not offer to restore the current version', async () => {
    const { user } = await editedOnce()

    await user.click(
      (await screen.findAllByRole('link', { name: /^Version \d/ }))[0] as HTMLElement,
    )

    const current = await screen.findByRole('region', { name: 'Version 2' })
    expect(await within(current).findByText('Second text')).toBeInTheDocument()
    expect(
      within(current).queryByRole('button', { name: 'Restore this version' }),
    ).not.toBeInTheDocument()
  })

  it('says so when a version does not exist', async () => {
    server()
    renderApp(`${wikiPath}/${about.id}/history?v=3`)

    expect(await screen.findByRole('alert')).toHaveTextContent('This page has no version 3.')
  })
})

describe('links in running text', () => {
  const content = [
    'Inline `[[Guides]]` and ``CHL-2`` stay code.',
    '',
    '    [[Guides]] in an indented block',
    '',
    '~~~',
    'CHL-2 in a fenced block',
    '~~~',
    '',
    'A URL keeps its key: https://tracker.example.com/browse/CHL-2',
    '',
    'An [existing CHL-2 link](https://example.com/x) is left alone, but [[Guides]] works.',
  ].join('\n')

  it('only links plain text, never code, URLs or existing links', async () => {
    server({ pages: [guides, makeWikiPage(9, { title: 'Syntax', content })] })
    renderApp(`${wikiPath}/${makeWikiPage(9).id}`)
    await pageHeading('Syntax')
    const article = screen.getByRole('article')

    const links = within(article)
      .getAllByRole('link')
      .filter((link) => !['Edit', 'History'].includes(link.textContent ?? ''))
      .map((link) => [link.textContent, link.getAttribute('href')])
    expect(links).toEqual([
      ['https://tracker.example.com/browse/CHL-2', 'https://tracker.example.com/browse/CHL-2'],
      ['existing CHL-2 link', 'https://example.com/x'],
      ['Guides', `${wikiPath}/${guides.id}`],
    ])
    expect(within(article).getAllByText(/\[\[Guides\]\]/)).toHaveLength(2)
  })

  it('links a title with underscores and punctuation, showing it as written', async () => {
    const title = 'snake_case & co. (v2)'
    const odd = makeWikiPage(8, { title })
    server({
      pages: [odd, makeWikiPage(9, { title: 'Index', content: `Go to [[${title}]].` })],
    })
    renderApp(`${wikiPath}/${makeWikiPage(9).id}`)
    await pageHeading('Index')

    expect(
      await within(screen.getByRole('article')).findByRole('link', { name: title }),
    ).toHaveAttribute('href', `${wikiPath}/${odd.id}`)
  })
})

describe('viewers', () => {
  it('see a title without a page as plain text, since they cannot create it', async () => {
    server({ role: 'viewer' })
    renderApp(`${wikiPath}/${guides.id}`)
    await pageHeading('Guides')
    const article = screen.getByRole('article')

    expect(await within(article).findByRole('link', { name: 'Deploy' })).toBeInTheDocument()
    expect(within(article).queryByRole('link', { name: 'Roadmap' })).not.toBeInTheDocument()
    expect(within(article).getByText(/\[\[Roadmap\]\]/)).toBeInTheDocument()
  })

  it('can read pages and history but not change anything', async () => {
    server({ role: 'viewer' })
    const { user } = renderApp(`${wikiPath}/${about.id}`)

    await pageHeading('About')
    expect(screen.queryByRole('link', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '+ New page' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete page…' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'History' }))
    await user.click(await screen.findByRole('link', { name: /^Version 1/ }))
    const region = await screen.findByRole('region', { name: 'Version 1' })
    expect(within(region).queryByRole('button')).not.toBeInTheDocument()
  })

  it.each(['new', `${about.id}/edit`])('cannot open the editor at /wiki/%s', async (path) => {
    server({ role: 'viewer' })
    renderApp(`${wikiPath}/${path}`)

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})
