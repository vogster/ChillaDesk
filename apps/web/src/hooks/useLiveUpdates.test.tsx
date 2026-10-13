import type { LiveResource } from '@chilladesk/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ann,
  apiError,
  doing,
  done,
  makeMember,
  makeProject,
  makeTask,
  mockApi,
  ok,
  renderApp,
  signedOut,
  todo,
} from '../test/render'
import { useLiveUpdates } from './useLiveUpdates'

/** Stands in for the browser's EventSource; tests push events through it. */
class FakeEventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onmessage: ((message: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  readyState = FakeEventSource.CONNECTING

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this)
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }

  /** The server answered the (re)connection with an error; the browser gives up. */
  fail(): void {
    this.readyState = FakeEventSource.CLOSED
    this.onerror?.()
  }
}

const project = makeProject()
const url = `/api/projects/${project.id}`
const changed = (resource: LiveResource = 'tasks') => ({
  type: 'project_changed',
  projectId: project.id,
  resource,
})

function server() {
  let tasks = [makeTask(1, { title: 'First task' })]
  let failing = false
  let lost = false
  const calls = mockApi({
    'GET /api/auth/me': () => ok(ann),
    'GET /api/projects': () => ok([project]),
    'GET /api/notifications': () => ok({ items: [], unreadCount: tasks.length - 1 }),
    [`GET ${url}`]: () =>
      lost
        ? apiError(404, 'NOT_FOUND', 'Project not found')
        : failing
          ? apiError(429, 'RATE_LIMITED', 'Slow down')
          : ok(project),
    [`GET ${url}/members`]: () => ok([makeMember(ann, 'owner')]),
    [`GET ${url}/statuses`]: () => ok([todo, doing, done]),
    [`GET ${url}/labels`]: () => ok([]),
    [`GET ${url}/tasks`]: () => ok({ items: tasks, total: tasks.length }),
  })
  return {
    calls,
    /** What a colleague does meanwhile. */
    addTask: (title: string) => {
      tasks = [...tasks, makeTask(tasks.length + 1, { title })]
    },
    failProject: () => {
      failing = true
    },
    /** The project is deleted, or the user is removed from it. */
    loseAccess: () => {
      lost = true
    },
    count: (key: string) => calls.filter((call) => call.key === key).length,
  }
}

function countsOf(api: ReturnType<typeof server>) {
  const names = ['', '/members', '/statuses', '/labels', '/tasks']
  return Object.fromEntries(
    names.map((name) => [name.slice(1) || 'project', api.count(`GET ${url}${name}`)]),
  )
}

const stream = () => FakeEventSource.instances.at(-1) as FakeEventSource
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function setHidden(hidden: boolean) {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden)
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  FakeEventSource.instances = []
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('live updates in the app', () => {
  it('shows what a colleague added without a reload, and updates the bell', async () => {
    const api = server()
    renderApp(`/projects/${project.id}`)
    expect(await screen.findByText('First task')).toBeInTheDocument()
    expect(stream().url).toBe('/api/events')

    api.addTask('Added by Bob')
    stream().emit(changed())

    expect(await screen.findByText('Added by Bob')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Notifications, 1 unread' })).toBeInTheDocument()
  })

  it('reloads only what the change touched', async () => {
    const api = server()
    renderApp(`/projects/${project.id}`)
    await screen.findByText('First task')
    const before = countsOf(api)

    stream().emit(changed('tasks'))

    await waitFor(() => expect(api.count(`GET ${url}/tasks`)).toBe((before.tasks ?? 0) + 1))
    await pause(100)
    expect(countsOf(api)).toEqual({ ...before, tasks: (before.tasks ?? 0) + 1 })
  })

  it('ignores events it does not understand', async () => {
    const api = server()
    renderApp(`/projects/${project.id}`)
    await screen.findByText('First task')
    const before = api.calls.length

    stream().emit('not json')
    stream().emit({ type: 'something_new', projectId: project.id, resource: 'tasks' })
    stream().emit({ type: 'project_changed', projectId: 'not-a-uuid', resource: 'tasks' })
    stream().emit({ type: 'project_changed', projectId: project.id, resource: 'unknown' })
    await pause(300)

    expect(api.calls.length).toBe(before)
  })

  it('keeps the project on screen when a background reload of it fails', async () => {
    const api = server()
    renderApp(`/projects/${project.id}`)
    await screen.findByText('First task')

    api.failProject()
    stream().emit(changed('project'))

    await waitFor(() => expect(api.count(`GET ${url}`)).toBeGreaterThan(1))
    await pause(100)
    expect(screen.getByText('First task')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('takes a project off the screen when access to it is lost', async () => {
    const api = server()
    renderApp(`/projects/${project.id}`)
    await screen.findByText('First task')

    api.loseAccess()
    stream().emit({ type: 'access_changed' })

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.queryByText('First task')).not.toBeInTheDocument()
  })

  it('only listens while signed in and closes the stream on leaving', async () => {
    mockApi({ 'GET /api/auth/me': () => signedOut() })
    const guest = renderApp('/login')
    await screen.findByRole('heading', { name: /log in|sign in/i })
    expect(FakeEventSource.instances).toHaveLength(0)
    guest.unmount()

    server()
    const member = renderApp('/')
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1))
    member.unmount()

    expect(stream().readyState).toBe(FakeEventSource.CLOSED)
  })

  it('works without live updates where the browser has no EventSource', async () => {
    vi.stubGlobal('EventSource', undefined)
    server()
    renderApp(`/projects/${project.id}`)

    expect(await screen.findByText('First task')).toBeInTheDocument()
  })
})

describe('the live connection', () => {
  function setup(timing = { minIntervalMs: 150, retryBaseMs: 20, retryMaxMs: 40 }) {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const hook = renderHook(() => useLiveUpdates(timing), { wrapper })
    /** Reloads of the task queries; each refresh makes exactly one. */
    const refreshes = () =>
      invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.[2] === 'tasks').length
    return { queryClient, invalidate, refreshes, ...hook }
  }

  it('answers a burst with one reload and holds the next back for a while', async () => {
    const minIntervalMs = 400
    const { invalidate, refreshes } = setup({ minIntervalMs, retryBaseMs: 20, retryMaxMs: 40 })
    // When each reload of the tasks happened, so the test does not depend on its own pace.
    const times: number[] = []
    const original = invalidate.getMockImplementation()
    invalidate.mockImplementation((...args) => {
      if (args[0]?.queryKey?.[2] === 'tasks') times.push(Date.now())
      return original ? original(...args) : Promise.resolve()
    })

    for (let index = 0; index < 5; index += 1) stream().emit(changed())
    await waitFor(() => expect(refreshes()).toBe(1))
    stream().emit(changed())
    stream().emit(changed())
    await waitFor(() => expect(refreshes()).toBe(2))

    const [first = 0, second = 0] = times
    // Timers may run late but never early; a few milliseconds allow for clock rounding.
    expect(second - first).toBeGreaterThanOrEqual(minIntervalMs - 20)
  })

  it('leaves the board alone while a card is on its way to the server', async () => {
    const { queryClient, invalidate } = setup()
    vi.spyOn(queryClient, 'isMutating').mockReturnValue(1)

    stream().emit(changed('statuses'))

    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey)
    expect(keys).toContainEqual(['projects', project.id, 'statuses'])
    expect(keys).not.toContainEqual(['projects', project.id, 'tasks'])
  })

  it('checks everything again after the connection came back, not on the first open', () => {
    const { invalidate } = setup()

    stream().onopen?.()
    expect(invalidate).not.toHaveBeenCalled()
    stream().onopen?.()

    expect(invalidate).toHaveBeenCalledExactlyOnceWith()
  })

  it('reconnects with growing waits when the server refuses the stream', async () => {
    setup()
    const first = stream()

    first.onerror?.()
    await pause(60)
    // Still connecting: the browser is retrying by itself.
    expect(FakeEventSource.instances).toHaveLength(1)

    first.fail()
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(2))
    stream().fail()
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(3))
  })

  it('closes the stream while the tab is hidden and catches up when it shows again', () => {
    const { invalidate, unmount } = setup()
    const first = stream()
    first.onopen?.()

    setHidden(true)
    expect(first.readyState).toBe(FakeEventSource.CLOSED)
    setHidden(false)

    expect(FakeEventSource.instances).toHaveLength(2)
    stream().onopen?.()
    expect(invalidate).toHaveBeenCalledExactlyOnceWith()

    unmount()
    setHidden(true)
    setHidden(false)
    expect(FakeEventSource.instances).toHaveLength(2)
  })

  it('does not connect in a tab that starts hidden, nor retry while hidden', async () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    setup()
    expect(FakeEventSource.instances).toHaveLength(0)

    setHidden(false)
    stream().fail()
    setHidden(true)
    await pause(80)

    expect(FakeEventSource.instances).toHaveLength(1)
  })
})
