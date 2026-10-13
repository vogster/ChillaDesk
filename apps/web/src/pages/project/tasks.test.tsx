import type { Comment, Label, Project, Status, Task } from '@chilladesk/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ann,
  apiError,
  bob,
  doing,
  done,
  makeMember,
  makeProject,
  makeTask,
  mockApi,
  noContent,
  ok,
  renderApp,
  summary,
  todo,
  type ApiRoutes,
} from '../../test/render'

const project = makeProject()
const url = `/api/projects/${project.id}`
const TIMESTAMP = '2026-01-01T00:00:00.000Z'

interface ServerOptions {
  role?: Project['role']
  tasks?: Task[]
  statuses?: Status[]
  comments?: Comment[]
  labels?: Label[]
  extra?: ApiRoutes
}

/** An in-memory stand-in for the task endpoints, so refetches return what the UI changed. */
function server({ role = 'owner', extra = {}, ...initial }: ServerOptions = {}) {
  let tasks = initial.tasks ?? [makeTask(1), makeTask(2, { statusId: doing.id })]
  let statuses = initial.statuses ?? [todo, doing, done]
  let comments = initial.comments ?? []
  let labels = initial.labels ?? []
  const taskRoutes: ApiRoutes = {}
  // Tasks carry copies of their labels; rebuild them from the current label list.
  const withCurrentLabels = (task: Task): Task => ({
    ...task,
    labels: task.labels.flatMap((label) => labels.find((item) => item.id === label.id) ?? []),
  })

  const defineTaskRoutes = (task: Task) => {
    const taskUrl = `${url}/tasks/${task.id}`
    const current = () => tasks.find((item) => item.id === task.id)
    const replace = (next: Task) => {
      tasks = tasks.map((item) => (item.id === task.id ? next : item))
      return ok(next)
    }
    taskRoutes[`GET ${taskUrl}`] = () => {
      const found = current()
      return found ? ok(withCurrentLabels(found)) : apiError(404, 'NOT_FOUND', 'Task not found')
    }
    taskRoutes[`PATCH ${taskUrl}`] = (body) => {
      const patch = body as Partial<Task> & { assigneeId?: string | null; labelIds?: string[] }
      const { assigneeId, labelIds, ...fields } = patch
      const taskLabels = labelIds
        ? labels.filter((label) => labelIds.includes(label.id))
        : (current()?.labels ?? [])
      const assignee =
        assigneeId === undefined
          ? (current()?.assignee ?? null)
          : assigneeId === null
            ? null
            : summary(assigneeId === bob.id ? bob : ann)
      return replace({ ...(current() ?? task), ...fields, assignee, labels: taskLabels })
    }
    taskRoutes[`POST ${taskUrl}/move`] = (body) =>
      replace({ ...(current() ?? task), statusId: (body as { statusId: string }).statusId })
    taskRoutes[`DELETE ${taskUrl}`] = () => {
      tasks = tasks.filter((item) => item.id !== task.id)
      return noContent()
    }
    taskRoutes[`GET ${taskUrl}/comments`] = () =>
      ok(comments.filter((comment) => comment.taskId === task.id))
    taskRoutes[`POST ${taskUrl}/comments`] = (body) => {
      const comment: Comment = {
        id: `66666666-6666-4666-8666-${String(comments.length + 1).padStart(12, '0')}`,
        taskId: task.id,
        author: summary(ann),
        body: (body as { body: string }).body,
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      }
      comments = [...comments, comment]
      return ok(comment, 201)
    }
  }
  tasks.forEach(defineTaskRoutes)
  for (const comment of comments) {
    taskRoutes[`PATCH ${url}/tasks/${comment.taskId}/comments/${comment.id}`] = (body) => {
      const edited = {
        ...comment,
        body: (body as { body: string }).body,
        updatedAt: '2026-02-02T00:00:00.000Z',
      }
      comments = comments.map((item) => (item.id === comment.id ? edited : item))
      return ok(edited)
    }
    taskRoutes[`DELETE ${url}/tasks/${comment.taskId}/comments/${comment.id}`] = () => {
      comments = comments.filter((item) => item.id !== comment.id)
      return noContent()
    }
  }

  const calls = mockApi({
    'GET /api/auth/me': () => ok(ann),
    [`GET ${url}`]: () => ok(makeProject({ role })),
    [`GET ${url}/members`]: () => ok([makeMember(ann, role), makeMember(bob, 'member')]),
    [`GET ${url}/statuses`]: () => ok(statuses),
    [`GET ${url}/labels`]: () => ok(labels),
    [`POST ${url}/labels`]: (body) => {
      const input = body as Pick<Label, 'name' | 'color'>
      if (labels.some((label) => label.name.toLowerCase() === input.name.toLowerCase())) {
        return apiError(409, 'CONFLICT', `A label named "${input.name}" already exists`)
      }
      const created: Label = {
        ...input,
        id: `99999999-9999-4999-8999-${String(labels.length + 1).padStart(12, '0')}`,
      }
      labels = [...labels, created].sort((left, right) => left.name.localeCompare(right.name))
      return ok(created, 201)
    },
    ...Object.fromEntries(
      (initial.labels ?? []).flatMap((label) => [
        [
          `PATCH ${url}/labels/${label.id}`,
          (body: unknown) => {
            const updated = { ...label, ...(body as Partial<Label>) }
            labels = labels.map((item) => (item.id === label.id ? updated : item))
            return ok(updated)
          },
        ],
        [
          `DELETE ${url}/labels/${label.id}`,
          () => {
            labels = labels.filter((item) => item.id !== label.id)
            return noContent()
          },
        ],
      ]),
    ),
    [`POST ${url}/statuses`]: (body) => {
      const input = body as Pick<Status, 'name' | 'category'>
      const created: Status = {
        ...input,
        id: '44444444-4444-4444-8444-444444444449',
        position: statuses.length,
      }
      statuses = [...statuses, created]
      return ok(created, 201)
    },
    [`PUT ${url}/statuses/order`]: (body) => {
      const { statusIds } = body as { statusIds: string[] }
      statuses = statusIds.map((id, position) => ({
        ...(statuses.find((status) => status.id === id) as Status),
        position,
      }))
      return ok(statuses)
    },
    [`PATCH ${url}/statuses/${todo.id}`]: (body) => {
      statuses = statuses.map((status) =>
        status.id === todo.id ? { ...status, ...(body as Partial<Status>) } : status,
      )
      return ok(statuses.find((status) => status.id === todo.id))
    },
    [`DELETE ${url}/statuses/${done.id}`]: () => {
      statuses = statuses.filter((status) => status.id !== done.id)
      return noContent()
    },
    [`DELETE ${url}/statuses/${doing.id}`]: () =>
      apiError(409, 'CONFLICT', 'Move the tasks out of this status before deleting it'),
    [`GET ${url}/tasks`]: (_body, query) => {
      const q = query.get('q')?.toLowerCase()
      const items = tasks.filter(
        (task) =>
          (!q || task.title.toLowerCase().includes(q)) &&
          (!query.get('statusId') || task.statusId === query.get('statusId')) &&
          (!query.get('priority') || task.priority === query.get('priority')) &&
          (!query.get('labelId') ||
            task.labels.some((label) => label.id === query.get('labelId'))) &&
          (!query.get('assigneeId') ||
            (query.get('assigneeId') === 'none'
              ? task.assignee === null
              : task.assignee?.id === query.get('assigneeId'))),
      )
      return ok({ items: items.map(withCurrentLabels), total: items.length })
    },
    [`POST ${url}/tasks`]: (body) => {
      const input = body as { title: string; statusId: string }
      const created = makeTask(tasks.length + 1, input)
      tasks = [...tasks, created]
      defineTaskRoutes(created)
      return ok(created, 201)
    },
    ...taskRoutes,
    ...extra,
  })
  return { calls, bodyOf: (key: string) => calls.findLast((call) => call.key === key)?.body }
}

const column = (name: string) => screen.findByRole('region', { name })
const boardPath = `/projects/${project.id}`

describe('board', () => {
  it('shows each task in its column with its key', async () => {
    server()
    renderApp(boardPath)

    const todoColumn = await column('To Do')
    expect(within(todoColumn).getByRole('link', { name: 'Task 1' })).toBeInTheDocument()
    expect(within(todoColumn).getByText('CHL-1')).toBeInTheDocument()
    expect(within(await column('In Progress')).getByText('Task 2')).toBeInTheDocument()
    expect(within(await column('Done')).queryByRole('link')).not.toBeInTheDocument()
  })

  it('keeps cards as list items with a link, plus a separate handle for moving them', async () => {
    server()
    renderApp(boardPath)

    const todoColumn = await column('To Do')
    const card = within(todoColumn).getByRole('listitem')
    expect(within(card).getByRole('link', { name: 'Task 1' })).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Move Task 1' })).toBeInTheDocument()
  })

  it('adds a task to a column and keeps the form open for the next one', async () => {
    const { bodyOf } = server()
    const { user } = renderApp(boardPath)

    await user.click(await screen.findByRole('button', { name: 'Add a task to Done' }))
    const input = screen.getByLabelText('Title of the new task in Done')
    await user.type(input, 'Ship it{Enter}')

    expect(await within(await column('Done')).findByText('Ship it')).toBeInTheDocument()
    expect(bodyOf(`POST ${url}/tasks`)).toEqual({ title: 'Ship it', statusId: done.id })
    await waitFor(() => expect(input).toHaveValue(''))

    await user.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByLabelText('Title of the new task in Done')).not.toBeInTheDocument()
  })

  it('ignores a blank title and reports a failed create', async () => {
    const { calls } = server({
      extra: {
        [`POST ${url}/tasks`]: () => apiError(500, 'INTERNAL_ERROR', 'Internal server error'),
      },
    })
    const { user } = renderApp(boardPath)

    await user.click(await screen.findByRole('button', { name: 'Add a task to To Do' }))
    await user.type(screen.getByLabelText('Title of the new task in To Do'), '   {Enter}')
    expect(calls.some((call) => call.key === `POST ${url}/tasks`)).toBe(false)

    await user.type(screen.getByLabelText('Title of the new task in To Do'), 'Real{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error')
  })

  it('is read-only for viewers', async () => {
    server({ role: 'viewer' })
    renderApp(boardPath)

    await column('To Do')
    expect(screen.queryByRole('button', { name: /Add a task/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Move Task 1' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument()
  })

  it('marks overdue tasks unless they are done', async () => {
    server({
      tasks: [
        makeTask(1, { dueDate: '2020-01-01' }),
        makeTask(2, { dueDate: '2020-01-01', statusId: done.id }),
      ],
    })
    renderApp(boardPath)

    expect(within(await column('To Do')).getByText('Overdue:')).toBeInTheDocument()
    expect(within(await column('Done')).queryByText('Overdue:')).not.toBeInTheDocument()
  })

  it('says so when the board cannot show every task', async () => {
    server({
      extra: { [`GET ${url}/tasks`]: () => ok({ items: [makeTask(1)], total: 900 }) },
    })
    renderApp(boardPath)

    expect(await screen.findByText(/Showing the first 1 of 900 tasks/)).toBeInTheDocument()
  })

  it('shows a load error', async () => {
    server({
      extra: { [`GET ${url}/statuses`]: () => apiError(500, 'INTERNAL_ERROR', 'Board is down') },
    })
    renderApp(boardPath)

    expect(await screen.findByRole('alert')).toHaveTextContent('Board is down')
  })
})

describe('task dialog', () => {
  const taskOne = makeTask(1, { description: 'Some **bold** text' })
  const open = (options: ServerOptions = {}) => {
    const api = server({ tasks: [taskOne, makeTask(2, { statusId: doing.id })], ...options })
    return { ...api, ...renderApp(`${boardPath}?task=${taskOne.id}`) }
  }
  const dialog = () => screen.findByRole('dialog', { name: 'CHL-1: Task 1' })

  it('opens from a card and closes with the button or Escape', async () => {
    server()
    const { user } = renderApp(boardPath)

    await user.click(await screen.findByRole('link', { name: 'Task 1' }))
    const opened = await dialog()
    expect(within(opened).getByRole('heading', { name: 'Task 1' })).toBeInTheDocument()

    await user.click(within(opened).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Task 1' }))
    await dialog()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the description as Markdown', async () => {
    open()

    const bold = await within(await dialog()).findByText('bold')
    expect(bold.tagName).toBe('STRONG')
  })

  it('edits the title and description', async () => {
    const { user, bodyOf } = open()

    await user.click(await within(await dialog()).findByRole('button', { name: 'Edit' }))
    await user.clear(screen.getByLabelText('Title'))
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByLabelText('Title')).toBeInvalid()

    await user.type(screen.getByLabelText('Title'), 'Renamed')
    await user.clear(screen.getByLabelText('Description'))
    await user.type(screen.getByLabelText('Description'), 'New text')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('heading', { name: 'Renamed' })).toBeInTheDocument()
    expect(bodyOf(`PATCH ${url}/tasks/${taskOne.id}`)).toEqual({
      title: 'Renamed',
      description: 'New text',
    })
    // The card behind the dialog shows the new title as well.
    expect(await screen.findByRole('link', { name: 'Renamed' })).toBeInTheDocument()
  })

  it('can cancel editing without saving', async () => {
    const { user, calls } = open()

    await user.click(await within(await dialog()).findByRole('button', { name: 'Edit' }))
    await user.type(screen.getByLabelText('Title'), ' extra')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByRole('heading', { name: 'Task 1' })).toBeInTheDocument()
    expect(calls.some((call) => call.key.startsWith('PATCH'))).toBe(false)
  })

  it('changes status, priority, assignee and due date straight away', async () => {
    const { user, bodyOf } = open()
    const taskUrl = `${url}/tasks/${taskOne.id}`
    await dialog()

    await user.selectOptions(await screen.findByLabelText('Status'), 'Done')
    await waitFor(() =>
      expect(bodyOf(`POST ${taskUrl}/move`)).toEqual({ statusId: done.id, beforeTaskId: null }),
    )
    expect(await within(await column('Done')).findByText('Task 1')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Priority'), 'Urgent')
    await waitFor(() => expect(bodyOf(`PATCH ${taskUrl}`)).toEqual({ priority: 'urgent' }))

    await user.selectOptions(screen.getByLabelText('Assignee'), 'Bob')
    await waitFor(() => expect(bodyOf(`PATCH ${taskUrl}`)).toEqual({ assigneeId: bob.id }))
    expect(await screen.findByLabelText('Assigned to Bob')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Assignee'), 'Unassigned')
    await waitFor(() => expect(bodyOf(`PATCH ${taskUrl}`)).toEqual({ assigneeId: null }))

    // A date is saved when the field is left, not while it is being typed.
    await user.type(screen.getByLabelText('Due date'), '2030-05-17')
    expect(bodyOf(`PATCH ${taskUrl}`)).toEqual({ assigneeId: null })
    await user.tab()
    await waitFor(() => expect(bodyOf(`PATCH ${taskUrl}`)).toEqual({ dueDate: '2030-05-17' }))
  })

  it('deletes the task after confirmation', async () => {
    const { user, calls } = open()

    await user.click(await within(await dialog()).findByRole('button', { name: 'Delete task…' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(calls.some((call) => call.key.startsWith('DELETE'))).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Delete task…' }))
    await user.click(screen.getByRole('button', { name: 'Yes, delete' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByText('Task 1')).not.toBeInTheDocument())
  })

  it('shows plain values to viewers', async () => {
    open({
      role: 'viewer',
      tasks: [makeTask(1, { assignee: summary(bob), dueDate: '2030-05-17' })],
    })

    const opened = await dialog()
    expect(await within(opened).findByText('Bob')).toBeInTheDocument()
    expect(within(opened).getByText('To Do')).toBeInTheDocument()
    expect(within(opened).getByText('Medium')).toBeInTheDocument()
    expect(within(opened).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(opened).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(within(opened).queryByRole('button', { name: 'Delete task…' })).not.toBeInTheDocument()
    expect(within(opened).queryByLabelText('Add a comment')).not.toBeInTheDocument()
  })

  it('rejects a due date with an impossible year without saving it', async () => {
    const { user, calls } = open()
    await dialog()

    await user.type(await screen.findByLabelText('Due date'), '0202-05-17')
    await user.tab()

    expect(screen.getByLabelText('Due date')).toBeInvalid()
    expect(screen.getByText('Enter a year between 1900 and 2999.')).toBeInTheDocument()
    expect(calls.some((call) => call.key.startsWith('PATCH'))).toBe(false)
  })

  it('leaves a field on the first Escape and closes on the second', async () => {
    const { user } = open()

    await user.click(await within(await dialog()).findByRole('button', { name: 'Edit' }))
    await user.type(screen.getByLabelText('Description'), ' draft')
    await user.keyboard('{Escape}')
    expect(screen.getByLabelText('Description')).toHaveValue('Some **bold** text draft')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps keyboard focus inside the dialog', async () => {
    const { user } = open()
    const opened = await dialog()
    await within(opened).findByRole('button', { name: 'Edit' })

    for (let presses = 0; presses < 25; presses += 1) {
      await user.tab()
      expect(opened).toContainElement(document.activeElement as HTMLElement)
    }
    await user.tab({ shift: true })
    expect(opened).toContainElement(document.activeElement as HTMLElement)
  })

  it('reports a server failure as such, not as a missing task', async () => {
    server({
      extra: {
        [`GET ${url}/tasks/${taskOne.id}`]: () =>
          apiError(500, 'INTERNAL_ERROR', 'Internal server error'),
      },
    })
    renderApp(`${boardPath}?task=${taskOne.id}`)

    expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error')
  })

  it('ignores a task parameter that is not an id', async () => {
    const { calls } = server()
    renderApp(`${boardPath}?task=../../auth/me`)

    await column('To Do')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calls.some((call) => call.key.includes('..'))).toBe(false)
  })

  it('explains when the task no longer exists', async () => {
    server()
    const { user } = renderApp(`${boardPath}?task=55555555-5555-4555-8555-999999999999`)

    expect(await screen.findByRole('alert')).toHaveTextContent('does not exist any more')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('comments', () => {
  const taskOne = makeTask(1)
  const comment = (id: number, author: typeof ann, body: string): Comment => ({
    id: `66666666-6666-4666-8666-${String(id).padStart(12, '0')}`,
    taskId: taskOne.id,
    author: summary(author),
    body,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  })
  const path = `${boardPath}?task=${taskOne.id}`

  it('adds a comment and clears the box', async () => {
    const { bodyOf } = server({ tasks: [taskOne] })
    const { user } = renderApp(path)

    expect(await screen.findByText('No comments yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    expect(screen.getByLabelText('Add a comment')).toBeInvalid()
    expect(screen.getByText('Write a comment first.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Add a comment'), 'Looks good')
    await user.click(screen.getByRole('button', { name: 'Comment' }))

    expect(await screen.findByText('Looks good')).toBeInTheDocument()
    expect(bodyOf(`POST ${url}/tasks/${taskOne.id}/comments`)).toEqual({ body: 'Looks good' })
    await waitFor(() => expect(screen.getByLabelText('Add a comment')).toHaveValue(''))
  })

  it('lets a member delete only their own comments', async () => {
    server({
      role: 'member',
      tasks: [taskOne],
      comments: [comment(1, ann, 'Mine'), comment(2, bob, 'Not mine')],
    })
    const { user } = renderApp(path)

    expect(await screen.findByText('Not mine')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete comment by Bob' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete comment by Ann' }))
    await waitFor(() => expect(screen.queryByText('Mine')).not.toBeInTheDocument())
  })

  it('lets an owner delete anyone’s comment', async () => {
    server({ tasks: [taskOne], comments: [comment(2, bob, 'Not mine')] })
    renderApp(path)

    expect(await screen.findByRole('button', { name: 'Delete comment by Bob' })).toBeInTheDocument()
  })
})

describe('task list', () => {
  const tasks = [
    makeTask(1, { title: 'Write docs', priority: 'high', assignee: summary(bob) }),
    makeTask(2, { title: 'Fix login', statusId: doing.id, dueDate: '2030-05-17' }),
    makeTask(3, { title: 'Write tests', statusId: done.id }),
  ]
  const rows = () => screen.getAllByRole('row').slice(1)
  const titles = () => rows().map((row) => within(row).getAllByRole('cell')[1]?.textContent)

  it('lists tasks with their status, priority, assignee and due date', async () => {
    server({ tasks })
    renderApp(`${boardPath}/list`)

    expect(await screen.findByText('3 tasks')).toBeInTheDocument()
    const first = rows()[0] as HTMLElement
    expect(within(first).getByText('CHL-1')).toBeInTheDocument()
    expect(within(first).getByText('To Do')).toBeInTheDocument()
    expect(within(first).getByText('High')).toBeInTheDocument()
    expect(within(first).getByText('Bob')).toBeInTheDocument()
    expect(within(rows()[1] as HTMLElement).getByText(/2030/)).toBeInTheDocument()
  })

  it('filters by search text, status, assignee and priority', async () => {
    server({ tasks })
    const { user } = renderApp(`${boardPath}/list`)
    await screen.findByText('3 tasks')

    await user.type(screen.getByLabelText('Search'), 'write')
    await waitFor(() => expect(titles()).toEqual(['Write docs', 'Write tests']))

    await user.selectOptions(screen.getByLabelText('Status'), 'Done')
    await waitFor(() => expect(titles()).toEqual(['Write tests']))
    expect(screen.getByText('1 task')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Status'), 'Any status')
    await user.clear(screen.getByLabelText('Search'))
    await user.selectOptions(screen.getByLabelText('Assignee'), 'Unassigned')
    await waitFor(() => expect(titles()).toEqual(['Fix login', 'Write tests']))

    await user.selectOptions(screen.getByLabelText('Assignee'), 'Bob')
    await waitFor(() => expect(titles()).toEqual(['Write docs']))

    await user.selectOptions(screen.getByLabelText('Priority'), 'Urgent')
    expect(await screen.findByText('No tasks match these filters.')).toBeInTheDocument()
  })

  it('opens a task from the list and keeps the list behind it', async () => {
    server({ tasks })
    const { user } = renderApp(`${boardPath}/list`)

    await user.click(await screen.findByRole('link', { name: 'Fix login' }))

    expect(await screen.findByRole('dialog', { name: 'CHL-2: Fix login' })).toBeInTheDocument()
    expect(screen.getByLabelText('Search')).toBeInTheDocument()
  })

  it('invites to add the first task', async () => {
    server({ tasks: [] })
    renderApp(`${boardPath}/list`)

    expect(await screen.findByText('No tasks yet. Add one on the board.')).toBeInTheDocument()
  })
})

describe('board column settings', () => {
  const settings = `${boardPath}/settings`
  const columnNames = () =>
    screen.getAllByLabelText(/^Name of column/).map((input) => (input as HTMLInputElement).value)

  it('adds, renames, reorders and deletes columns', async () => {
    const { bodyOf } = server()
    const { user } = renderApp(settings)
    await screen.findByLabelText('Name of column 1')

    await user.type(screen.getByLabelText('New column'), 'Review')
    await user.selectOptions(screen.getByLabelText('Kind'), 'In progress')
    await user.click(screen.getByRole('button', { name: 'Add column' }))
    await waitFor(() => expect(columnNames()).toEqual(['To Do', 'In Progress', 'Done', 'Review']))
    expect(bodyOf(`POST ${url}/statuses`)).toEqual({ name: 'Review', category: 'in_progress' })

    const first = screen.getByLabelText('Name of column 1')
    await user.clear(first)
    await user.type(first, 'Backlog{Enter}')
    await waitFor(() =>
      expect(bodyOf(`PATCH ${url}/statuses/${todo.id}`)).toEqual({ name: 'Backlog' }),
    )

    await user.click(await screen.findByRole('button', { name: 'Move Backlog right' }))
    await waitFor(() => expect(columnNames().slice(0, 2)).toEqual(['In Progress', 'Backlog']))

    await user.click(screen.getByRole('button', { name: 'Delete Done' }))
    await waitFor(() => expect(columnNames()).not.toContain('Done'))
  })

  it('puts the saved name back when a column name is cleared', async () => {
    const { calls } = server()
    const { user } = renderApp(settings)

    const first = await screen.findByLabelText('Name of column 1')
    await user.clear(first)
    await user.tab()

    expect(first).toHaveValue('To Do')
    expect(calls.some((call) => call.key.startsWith('PATCH'))).toBe(false)
  })

  it('changes what kind of column it is', async () => {
    const { bodyOf } = server()
    const { user } = renderApp(settings)

    await user.selectOptions(await screen.findByLabelText('Kind of To Do'), 'Done')

    await waitFor(() =>
      expect(bodyOf(`PATCH ${url}/statuses/${todo.id}`)).toEqual({ category: 'done' }),
    )
  })

  it('shows why a column cannot be deleted and validates the new name', async () => {
    const { calls } = server()
    const { user } = renderApp(settings)

    await user.click(await screen.findByRole('button', { name: 'Delete In Progress' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Move the tasks out')

    await user.click(screen.getByRole('button', { name: 'Add column' }))
    expect(screen.getByLabelText('New column')).toBeInvalid()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(calls.some((call) => call.key === `POST ${url}/statuses`)).toBe(false)
  })

  it('cannot move the edge columns outward or delete the only column', async () => {
    server({ statuses: [todo] })
    renderApp(settings)

    expect(await screen.findByRole('button', { name: 'Move To Do left' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move To Do right' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete To Do' })).toBeDisabled()
  })

  it('is not available to members, even by address', async () => {
    server({ role: 'member' })
    renderApp(settings)

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})

describe('labels', () => {
  const bug: Label = { id: '99999999-9999-4999-8999-0000000000b1', name: 'Bug', color: 'red' }
  const feature: Label = {
    id: '99999999-9999-4999-8999-0000000000f1',
    name: 'Feature',
    color: 'green',
  }
  const labelled = makeTask(1, { title: 'Crash on save', labels: [bug] })
  const plain = makeTask(2, { title: 'Plain task', statusId: doing.id })
  const withLabels = (options: ServerOptions = {}) =>
    server({ tasks: [labelled, plain], labels: [bug, feature], ...options })

  it('shows the labels of a task on its board card', async () => {
    withLabels()
    renderApp(boardPath)

    const card = (await screen.findByRole('link', { name: 'Crash on save' })).closest(
      'li',
    ) as HTMLElement
    expect(
      within(within(card).getByRole('list', { name: 'Labels' })).getByText('Bug'),
    ).toBeInTheDocument()
    const plainCard = screen.getByRole('link', { name: 'Plain task' }).closest('li') as HTMLElement
    expect(within(plainCard).queryByRole('list', { name: 'Labels' })).not.toBeInTheDocument()
  })

  it('adds and removes labels in the task dialog', async () => {
    const { bodyOf } = withLabels()
    const { user } = renderApp(`${boardPath}?task=${labelled.id}`)
    const dialog = await screen.findByRole('dialog', { name: 'CHL-1: Crash on save' })
    const taskUrl = `${url}/tasks/${labelled.id}`

    await user.click(await within(dialog).findByRole('button', { name: 'Edit labels' }))
    expect(within(dialog).getByRole('checkbox', { name: 'Bug' })).toBeChecked()
    await user.click(within(dialog).getByRole('checkbox', { name: 'Feature' }))
    await waitFor(() =>
      expect(bodyOf(`PATCH ${taskUrl}`)).toEqual({ labelIds: [bug.id, feature.id] }),
    )
    await waitFor(() =>
      expect(within(dialog).getByRole('checkbox', { name: 'Feature' })).toBeChecked(),
    )

    await user.click(within(dialog).getByRole('checkbox', { name: 'Bug' }))
    await waitFor(() => expect(bodyOf(`PATCH ${taskUrl}`)).toEqual({ labelIds: [feature.id] }))

    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('creates a label from the dialog and puts it on the task', async () => {
    const { bodyOf } = withLabels()
    const { user } = renderApp(`${boardPath}?task=${plain.id}`)
    const dialog = await screen.findByRole('dialog', { name: 'CHL-2: Plain task' })

    expect(await within(dialog).findByText('No labels')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Edit labels' }))
    await user.click(within(dialog).getByRole('button', { name: 'Create label' }))
    expect(within(dialog).getByLabelText('New label')).toBeInvalid()

    await user.type(within(dialog).getByLabelText('New label'), 'Docs')
    await user.selectOptions(within(dialog).getByLabelText('Colour of the new label'), 'Blue')
    await user.click(within(dialog).getByRole('button', { name: 'Create label' }))

    await waitFor(() =>
      expect(bodyOf(`POST ${url}/labels`)).toEqual({ name: 'Docs', color: 'blue' }),
    )
    expect(await within(dialog).findByRole('checkbox', { name: 'Docs' })).toBeChecked()
    expect(
      (bodyOf(`PATCH ${url}/tasks/${plain.id}`) as { labelIds: string[] }).labelIds,
    ).toHaveLength(1)
  })

  it('reports a label name that is taken', async () => {
    withLabels()
    const { user } = renderApp(`${boardPath}?task=${plain.id}`)
    const dialog = await screen.findByRole('dialog', { name: 'CHL-2: Plain task' })

    await user.click(await within(dialog).findByRole('button', { name: 'Edit labels' }))
    await user.type(within(dialog).getByLabelText('New label'), 'bug')
    await user.click(within(dialog).getByRole('button', { name: 'Create label' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already exists')
  })

  it('shows labels to viewers without the picker', async () => {
    withLabels({ role: 'viewer' })
    renderApp(`${boardPath}?task=${labelled.id}`)
    const dialog = await screen.findByRole('dialog', { name: 'CHL-1: Crash on save' })

    expect(await within(dialog).findByText('Bug')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Edit labels' })).not.toBeInTheDocument()
  })

  it('shows labels in the list and filters by one', async () => {
    withLabels()
    const { user } = renderApp(`${boardPath}/list`)
    await screen.findByText('2 tasks')
    const row = screen.getByRole('link', { name: 'Crash on save' }).closest('tr') as HTMLElement
    expect(within(row).getByText('Bug')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Label'), 'Bug')
    expect(await screen.findByText('1 task')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Plain task' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Label'), 'Feature')
    expect(await screen.findByText('No tasks match these filters.')).toBeInTheDocument()
  })

  it('offers no label filter in a project without labels', async () => {
    server()
    renderApp(`${boardPath}/list`)

    await screen.findByText('2 tasks')
    expect(screen.queryByLabelText('Label')).not.toBeInTheDocument()
  })

  describe('in project settings', () => {
    const settings = `${boardPath}/settings`
    const labelNames = () =>
      screen.getAllByLabelText(/^Name of label/).map((input) => (input as HTMLInputElement).value)

    it('adds, renames, recolours and deletes labels', async () => {
      const { bodyOf } = withLabels()
      const { user } = renderApp(settings)
      await screen.findByLabelText('Name of label Bug')

      await user.type(screen.getByLabelText('New label'), 'Chore')
      await user.selectOptions(screen.getByLabelText('Colour'), 'Purple')
      await user.click(screen.getByRole('button', { name: 'Add label' }))
      await waitFor(() => expect(labelNames()).toEqual(['Bug', 'Chore', 'Feature']))
      expect(bodyOf(`POST ${url}/labels`)).toEqual({ name: 'Chore', color: 'purple' })

      const name = screen.getByLabelText('Name of label Bug')
      await user.clear(name)
      await user.type(name, 'Defect{Enter}')
      await waitFor(() =>
        expect(bodyOf(`PATCH ${url}/labels/${bug.id}`)).toEqual({ name: 'Defect' }),
      )

      await user.selectOptions(await screen.findByLabelText('Colour of Defect'), 'Orange')
      await waitFor(() =>
        expect(bodyOf(`PATCH ${url}/labels/${bug.id}`)).toEqual({ color: 'orange' }),
      )

      await user.click(screen.getByRole('button', { name: 'Delete label Feature' }))
      await waitFor(() => expect(labelNames()).not.toContain('Feature'))
    })

    it('validates the new label and keeps a name when it is cleared', async () => {
      const { calls } = withLabels()
      const { user } = renderApp(settings)

      const name = await screen.findByLabelText('Name of label Bug')
      await user.clear(name)
      await user.tab()
      expect(name).toHaveValue('Bug')

      await user.click(screen.getByRole('button', { name: 'Add label' }))
      expect(screen.getByLabelText('New label')).toBeInvalid()
      expect(
        calls.some((call) => call.key.includes('/labels') && !call.key.startsWith('GET')),
      ).toBe(false)
    })

    it('says so when there are no labels', async () => {
      server()
      renderApp(settings)

      expect(await screen.findByText('No labels yet.')).toBeInTheDocument()
    })
  })
})

describe('editing comments', () => {
  const taskOne = makeTask(1)
  const comment = (id: number, author: typeof ann, body: string): Comment => ({
    id: `66666666-6666-4666-8666-${String(id).padStart(12, '0')}`,
    taskId: taskOne.id,
    author: summary(author),
    body,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  })
  const path = `${boardPath}?task=${taskOne.id}`
  const mine = comment(1, ann, 'First draft')

  it('lets the author edit a comment and marks it as edited', async () => {
    const { bodyOf } = server({ tasks: [taskOne], comments: [mine, comment(2, bob, 'Not mine')] })
    const { user } = renderApp(path)

    await user.click(await screen.findByRole('button', { name: /^Edit your comment/ }))
    const box = screen.getByLabelText('Edit comment')
    expect(box).toHaveValue('First draft')
    await user.clear(box)
    await user.type(box, 'Final **text**')
    await user.click(screen.getByRole('button', { name: 'Save comment' }))

    expect((await screen.findByText('text')).tagName).toBe('STRONG')
    expect(bodyOf(`PATCH ${url}/tasks/${taskOne.id}/comments/${mine.id}`)).toEqual({
      body: 'Final **text**',
    })
    expect(screen.getByText('(edited)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Edit comment')).not.toBeInTheDocument()
  })

  it('offers editing only to the author, even to a project owner', async () => {
    server({ tasks: [taskOne], comments: [comment(2, bob, 'Not mine')] })
    renderApp(path)

    expect(await screen.findByText('Not mine')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit your comment/ })).not.toBeInTheDocument()
    expect(screen.queryByText('(edited)')).not.toBeInTheDocument()
  })

  it('does not save an empty comment and can cancel', async () => {
    const { calls } = server({ tasks: [taskOne], comments: [mine] })
    const { user } = renderApp(path)

    await user.click(await screen.findByRole('button', { name: /^Edit your comment/ }))
    await user.clear(screen.getByLabelText('Edit comment'))
    await user.click(screen.getByRole('button', { name: 'Save comment' }))
    expect(screen.getByLabelText('Edit comment')).toBeInvalid()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('First draft')).toBeInTheDocument()
    expect(calls.some((call) => call.key.startsWith('PATCH'))).toBe(false)
  })
})
