import type { ProjectInvite } from '@chilladesk/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ann,
  apiError,
  makeMember,
  makeProject,
  mockApi,
  noContent,
  ok,
  renderApp,
  session,
  signedOut,
  type ApiRoutes,
} from '../test/render'

const project = makeProject()
const url = `/api/projects/${project.id}`
const TOKEN = 'invite-token-123'

const invite = (number: number, overrides: Partial<ProjectInvite> = {}): ProjectInvite => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, '0')}`,
  role: 'member',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-08T00:00:00.000Z',
  ...overrides,
})

/** An in-memory list of invites, so creating and revoking show up on the next read. */
function membersServer(role: 'owner' | 'member' = 'owner', initial: ProjectInvite[] = []) {
  let invites = initial
  const calls = mockApi({
    'GET /api/auth/me': () => ok(ann),
    [`GET ${url}`]: () => ok(makeProject({ role })),
    [`GET ${url}/members`]: () => ok([makeMember(ann, role)]),
    [`GET ${url}/invites`]: () => ok(invites),
    [`POST ${url}/invites`]: (body) => {
      const created = invite(invites.length + 1, body as Partial<ProjectInvite>)
      invites = [...invites, created]
      return ok({ ...created, token: TOKEN }, 201)
    },
    ...Object.fromEntries(
      initial.map((item) => [
        `DELETE ${url}/invites/${item.id}`,
        () => {
          invites = invites.filter((other) => other.id !== item.id)
          return noContent()
        },
      ]),
    ),
  })
  return calls
}

describe('invite links on the members page', () => {
  it('creates a link for the chosen role and shows it once, ready to copy', async () => {
    const calls = membersServer()
    const writeText = vi.fn().mockResolvedValue(undefined)
    const { user } = renderApp(`/projects/${project.id}/members`)
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText)

    await user.selectOptions(await screen.findByLabelText('Join as'), 'viewer')
    await user.click(screen.getByRole('button', { name: 'Create invite link' }))

    const link = await screen.findByLabelText('Invite link')
    expect(link).toHaveValue(`${window.location.origin}/invite#token=${TOKEN}`)
    expect(calls.find((call) => call.key === `POST ${url}/invites`)?.body).toEqual({
      role: 'viewer',
    })
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/invite#token=${TOKEN}`)
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Open invite links' })
    expect(within(list).getByText('Viewer')).toBeInTheDocument()
  })

  it('lists the open links and revokes one', async () => {
    membersServer('owner', [invite(1), invite(2, { role: 'viewer' })])
    const { user } = renderApp(`/projects/${project.id}/members`)
    const list = await screen.findByRole('list', { name: 'Open invite links' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(2)

    await user.click(within(list).getByRole('button', { name: /Revoke the Viewer link/ }))

    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(1))
    expect(within(list).getByText('Member')).toBeInTheDocument()
  })

  it('is not offered to someone who is not an owner', async () => {
    const calls = membersServer('member')
    renderApp(`/projects/${project.id}/members`)

    await screen.findByRole('heading', { name: 'Members' })

    expect(screen.queryByText('Invite links')).not.toBeInTheDocument()
    expect(calls.some((call) => call.key.endsWith('/invites'))).toBe(false)
  })
})

describe('opening an invite link', () => {
  const preview = (alreadyMember = false) => ({
    project: { id: project.id, key: project.key, name: project.name },
    role: 'viewer',
    alreadyMember,
  })
  const signedIn = (routes: ApiRoutes) =>
    mockApi({ 'GET /api/auth/me': () => ok(ann), 'GET /api/projects': () => ok([]), ...routes })

  it('says what the invitation is for and joins the project', async () => {
    const calls = signedIn({
      'POST /api/invites/preview': () => ok(preview()),
      'POST /api/invites/accept': () => ok(makeProject({ role: 'viewer' })),
      [`GET ${url}`]: () => ok(makeProject({ role: 'viewer' })),
    })
    const { user } = renderApp(`/invite#token=${TOKEN}`)

    expect(
      await screen.findByText('You are invited to join the project “Chilla” as Viewer.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Join the project' }))

    expect(await screen.findByRole('heading', { name: 'Chilla' })).toBeInTheDocument()
    expect(calls.find((call) => call.key === 'POST /api/invites/accept')?.body).toEqual({
      token: TOKEN,
    })
    // The token went in the body of the request, not in its address.
    expect(calls.some((call) => call.key.includes(TOKEN))).toBe(false)
  })

  it('offers to open the project to someone who is in it already', async () => {
    signedIn({ 'POST /api/invites/preview': () => ok(preview(true)) })
    renderApp(`/invite#token=${TOKEN}`)

    expect(await screen.findByText('You are already in the project “Chilla”.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open the project' })).toHaveAttribute(
      'href',
      `/projects/${project.id}`,
    )
    expect(screen.queryByRole('button', { name: 'Join the project' })).not.toBeInTheDocument()
  })

  it('explains a link that does not work any more', async () => {
    signedIn({
      'POST /api/invites/preview': () =>
        apiError(404, 'NOT_FOUND', 'This invite link is not valid any more'),
    })
    renderApp(`/invite#token=${TOKEN}`)

    expect(await screen.findByText(/does not work any more/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says so when the link has no token at all', async () => {
    const calls = signedIn({})
    renderApp('/invite')

    expect(await screen.findByText(/does not work any more/)).toBeInTheDocument()
    expect(calls.some((call) => call.key.includes('/invites/'))).toBe(false)
  })

  it('reports a failure to join', async () => {
    signedIn({
      'POST /api/invites/preview': () => ok(preview()),
      'POST /api/invites/accept': () => apiError(429, 'RATE_LIMITED', 'Slow down'),
    })
    const { user } = renderApp(`/invite#token=${TOKEN}`)

    await user.click(await screen.findByRole('button', { name: 'Join the project' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Slow down')
  })

  it('asks a visitor to log in first and then brings them back to the invitation', async () => {
    let signedInNow = false
    mockApi({
      'GET /api/auth/me': () => (signedInNow ? ok(ann) : signedOut()),
      'POST /api/auth/login': () => {
        signedInNow = true
        return ok(session(ann))
      },
      'POST /api/invites/preview': () => ok(preview()),
    })
    const { user } = renderApp(`/invite#token=${TOKEN}`)

    await user.type(await screen.findByLabelText('Email'), 'ann@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('heading', { name: 'Invitation' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Join the project' })).toBeInTheDocument()
  })
})

describe('a server that signs people up by invitation only', () => {
  const inviteOnly = { registrationEnabled: false, registration: 'invite', emailEnabled: false }

  it('offers no sign-up to someone who came without an invite', async () => {
    mockApi({
      'GET /api/auth/me': () => signedOut(),
      'GET /api/auth/options': () => ok(inviteOnly),
    })
    renderApp('/login')

    expect(await screen.findByText(/Signing up is by invitation only/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Sign up' })).not.toBeInTheDocument()
  })

  it('lets someone with an invite link sign up, bringing the invite along', async () => {
    let signedInNow = false
    const calls = mockApi({
      'GET /api/auth/me': () => (signedInNow ? ok(ann) : signedOut()),
      'GET /api/auth/options': () => ok(inviteOnly),
      'POST /api/auth/register': () => {
        signedInNow = true
        return ok(session(ann), 201)
      },
      'POST /api/invites/preview': () =>
        ok({
          project: { id: project.id, key: project.key, name: project.name },
          role: 'member',
          alreadyMember: true,
        }),
    })
    const { user } = renderApp(`/invite#token=${TOKEN}`)

    await user.click(await screen.findByRole('link', { name: 'Sign up' }))
    await user.type(await screen.findByLabelText('Name'), 'Ann')
    await user.type(screen.getByLabelText('Email'), 'ann@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    // Back on the invite, already in the project the sign-up joined.
    expect(await screen.findByRole('heading', { name: 'Invitation' })).toBeInTheDocument()
    expect(calls.find((call) => call.key === 'POST /api/auth/register')?.body).toMatchObject({
      inviteToken: TOKEN,
    })
  })

  it('tells someone on the sign-up page without an invite how to get in', async () => {
    mockApi({
      'GET /api/auth/me': () => signedOut(),
      'GET /api/auth/options': () => ok(inviteOnly),
    })
    renderApp('/register')

    expect(await screen.findByText(/Signing up is by invitation only/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign up' })).not.toBeInTheDocument()
  })
})
