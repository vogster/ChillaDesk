import type { Project, ProjectMember, User } from '@chillawiki/shared'
import { QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import { App } from '../App'
import { createQueryClient } from '../queryClient'

type Handler = (body: unknown) => { status: number; body?: unknown }

/** Routes keyed by `"METHOD /api/path"`; anything else answers 404 like the real API. */
export type ApiRoutes = Record<string, Handler>

export interface RecordedCall {
  key: string
  body: unknown
}

export function mockApi(routes: ApiRoutes): RecordedCall[] {
  const calls: RecordedCall[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ key, body })

    const handler = routes[key]
    const result = handler
      ? handler(body)
      : { status: 404, body: { error: { code: 'NOT_FOUND', message: `No mock for ${key}` } } }
    return new Response(result.body === undefined ? null : JSON.stringify(result.body), {
      status: result.status,
    })
  })
  return calls
}

export const ok = (body: unknown, status = 200) => ({ status, body })
export const noContent = () => ({ status: 204 })
export const apiError = (status: number, code: string, message: string) => ({
  status,
  body: { error: { code, message } },
})
export const signedOut = () => apiError(401, 'UNAUTHENTICATED', 'Authentication required')

/** `staleTime` mirrors production when a test is about what stays cached between pages. */
export function renderApp(path = '/', { staleTime = 0 }: { staleTime?: number } = {}) {
  const queryClient = createQueryClient({
    queries: { retry: false, staleTime },
    mutations: { retry: false },
  })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...view, user: userEvent.setup() }
}

const TIMESTAMP = '2026-01-01T00:00:00.000Z'

export const ann: User = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ann@example.com',
  name: 'Ann',
  createdAt: TIMESTAMP,
}

export const bob: User = {
  id: '22222222-2222-4222-8222-222222222222',
  email: 'bob@example.com',
  name: 'Bob',
  createdAt: TIMESTAMP,
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    key: 'CHL',
    name: 'Chilla',
    description: 'Project tracker',
    role: 'owner',
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
    ...overrides,
  }
}

export function makeMember(user: User, role: ProjectMember['role']): ProjectMember {
  return { userId: user.id, email: user.email, name: user.name, role, joinedAt: TIMESTAMP }
}

export const session = (user: User) => ({ user, token: 'test-token', expiresAt: TIMESTAMP })
