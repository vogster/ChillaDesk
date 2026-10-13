import type { ApiToken } from '@chilladesk/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ann, apiError, mockApi, noContent, ok, renderApp, type ApiRoutes } from '../test/render'

const TIMESTAMP = '2026-01-01T00:00:00.000Z'
const SECRET = 'cw_pat_test-secret-value'

const token = (number: number, overrides: Partial<ApiToken> = {}): ApiToken => ({
  id: `88888888-8888-4888-8888-${String(number).padStart(12, '0')}`,
  name: `Token ${number}`,
  scope: 'read',
  lastUsedAt: null,
  expiresAt: null,
  createdAt: TIMESTAMP,
  ...overrides,
})

function server(initial: ApiToken[] = [], extra: ApiRoutes = {}) {
  let tokens = initial
  const routes: ApiRoutes = {
    'GET /api/auth/me': () => ok(ann),
    'GET /api/projects': () => ok([]),
    'GET /api/tokens': () => ok(tokens),
    'POST /api/tokens': (body) => {
      const input = body as { name: string; scope: ApiToken['scope']; expiresInDays: number | null }
      const created = token(tokens.length + 1, {
        name: input.name,
        scope: input.scope,
        expiresAt: input.expiresInDays ? '2030-06-01T00:00:00.000Z' : null,
      })
      tokens = [created, ...tokens]
      routes[`DELETE /api/tokens/${created.id}`] = () => {
        tokens = tokens.filter((item) => item.id !== created.id)
        return noContent()
      }
      return ok({ ...created, token: SECRET }, 201)
    },
    ...extra,
  }
  for (const existing of initial) {
    routes[`DELETE /api/tokens/${existing.id}`] = () => {
      tokens = tokens.filter((item) => item.id !== existing.id)
      return noContent()
    }
  }
  const calls = mockApi(routes)
  return { calls, bodyOf: (key: string) => calls.findLast((call) => call.key === key)?.body }
}

describe('API tokens page', () => {
  it('is reachable from the header', async () => {
    server()
    const { user } = renderApp('/')

    await user.click(await screen.findByRole('link', { name: 'API tokens' }))

    expect(await screen.findByRole('heading', { name: 'API tokens' })).toBeInTheDocument()
    expect(await screen.findByText('You have no tokens yet.')).toBeInTheDocument()
  })

  it('lists tokens with their access, expiry and last use', async () => {
    server([
      token(1, { name: 'Laptop', scope: 'write', lastUsedAt: '2026-03-05T10:00:00.000Z' }),
      token(2, { name: 'Old script', expiresAt: '2020-01-01T00:00:00.000Z' }),
    ])
    renderApp('/tokens')

    const laptop = (await screen.findByText('Laptop')).closest('li') as HTMLElement
    const old = screen.getByText('Old script').closest('li') as HTMLElement
    expect(laptop).toHaveTextContent(/Read and write · No expiry · Last used .*2026/)
    expect(old).toHaveTextContent(/Read only · Expired .*2020.* · Never used/)
  })

  it('creates a token and shows it once with a ready MCP configuration', async () => {
    const { bodyOf } = server()
    const { user } = renderApp('/tokens')

    await user.type(await screen.findByLabelText('Name'), 'Claude')
    await user.selectOptions(screen.getByLabelText('Access'), 'Read and write')
    await user.selectOptions(screen.getByLabelText('Expires'), '1 year')
    await user.click(screen.getByRole('button', { name: 'Create token' }))

    expect(await screen.findByLabelText('New API token')).toHaveTextContent(SECRET)
    expect(bodyOf('POST /api/tokens')).toEqual({
      name: 'Claude',
      scope: 'write',
      expiresInDays: 365,
    })
    const config = JSON.parse(screen.getByLabelText('MCP client configuration').textContent ?? '')
    expect(config.mcpServers.chilladesk).toEqual({
      type: 'http',
      url: `${window.location.origin}/api/mcp`,
      headers: { Authorization: `Bearer ${SECRET}` },
    })
    expect(await screen.findByText('Claude')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('')

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()
  })

  it('defaults to a read-only token that expires and can make one that never does', async () => {
    const { bodyOf } = server()
    const { user } = renderApp('/tokens')

    await user.type(await screen.findByLabelText('Name'), 'Reader')
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    await screen.findByLabelText('New API token')
    expect(bodyOf('POST /api/tokens')).toEqual({ name: 'Reader', scope: 'read', expiresInDays: 90 })

    // user-event does not notice form.reset(), so the field is cleared the way a user would.
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Forever')
    await user.selectOptions(screen.getByLabelText('Expires'), 'Never')
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    await waitFor(() =>
      expect(bodyOf('POST /api/tokens')).toEqual({
        name: 'Forever',
        scope: 'read',
        expiresInDays: null,
      }),
    )
  })

  it('copies the token to the clipboard', async () => {
    server()
    const { user } = renderApp('/tokens')
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()

    await user.type(await screen.findByLabelText('Name'), 'Claude')
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    await user.click(await screen.findByRole('button', { name: 'Copy token' }))

    expect(writeText).toHaveBeenCalledWith(SECRET)
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('requires a name and reports a server refusal', async () => {
    const { calls } = server([], {
      'POST /api/tokens': () => apiError(409, 'CONFLICT', 'You can have at most 50 tokens.'),
    })
    const { user } = renderApp('/tokens')

    await user.click(await screen.findByRole('button', { name: 'Create token' }))
    expect(screen.getByLabelText('Name')).toBeInvalid()
    expect(screen.getByLabelText('Name')).toHaveFocus()
    expect(calls.some((call) => call.key === 'POST /api/tokens')).toBe(false)

    await user.type(screen.getByLabelText('Name'), 'One more')
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('at most 50 tokens')
  })

  it('revokes a token, hiding its secret if it was still on screen', async () => {
    server([token(1, { name: 'Laptop' })])
    const { user } = renderApp('/tokens')

    await user.type(await screen.findByLabelText('Name'), 'Fresh')
    await user.click(screen.getByRole('button', { name: 'Create token' }))
    await screen.findByLabelText('New API token')

    await user.click(screen.getByRole('button', { name: 'Revoke Fresh' }))
    await waitFor(() => expect(screen.queryByText('Fresh')).not.toBeInTheDocument())
    expect(screen.queryByText(SECRET)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Revoke Laptop' }))
    expect(await screen.findByText('You have no tokens yet.')).toBeInTheDocument()
    expect(within(screen.getByRole('main')).queryByRole('listitem')).not.toBeInTheDocument()
  })

  it('shows a load error', async () => {
    server([], {
      'GET /api/tokens': () => apiError(500, 'INTERNAL_ERROR', 'Internal server error'),
    })
    renderApp('/tokens')

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error')
  })
})
