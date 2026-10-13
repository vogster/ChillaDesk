import type { Milestone, Project } from '@chilladesk/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ann,
  apiError,
  doing,
  done,
  makeMember,
  makeProject,
  makeTask,
  mockApi,
  noContent,
  ok,
  renderApp,
  todo,
  type ApiRoutes,
} from '../../../test/render'

const project = makeProject()
const url = `/api/projects/${project.id}`
const path = `/projects/${project.id}/milestones`

const milestone = (number: number, overrides: Partial<Milestone> = {}): Milestone => ({
  id: `ffffffff-ffff-4fff-8fff-${String(number).padStart(12, '0')}`,
  name: `Milestone ${number}`,
  dueDate: null,
  closed: false,
  progress: { done: 0, total: 0 },
  ...overrides,
})

/** An in-memory stand-in for the milestone endpoints. */
function server(initial: Milestone[], role: Project['role'] = 'owner', extra: ApiRoutes = {}) {
  let milestones = initial
  const routes: ApiRoutes = {
    'GET /api/auth/me': () => ok(ann),
    [`GET ${url}`]: () => ok(makeProject({ role })),
    [`GET ${url}/members`]: () => ok([makeMember(ann, role)]),
    [`GET ${url}/statuses`]: () => ok([todo, doing, done]),
    [`GET ${url}/labels`]: () => ok([]),
    [`GET ${url}/milestones`]: () => ok(milestones),
    [`POST ${url}/milestones`]: (body) => {
      const created = milestone(milestones.length + 1, body as Partial<Milestone>)
      milestones = [...milestones, created]
      return ok(created, 201)
    },
  }
  for (const existing of initial) {
    routes[`PATCH ${url}/milestones/${existing.id}`] = (body) => {
      const updated = { ...existing, ...(body as Partial<Milestone>) }
      milestones = milestones.map((item) => (item.id === existing.id ? updated : item))
      return ok(updated)
    }
    routes[`DELETE ${url}/milestones/${existing.id}`] = () => {
      milestones = milestones.filter((item) => item.id !== existing.id)
      return noContent()
    }
  }
  const calls = mockApi({ ...routes, ...extra })
  return { calls, bodyOf: (key: string) => calls.findLast((call) => call.key === key)?.body }
}

describe('the milestones page', () => {
  it('is a tab of the project and shows each milestone with its date and progress', async () => {
    server([
      milestone(1, { name: 'Beta', dueDate: '2030-05-17', progress: { done: 3, total: 4 } }),
      milestone(2, { name: 'Late', dueDate: '2020-01-01' }),
      milestone(3, { name: 'Shipped', closed: true, dueDate: '2020-01-01' }),
    ])
    const { user } = renderApp(`/projects/${project.id}`)

    await user.click(await screen.findByRole('link', { name: 'Milestones' }))

    const [beta, late, shipped] = (await screen.findAllByRole('listitem')) as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ]
    expect(beta).toHaveTextContent(/due .*2030/)
    expect(beta).toHaveTextContent('3 of 4 tasks done (75%)')
    expect(within(beta).getByRole('progressbar', { name: 'Progress of Beta' })).toHaveAttribute(
      'aria-valuenow',
      '75',
    )
    expect(within(beta).getByRole('link', { name: 'Beta' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/list?milestoneId=${milestone(1).id}`,
    )
    expect(late).toHaveTextContent(/was due .*2020/)
    expect(late).toHaveTextContent('No tasks on this milestone yet.')
    // A closed milestone is not late any more.
    expect(shipped).toHaveTextContent('closed')
    expect(shipped).not.toHaveTextContent('was due')
  })

  it('creates a milestone with a name and a date', async () => {
    const { bodyOf } = server([])
    const { user } = renderApp(path)
    expect(await screen.findByText(/No milestones yet/)).toBeInTheDocument()

    await user.type(screen.getByLabelText('Name'), 'Version 1')
    await user.type(screen.getByLabelText('Date'), '2030-06-01')
    await user.click(screen.getByRole('button', { name: 'Add milestone' }))

    expect(await screen.findByRole('link', { name: 'Version 1' })).toBeInTheDocument()
    expect(bodyOf(`POST ${url}/milestones`)).toEqual({ name: 'Version 1', dueDate: '2030-06-01' })
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })

  it('asks for a name and shows a taken one from the server', async () => {
    const { calls } = server([], 'owner', {
      [`POST ${url}/milestones`]: () =>
        apiError(409, 'CONFLICT', 'A milestone named "Beta" already exists'),
    })
    const { user } = renderApp(path)

    await user.click(await screen.findByRole('button', { name: 'Add milestone' }))
    expect(screen.getByLabelText('Name')).toBeInvalid()
    expect(calls.some((call) => call.key === `POST ${url}/milestones`)).toBe(false)

    await user.type(screen.getByLabelText('Name'), 'Beta')
    await user.click(screen.getByRole('button', { name: 'Add milestone' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })

  it('closes, reopens and deletes a milestone after asking', async () => {
    const { bodyOf, calls } = server([milestone(1, { name: 'Beta' })])
    const { user } = renderApp(path)
    const patchKey = `PATCH ${url}/milestones/${milestone(1).id}`

    await user.click(await screen.findByRole('button', { name: 'Close the milestone Beta' }))
    expect(await screen.findByRole('button', { name: 'Reopen the milestone Beta' })).toBeVisible()
    expect(bodyOf(patchKey)).toEqual({ closed: true })

    await user.click(screen.getByRole('button', { name: 'Delete the milestone Beta' }))
    expect(screen.getByText(/Its tasks stay/)).toBeInTheDocument()
    expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false)
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Beta' })).not.toBeInTheDocument(),
    )
  })

  it('is read-only for a viewer', async () => {
    server([milestone(1, { name: 'Beta' })], 'viewer')
    renderApp(path)

    expect(await screen.findByRole('link', { name: 'Beta' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toHaveTextContent(/Close|Delete|Add/)
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })
})

describe('milestones on tasks', () => {
  const beta = milestone(1, { name: 'Beta' })
  const old = milestone(2, { name: 'Old', closed: true })
  const task = makeTask(1, { title: 'Ship it', milestone: { id: old.id, name: old.name } })

  function taskServer(extra: ApiRoutes = {}) {
    return server([beta, old, milestone(3, { name: 'Closed other', closed: true })], 'owner', {
      [`GET ${url}/tasks`]: () => ok({ items: [task, makeTask(2)], total: 2 }),
      [`GET ${url}/tasks/${task.id}`]: () => ok(task),
      [`GET ${url}/tasks/${task.id}/comments`]: () => ok([]),
      [`PATCH ${url}/tasks/${task.id}`]: (body) =>
        ok({
          ...task,
          milestone: (body as { milestoneId: string | null }).milestoneId ? beta : null,
        }),
      ...extra,
    })
  }

  it('sets the milestone of a task, offering open ones and the one it is on', async () => {
    const { bodyOf } = taskServer()
    const { user } = renderApp(`/projects/${project.id}?task=${task.id}`)
    const select = await screen.findByLabelText('Milestone')
    await waitFor(() => expect(select).toHaveDisplayValue('Old'))

    expect(
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['None', 'Beta', 'Old'])
    await user.selectOptions(select, 'Beta')

    await waitFor(() =>
      expect(bodyOf(`PATCH ${url}/tasks/${task.id}`)).toEqual({ milestoneId: beta.id }),
    )
  })

  it('filters the list by milestone and reads the choice from the address', async () => {
    const { calls } = taskServer()
    const { user } = renderApp(`/projects/${project.id}/list?milestoneId=${beta.id}`)
    const select = await screen.findByLabelText('Milestone')
    await waitFor(() => expect(select).toHaveDisplayValue('Beta'))

    await user.selectOptions(select, 'No milestone')

    await waitFor(() =>
      expect(calls.map((call) => call.key)).toContain(`GET ${url}/tasks?milestoneId=none`),
    )
    expect(calls.map((call) => call.key)).toContain(`GET ${url}/tasks?milestoneId=${beta.id}`)
  })

  it('puts the ticked tasks on a milestone at once', async () => {
    const { bodyOf } = taskServer({ [`POST ${url}/tasks/bulk`]: () => ok({ affected: 1 }) })
    const { user } = renderApp(`/projects/${project.id}/list`)

    await user.click(await screen.findByRole('checkbox', { name: 'Select CHL-2' }))
    const bar = screen.getByRole('group', { name: 'Actions for the selected tasks' })
    const select = within(bar).getByLabelText('Milestone…')
    // Closed milestones are not somewhere to put new work.
    expect(within(select).queryByRole('option', { name: 'Old' })).not.toBeInTheDocument()
    await user.selectOptions(select, 'Beta')

    await waitFor(() =>
      expect(bodyOf(`POST ${url}/tasks/bulk`)).toEqual({
        taskIds: [makeTask(2).id],
        action: { type: 'update', patch: { milestoneId: beta.id } },
      }),
    )
  })
})
