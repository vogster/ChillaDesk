import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ann,
  apiError,
  bob,
  makeMember,
  makeProject,
  mockApi,
  noContent,
  ok,
  renderApp,
  type ApiRoutes,
} from '../test/render'

const project = makeProject()
const projectUrl = `/api/projects/${project.id}`

const signedIn = (routes: ApiRoutes): ApiRoutes => ({
  'GET /api/auth/me': () => ok(ann),
  ...routes,
})

describe('projects list', () => {
  it('shows the projects of the user', async () => {
    mockApi(
      signedIn({
        'GET /api/projects': () =>
          ok([project, makeProject({ id: bob.id, name: 'Other', key: 'OTH' })]),
      }),
    )

    renderApp('/')

    const link = await screen.findByRole('link', { name: /CHL/ })
    expect(link).toHaveAttribute('href', `/projects/${project.id}`)
    expect(within(link).getByText('CHL')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Other/ })).toBeInTheDocument()
  })

  it('shows a load error', async () => {
    mockApi(
      signedIn({
        'GET /api/projects': () => apiError(500, 'INTERNAL_ERROR', 'Internal server error'),
      }),
    )

    renderApp('/')

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error')
  })

  it('creates a project, uppercasing the key, and opens it', async () => {
    const calls = mockApi(
      signedIn({
        'GET /api/projects': () => ok([]),
        'POST /api/projects': () => ok(project, 201),
        [`GET ${projectUrl}`]: () => ok(project),
        [`GET ${projectUrl}/members`]: () => ok([makeMember(ann, 'owner')]),
        [`GET ${projectUrl}/invites`]: () => ok([]),
      }),
    )
    const { user } = renderApp('/')

    await user.click(await screen.findByRole('button', { name: 'New project' }))
    await user.type(screen.getByLabelText('Name'), 'Chilla')
    await user.type(screen.getByLabelText('Key'), 'chl')
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    expect(await screen.findByRole('heading', { name: 'Chilla', level: 1 })).toBeInTheDocument()
    expect(calls.find((call) => call.key === 'POST /api/projects')?.body).toEqual({
      name: 'Chilla',
      key: 'CHL',
      description: '',
    })
  })

  it('validates the new project form and can be cancelled', async () => {
    const calls = mockApi(signedIn({ 'GET /api/projects': () => ok([]) }))
    const { user } = renderApp('/')

    await user.click(await screen.findByRole('button', { name: 'New project' }))
    await user.type(screen.getByLabelText('Key'), '1')
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    expect(screen.getByLabelText('Name')).toBeInvalid()
    expect(screen.getByLabelText('Key')).toBeInvalid()
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Key')).not.toBeInTheDocument()
  })

  it('shows a conflict when the key is taken', async () => {
    mockApi(
      signedIn({
        'GET /api/projects': () => ok([]),
        'POST /api/projects': () => apiError(409, 'CONFLICT', 'Project key "CHL" is already taken'),
      }),
    )
    const { user } = renderApp('/')

    await user.click(await screen.findByRole('button', { name: 'New project' }))
    await user.type(screen.getByLabelText('Name'), 'Chilla')
    await user.type(screen.getByLabelText('Key'), 'CHL')
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('already taken')
  })
})

describe('project page', () => {
  const ownerRoutes = (extra: ApiRoutes = {}) =>
    signedIn({
      [`GET ${projectUrl}`]: () => ok(project),
      [`GET ${projectUrl}/members`]: () =>
        ok([makeMember(ann, 'owner'), makeMember(bob, 'member')]),
      [`GET ${projectUrl}/invites`]: () => ok([]),
      ...extra,
    })

  it('shows a not-found page for a project the user cannot see', async () => {
    mockApi(signedIn({}))

    renderApp(`/projects/${project.id}`)

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('shows other load errors as they are', async () => {
    mockApi(
      signedIn({
        [`GET ${projectUrl}`]: () => apiError(500, 'INTERNAL_ERROR', 'Internal server error'),
      }),
    )

    renderApp(`/projects/${project.id}`)

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error')
  })

  it('lets an owner add a member', async () => {
    const calls = mockApi(
      ownerRoutes({ [`POST ${projectUrl}/members`]: () => ok(makeMember(bob, 'viewer'), 201) }),
    )
    const { user } = renderApp(`/projects/${project.id}/members`)

    await user.type(await screen.findByLabelText('Add a member by email'), 'bob@example.com')
    await user.selectOptions(screen.getByLabelText('Role'), 'viewer')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(calls.find((call) => call.key === `POST ${projectUrl}/members`)?.body).toEqual({
        email: 'bob@example.com',
        role: 'viewer',
      }),
    )
    await waitFor(() => expect(screen.getByLabelText('Add a member by email')).toHaveValue(''))
  })

  it('validates the member email and shows server errors', async () => {
    mockApi(
      ownerRoutes({
        [`POST ${projectUrl}/members`]: () =>
          apiError(404, 'NOT_FOUND', 'User with this email not found'),
      }),
    )
    const { user } = renderApp(`/projects/${project.id}/members`)

    await user.type(await screen.findByLabelText('Add a member by email'), 'nope')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(screen.getByLabelText('Add a member by email')).toBeInvalid()

    await user.clear(screen.getByLabelText('Add a member by email'))
    await user.type(screen.getByLabelText('Add a member by email'), 'ghost@example.com')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('User with this email not found')
  })

  it('lets an owner change a role and remove a member', async () => {
    const calls = mockApi(
      ownerRoutes({
        [`PATCH ${projectUrl}/members/${bob.id}`]: () => ok(makeMember(bob, 'viewer')),
        [`DELETE ${projectUrl}/members/${bob.id}`]: noContent,
      }),
    )
    const { user } = renderApp(`/projects/${project.id}/members`)

    await user.selectOptions(await screen.findByLabelText('Role of Bob'), 'viewer')
    await waitFor(() =>
      expect(calls.find((call) => call.key.startsWith('PATCH'))?.body).toEqual({ role: 'viewer' }),
    )

    await user.click(screen.getByRole('button', { name: 'Remove Bob' }))
    await waitFor(() =>
      expect(calls.some((call) => call.key === `DELETE ${projectUrl}/members/${bob.id}`)).toBe(
        true,
      ),
    )
  })

  it('lets an owner rename the project', async () => {
    const renamed = makeProject({ name: 'Renamed', updatedAt: '2026-02-02T00:00:00.000Z' })
    const calls = mockApi(ownerRoutes({ [`PATCH ${projectUrl}`]: () => ok(renamed) }))
    const { user } = renderApp(`/projects/${project.id}/settings`)

    const name = await screen.findByLabelText('Name')
    await user.clear(name)
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByLabelText('Name')).toBeInvalid()

    await user.type(screen.getByLabelText('Name'), 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('heading', { name: 'Renamed', level: 1 })).toBeInTheDocument()
    expect(calls.find((call) => call.key === `PATCH ${projectUrl}`)?.body).toEqual({
      name: 'Renamed',
      description: 'Project tracker',
    })
  })

  it('asks for confirmation before deleting the project', async () => {
    const calls = mockApi(
      ownerRoutes({ [`DELETE ${projectUrl}`]: noContent, 'GET /api/projects': () => ok([]) }),
    )
    const { user } = renderApp(`/projects/${project.id}/settings`)

    await user.click(await screen.findByRole('button', { name: 'Delete project…' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Delete project…' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
    expect(calls.some((call) => call.key === `DELETE ${projectUrl}`)).toBe(true)
  })

  it('gives a member a read-only view with the option to leave', async () => {
    const calls = mockApi(
      signedIn({
        [`GET ${projectUrl}`]: () => ok(makeProject({ role: 'member' })),
        [`GET ${projectUrl}/members`]: () =>
          ok([makeMember(bob, 'owner'), makeMember(ann, 'member')]),
        [`DELETE ${projectUrl}/members/${ann.id}`]: noContent,
        'GET /api/projects': () => ok([]),
      }),
    )
    const { user } = renderApp(`/projects/${project.id}/members`)

    expect(await screen.findByText('(you)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Role of Bob')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove Bob' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Add a member by email')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Leave project' }))

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
    expect(calls.some((call) => call.key === `DELETE ${projectUrl}/members/${ann.id}`)).toBe(true)
  })
})

describe('member list stays in sync', () => {
  // A small in-memory server, so the tests see what a refetch would really return.
  function memberServer() {
    let ownRole: 'owner' | 'member' = 'owner'
    let members = [makeMember(ann, 'owner'), makeMember(bob, 'owner')]
    return signedIn({
      [`GET ${projectUrl}`]: () => ok(makeProject({ role: ownRole })),
      [`GET ${projectUrl}/members`]: () => ok(members),
      [`GET ${projectUrl}/invites`]: () => ok([]),
      [`POST ${projectUrl}/members`]: (body) => {
        const { email } = body as { email: string }
        if (email !== 'cat@example.com') {
          return apiError(404, 'NOT_FOUND', 'User with this email not found')
        }
        const cat = makeMember({ ...bob, id: project.id, email, name: 'Cat' }, 'member')
        members = [...members, cat]
        return ok(cat, 201)
      },
      [`PATCH ${projectUrl}/members/${ann.id}`]: (body) => {
        ownRole = (body as { role: 'member' }).role
        members = members.map((member) =>
          member.userId === ann.id ? { ...member, role: ownRole } : member,
        )
        return ok(makeMember(ann, ownRole))
      },
      [`DELETE ${projectUrl}/members/${bob.id}`]: () => {
        members = members.filter((member) => member.userId !== bob.id)
        return noContent()
      },
    })
  }

  it('shows a newly added member and no longer shows a removed one', async () => {
    mockApi(memberServer())
    const { user } = renderApp(`/projects/${project.id}/members`)

    await user.type(await screen.findByLabelText('Add a member by email'), 'cat@example.com')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('Cat')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Bob' }))
    await waitFor(() => expect(screen.queryByText('Bob')).not.toBeInTheDocument())
  })

  it('says an invitation went out on a server that sends email', async () => {
    let invitesRead = 0
    mockApi({
      ...memberServer(),
      'GET /api/auth/options': () => ok({ registrationEnabled: true, emailEnabled: true }),
      [`GET ${projectUrl}/invites`]: () => {
        invitesRead += 1
        return ok([])
      },
      [`POST ${projectUrl}/members`]: () => ok({ invited: true }, 202),
    })
    const { user } = renderApp(`/projects/${project.id}/members`)

    const field = await screen.findByLabelText('Add a member by email')
    expect(
      await screen.findByText('They get an invite link by email and join when they open it'),
    ).toBeInTheDocument()
    const before = invitesRead
    await user.type(field, 'dan@example.com')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Invitation sent to dan@example.com. It works for a week.',
    )
    // The new link shows up among the invite links.
    await waitFor(() => expect(invitesRead).toBeGreaterThan(before))
  })

  it('replaces an old error once a later action succeeds', async () => {
    mockApi(memberServer())
    const { user } = renderApp(`/projects/${project.id}/members`)

    await user.type(await screen.findByLabelText('Add a member by email'), 'ghost@example.com')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('User with this email not found')

    await user.click(screen.getByRole('button', { name: 'Remove Bob' }))

    await waitFor(() => expect(screen.queryByText('Bob')).not.toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('hides owner controls as soon as the user gives up the owner role', async () => {
    mockApi(memberServer())
    const { user } = renderApp(`/projects/${project.id}/members`, { staleTime: 30_000 })

    await user.selectOptions(await screen.findByLabelText('Role of Ann'), 'member')

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument(),
    )
    expect(screen.queryByLabelText('Role of Bob')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Add a member by email')).not.toBeInTheDocument()
  })
})

describe('cached pages', () => {
  it('confirms a saved change', async () => {
    mockApi(
      signedIn({
        [`GET ${projectUrl}`]: () => ok(project),
        [`GET ${projectUrl}/members`]: () => ok([makeMember(ann, 'owner')]),
        [`PATCH ${projectUrl}`]: () =>
          ok(makeProject({ description: 'Updated', updatedAt: '2026-03-03T00:00:00.000Z' })),
      }),
    )
    const { user } = renderApp(`/projects/${project.id}/settings`)

    await user.type(await screen.findByLabelText('Description'), ' more')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
  })

  it('removes a project from the list right after the user leaves it', async () => {
    let left = false
    mockApi(
      signedIn({
        'GET /api/projects': () => ok(left ? [] : [makeProject({ role: 'member' })]),
        [`GET ${projectUrl}`]: () => ok(makeProject({ role: 'member' })),
        [`GET ${projectUrl}/members`]: () =>
          ok([makeMember(bob, 'owner'), makeMember(ann, 'member')]),
        [`DELETE ${projectUrl}/members/${ann.id}`]: () => {
          left = true
          return noContent()
        },
      }),
    )
    const { user } = renderApp('/', { staleTime: 30_000 })

    await user.click(await screen.findByRole('link', { name: /CHL/ }))
    await user.click(await screen.findByRole('link', { name: 'Members' }))
    await user.click(await screen.findByRole('button', { name: 'Leave project' }))

    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
  })
})
