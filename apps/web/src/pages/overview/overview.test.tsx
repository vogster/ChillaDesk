import type { TaskInContext, WikiSearchHit } from '@chilladesk/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ann,
  apiError,
  doing,
  done,
  makeProject,
  makeTask,
  mockApi,
  ok,
  renderApp,
  todo,
  type ApiRoutes,
} from '../../test/render'

const project = makeProject()
const other = makeProject({
  id: '33333333-3333-4333-8333-444444444444',
  key: 'OPS',
  name: 'Operations',
})
const ref = ({ id, key, name }: typeof project) => ({ id, key, name })

const inContext = (number: number, overrides: Partial<TaskInContext> = {}): TaskInContext => ({
  ...makeTask(number),
  project: ref(project),
  status: todo,
  ...overrides,
})

const signedIn = (routes: ApiRoutes) =>
  mockApi({ 'GET /api/auth/me': () => ok(ann), 'GET /api/projects': () => ok([]), ...routes })

const rows = () => screen.getAllByRole('row').slice(1)

describe('my tasks', () => {
  const open = inContext(1, { title: 'Write docs', priority: 'high', dueDate: '2030-05-17' })
  const elsewhere = inContext(7, {
    title: 'Rotate keys',
    key: 'OPS-7',
    project: ref(other),
    status: doing,
  })
  const finished = inContext(3, { title: 'Old thing', status: done })

  it('is reachable from the header and lists tasks with their project and status', async () => {
    signedIn({ 'GET /api/me/tasks': () => ok([open, elsewhere]) })
    const { user } = renderApp('/')

    await user.click(await screen.findByRole('link', { name: 'My tasks' }))

    expect(await screen.findByRole('heading', { name: 'My tasks' })).toBeInTheDocument()
    expect(await screen.findByText('2 tasks, earliest due date first')).toBeInTheDocument()
    const [first, second] = rows() as [HTMLElement, HTMLElement]
    expect(within(first).getByRole('link', { name: 'Write docs' })).toHaveAttribute(
      'href',
      `/projects/${project.id}?task=${open.id}`,
    )
    expect(first).toHaveTextContent(/CHL-1.*Chilla.*To Do.*High.*2030/)
    expect(second).toHaveTextContent(/OPS-7.*Operations.*In Progress/)
    expect(within(second).getByRole('link', { name: 'Operations' })).toHaveAttribute(
      'href',
      `/projects/${other.id}`,
    )
  })

  it('shows finished tasks only when asked', async () => {
    const calls = signedIn({
      'GET /api/me/tasks': (_body, query) =>
        ok(query.get('includeDone') === 'true' ? [open, finished] : [open]),
    })
    const { user } = renderApp('/my-tasks')

    expect(await screen.findByText('1 task, earliest due date first')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Show finished' }))

    expect(await screen.findByRole('link', { name: 'Old thing' })).toBeInTheDocument()
    expect(calls.at(-1)?.key).toBe('GET /api/me/tasks?includeDone=true')
  })

  it('says so when nothing is assigned, and shows a load error', async () => {
    signedIn({ 'GET /api/me/tasks': () => ok([]) })
    const first = renderApp('/my-tasks')
    expect(await screen.findByText('Nothing assigned to you')).toBeInTheDocument()
    first.unmount()

    signedIn({
      'GET /api/me/tasks': () => apiError(500, 'INTERNAL_ERROR', 'Internal server error'),
    })
    renderApp('/my-tasks')
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error')
  })
})

describe('search', () => {
  const task = inContext(4, { title: 'Deploy pipeline' })
  const page: WikiSearchHit = {
    id: '77777777-7777-4777-8777-000000000001',
    title: 'Deployment',
    project: ref(other),
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  const searching = (extra: ApiRoutes = {}) =>
    signedIn({
      'GET /api/search': (_body, query) =>
        query.get('q') === 'deploy'
          ? ok({ tasks: [task], pages: [page] })
          : ok({ tasks: [], pages: [] }),
      ...extra,
    })

  it('searches from the header and shows tasks and wiki pages', async () => {
    const calls = searching()
    const { user } = renderApp('/')

    await user.type(
      await screen.findByRole('searchbox', { name: 'Search tasks and wiki' }),
      ' deploy {Enter}',
    )

    expect(await screen.findByRole('heading', { name: 'Results for “deploy”' })).toBeInTheDocument()
    const tasks = await screen.findByRole('region', { name: 'Tasks' })
    expect(within(tasks).getByRole('link', { name: 'Deploy pipeline' })).toHaveAttribute(
      'href',
      `/projects/${project.id}?task=${task.id}`,
    )
    const pages = screen.getByRole('region', { name: 'Wiki pages' })
    expect(within(pages).getByRole('link', { name: 'Deployment' })).toHaveAttribute(
      'href',
      `/projects/${other.id}/wiki/${page.id}`,
    )
    expect(within(pages).getByText('Operations')).toBeInTheDocument()
    expect(calls.some((call) => call.key === 'GET /api/search?q=deploy')).toBe(true)
    expect(screen.getByRole('searchbox')).toHaveValue('deploy')
  })

  it('says so when nothing matches', async () => {
    searching()
    renderApp('/search?q=nothing')

    expect(await screen.findByText('Nothing found in your projects.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Tasks' })).not.toBeInTheDocument()
  })

  it('asks for a longer query without calling the server', async () => {
    const calls = searching()
    renderApp('/search?q=d')

    expect(await screen.findByText(/at least two characters/)).toBeInTheDocument()
    expect(calls.some((call) => call.key.startsWith('GET /api/search'))).toBe(false)
  })

  it('ignores an empty search and shows a failure', async () => {
    searching({ 'GET /api/search': () => apiError(500, 'INTERNAL_ERROR', 'Internal server error') })
    const { user } = renderApp('/')

    await user.type(await screen.findByRole('searchbox'), '   {Enter}')
    expect(screen.getByRole('heading', { name: 'Projects' })).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox'), 'deploy{Enter}')
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Internal server error'),
    )
  })
})
