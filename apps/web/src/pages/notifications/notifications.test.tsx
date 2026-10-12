import type { Notification, NotificationList } from '@chillawiki/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ann,
  apiError,
  bob,
  makeProject,
  makeTask,
  makeWikiPage,
  mockApi,
  noContent,
  ok,
  renderApp,
  summary,
  type ApiRoutes,
} from '../../test/render'

const project = makeProject()
const task = makeTask(4, { title: 'Write docs' })
const page = makeWikiPage(1, { title: 'Plan' })

const notification = (number: number, overrides: Partial<Notification> = {}): Notification => ({
  id: `88888888-8888-4888-8888-${String(number).padStart(12, '0')}`,
  type: 'task_assigned',
  actor: summary(bob),
  project: { id: project.id, key: project.key, name: project.name },
  task: { id: task.id, key: task.key, title: task.title },
  page: null,
  excerpt: task.title,
  readAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
})

const assigned = notification(1)
const commented = notification(2, { type: 'task_commented', excerpt: 'Looks good to me' })
const mentioned = notification(3, {
  type: 'mentioned',
  task: null,
  page: { id: page.id, title: page.title },
  excerpt: 'Ask @ann@example.com',
  readAt: '2026-01-02T00:00:00.000Z',
})

/** An in-memory inbox, so marking as read shows up in the next fetch. */
function server(initial: Notification[], extra: ApiRoutes = {}) {
  let items = initial
  const list = (): NotificationList => ({
    items,
    unreadCount: items.filter((item) => item.readAt === null).length,
  })
  return mockApi({
    'GET /api/auth/me': () => ok(ann),
    'GET /api/projects': () => ok([]),
    'GET /api/notifications': () => ok(list()),
    'POST /api/notifications/read': (body) => {
      const { ids } = body as { ids?: string[] }
      items = items.map((item) =>
        !ids || ids.includes(item.id) ? { ...item, readAt: '2026-01-03T00:00:00.000Z' } : item,
      )
      return noContent()
    },
    ...extra,
  })
}

describe('the bell in the header', () => {
  it('shows how many notifications are unread and leads to them', async () => {
    server([assigned, commented, mentioned])
    const { user } = renderApp('/')

    await user.click(await screen.findByRole('link', { name: 'Notifications, 2 unread' }))

    expect(await screen.findByRole('heading', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('has no number when everything is read or the list cannot be loaded', async () => {
    server([mentioned])
    const first = renderApp('/')
    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeInTheDocument()
    first.unmount()

    server([], { 'GET /api/notifications': () => apiError(500, 'INTERNAL', 'Boom') })
    renderApp('/')

    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeInTheDocument()
  })
})

describe('the notifications page', () => {
  it('says what happened, by whom and where, with a link to the place', async () => {
    server([assigned, commented, mentioned])
    renderApp('/notifications')

    const [first, second, third] = (await screen.findAllByRole('listitem')) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ]

    expect(first).toHaveTextContent('Unread: Bob assigned you CHL-4 Write docs')
    expect(within(first).getByRole('link', { name: 'CHL-4 Write docs' })).toHaveAttribute(
      'href',
      `/projects/${project.id}?task=${task.id}`,
    )
    // The title of the assigned task is not repeated as an excerpt.
    expect(within(first).getAllByText(/Write docs/)).toHaveLength(1)
    expect(second).toHaveTextContent('Bob commented on CHL-4 Write docs')
    expect(second).toHaveTextContent('Looks good to me')
    expect(third).toHaveTextContent('Bob mentioned you in wiki page “Plan”')
    expect(third).not.toHaveTextContent('Unread')
    expect(within(third).getByRole('link', { name: 'wiki page “Plan”' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/wiki/${page.id}`,
    )
  })

  it('names a deleted user and falls back to the project', async () => {
    server([notification(1, { actor: null, task: null, type: 'mentioned', excerpt: '' })])
    renderApp('/notifications')

    const item = await screen.findByRole('listitem')

    expect(item).toHaveTextContent('Someone mentioned you in Chilla')
    expect(within(item).getByRole('link', { name: 'Chilla' })).toHaveAttribute(
      'href',
      `/projects/${project.id}`,
    )
  })

  it('marks everything as read', async () => {
    const calls = server([assigned, commented])
    const { user } = renderApp('/notifications')

    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }))

    await waitFor(() => expect(screen.queryByText('Unread:')).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Notifications' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
    expect(calls.find((call) => call.key === 'POST /api/notifications/read')?.body).toEqual({})
  })

  it('marks a notification as read when it is opened', async () => {
    const calls = server([assigned, commented])
    const { user } = renderApp('/notifications')
    const [first] = await screen.findAllByRole('link', { name: 'CHL-4 Write docs' })

    await user.click(first as HTMLElement)

    await waitFor(() =>
      expect(calls.find((call) => call.key === 'POST /api/notifications/read')?.body).toEqual({
        ids: [assigned.id],
      }),
    )
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
  })

  it('explains an empty list and reports a failure', async () => {
    server([])
    const first = renderApp('/notifications')
    expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark all as read' })).toBeDisabled()
    first.unmount()

    server([], { 'GET /api/notifications': () => apiError(500, 'INTERNAL', 'Boom') })
    renderApp('/notifications')

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
