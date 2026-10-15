import type { VersionInfo } from '@chilladesk/shared'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ann, makeProject, mockApi, ok, renderApp } from '../../test/render'

const info = (overrides: Partial<VersionInfo> = {}): VersionInfo => ({
  current: '0.3.0',
  latest: '0.4.0',
  updateAvailable: true,
  checking: true,
  checkedAt: '2026-10-15T10:00:00.000Z',
  releases: [{ version: '0.4.0', notes: '- **Gantt charts** for milestones' }],
  homepage: 'https://github.com/vogster/ChillaDesk',
  ...overrides,
})

function server(version: VersionInfo, role: 'owner' | 'member' = 'owner') {
  return mockApi({
    'GET /api/auth/me': () => ok(ann),
    'GET /api/projects': () => ok([makeProject({ role })]),
    'GET /api/notifications': () => ok({ items: [], unreadCount: 0 }),
    'GET /api/version': () => ok(version),
  })
}

describe('new versions', () => {
  it('are announced in the header to project owners, and lead to what is new', async () => {
    server(info())
    const { user } = renderApp('/')

    expect(await screen.findByText('ChillaDesk 0.3.0 · Version 0.4.0 is out')).toBeInTheDocument()
    const notice = await screen.findByRole('link', { name: 'Version 0.4.0 is out' })
    await user.click(notice)

    expect(await screen.findByRole('heading', { name: 'About ChillaDesk' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Version 0.4.0 is out.')
    expect(screen.getByRole('heading', { name: 'What is new' })).toBeInTheDocument()
    expect(screen.getByText('Gantt charts')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'How to update' })).toHaveAttribute(
      'href',
      'https://github.com/vogster/ChillaDesk#install',
    )
  })

  it('stop being announced in the header once put away, until the next one', async () => {
    server(info())
    const { user } = renderApp('/about')

    await user.click(
      await screen.findByRole('button', { name: 'Do not remind me about this version' }),
    )

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Version 0.4.0 is out' })).not.toBeInTheDocument(),
    )
  })

  it('are not announced in the header to people who own no project', async () => {
    server(info({ latest: '0.5.0', releases: [] }), 'member')
    renderApp('/')

    expect(await screen.findByText('ChillaDesk 0.3.0 · Version 0.5.0 is out')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Version 0.5.0 is out' })).not.toBeInTheDocument()
  })
})

describe('the about page', () => {
  it('says when the version is the latest, and shows its own notes', async () => {
    server(
      info({
        latest: '0.3.0',
        updateAvailable: false,
        releases: [{ version: '0.3.0', notes: '- Sign-up by invitation only' }],
      }),
    )
    renderApp('/about')

    expect(
      await screen.findByText('This is the latest version.', { exact: false }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'In this version' })).toBeInTheDocument()
    expect(screen.getByText('Sign-up by invitation only')).toBeInTheDocument()
  })

  it('says when the server does not look for new versions', async () => {
    server(
      info({
        latest: null,
        updateAvailable: false,
        checking: false,
        checkedAt: null,
        releases: [],
      }),
    )
    renderApp('/about')

    expect(await screen.findByText(/UPDATE_CHECK=false/)).toBeInTheDocument()
  })
})
