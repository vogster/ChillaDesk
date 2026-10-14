import type {
  ChecklistItem,
  Comment,
  Label,
  Project,
  SavedFilter,
  Status,
  Task,
  TaskEvent,
  TaskLink,
} from '@chilladesk/shared'
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
    [`GET ${url}/webhooks`]: () => ok([]),
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
  const titles = () => rows().map((row) => within(row).getByRole('link').textContent)

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

describe('task history', () => {
  const taskOne = makeTask(1, { title: 'Write docs' })
  const event = (number: number, change: TaskEvent['change'], actor = ann): TaskEvent => ({
    id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(number).padStart(12, '0')}`,
    actor: summary(actor),
    change,
    createdAt: TIMESTAMP,
  })

  it('is loaded when opened and reads each change in plain words', async () => {
    const events: TaskEvent[] = [
      event(1, { field: 'created' }),
      event(2, { field: 'title', from: 'Draft', to: 'Write docs' }, bob),
      event(3, { field: 'status', from: 'To Do', to: 'Done' }),
      event(4, { field: 'priority', from: 'low', to: 'urgent' }),
      event(5, { field: 'assignee', from: null, to: 'Bob' }),
      event(6, { field: 'dueDate', from: '2030-05-17', to: null }),
      event(7, { field: 'labels', added: ['bug', 'ui'], removed: ['docs'] }),
      { ...event(8, { field: 'description' }), actor: null },
    ]
    const { calls } = server({
      tasks: [taskOne],
      extra: { [`GET ${url}/tasks/${taskOne.id}/history`]: () => ok(events) },
    })
    const { user } = renderApp(`/projects/${project.id}?task=${taskOne.id}`)
    const dialog = await screen.findByRole('dialog')
    const requested = () => calls.some((call) => call.key.endsWith('/history'))
    expect(requested()).toBe(false)

    await user.click(await within(dialog).findByRole('button', { name: /History/ }))

    const list = await within(dialog).findByRole('list', { name: 'History' })
    const lines = within(list)
      .getAllByRole('listitem')
      .map((item) => item.firstElementChild?.textContent)
    expect(lines).toEqual([
      'Task created',
      'Title: “Draft” → “Write docs”',
      'Column: To Do → Done',
      'Priority: Low → Urgent',
      'Assignee: nobody → Bob',
      expect.stringMatching(/^Due date: .*2030.* → none$/),
      'Labels: added bug, ui; removed docs',
      'Description changed',
    ])
    const items = within(list).getAllByRole('listitem')
    expect(items[1]).toHaveTextContent('Bob ·')
    expect(items[7]).toHaveTextContent('Deleted user ·')
    expect(requested()).toBe(true)
  })

  it('reports a failure to load it', async () => {
    server({ tasks: [taskOne] })
    const { user } = renderApp(`/projects/${project.id}?task=${taskOne.id}`)
    const dialog = await screen.findByRole('dialog')

    await user.click(await within(dialog).findByRole('button', { name: /History/ }))

    expect(await within(dialog).findByRole('alert')).toBeInTheDocument()
  })
})

describe('watching a task', () => {
  const taskOne = makeTask(1, { title: 'Write docs' })
  const watchUrl = `${url}/tasks/${taskOne.id}`

  function watchServer(initiallyWatching: boolean) {
    let watchers = initiallyWatching ? [summary(ann), summary(bob)] : [summary(bob)]
    const state = () => ({ watching: watchers.some((item) => item.id === ann.id), watchers })
    return server({
      tasks: [taskOne],
      extra: {
        [`GET ${watchUrl}/watchers`]: () => ok(state()),
        [`PUT ${watchUrl}/watch`]: () => {
          watchers = [summary(ann), ...watchers.filter((item) => item.id !== ann.id)]
          return ok(state())
        },
        [`DELETE ${watchUrl}/watch`]: () => {
          watchers = watchers.filter((item) => item.id !== ann.id)
          return ok(state())
        },
      },
    })
  }

  it('starts and stops watching and shows how many people watch', async () => {
    const { calls } = watchServer(false)
    const { user } = renderApp(`/projects/${project.id}?task=${taskOne.id}`)
    const dialog = await screen.findByRole('dialog')

    const start = await within(dialog).findByRole('button', { name: 'Watch' })
    expect(start).toHaveAttribute('aria-pressed', 'false')
    expect(within(dialog).getByText('1 watching')).toHaveAttribute('title', 'Bob')
    await user.click(start)

    const stop = await within(dialog).findByRole('button', { name: 'Stop watching' })
    expect(stop).toHaveAttribute('aria-pressed', 'true')
    expect(within(dialog).getByText('2 watching')).toBeInTheDocument()
    await user.click(stop)

    expect(await within(dialog).findByRole('button', { name: 'Watch' })).toBeInTheDocument()
    expect(calls.filter((call) => call.key.endsWith('/watch')).map((call) => call.key)).toEqual([
      `PUT ${watchUrl}/watch`,
      `DELETE ${watchUrl}/watch`,
    ])
  })

  it('leaves the task usable when the watchers cannot be loaded', async () => {
    server({ tasks: [taskOne] })
    renderApp(`/projects/${project.id}?task=${taskOne.id}`)
    const dialog = await screen.findByRole('dialog')

    await within(dialog).findByRole('heading', { name: 'Write docs' })

    expect(within(dialog).queryByRole('button', { name: 'Watch' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('checklist of a task', () => {
  const taskOne = makeTask(1, { title: 'Release' })
  const base = `${url}/tasks/${taskOne.id}/checklist`
  const item = (number: number, text: string, done = false): ChecklistItem => ({
    id: `cccccccc-cccc-4ccc-8ccc-${String(number).padStart(12, '0')}`,
    text,
    done,
  })

  function checklistServer(initial: ChecklistItem[], role: Project['role'] = 'owner') {
    let items = initial
    const routes: ApiRoutes = {
      [`GET ${base}`]: () => ok(items),
      [`POST ${base}`]: (body) => {
        const created = item(items.length + 1, (body as { text: string }).text)
        items = [...items, created]
        return ok(created, 201)
      },
    }
    for (const existing of initial) {
      routes[`PATCH ${base}/${existing.id}`] = (body) => {
        const updated = { ...existing, ...(body as Partial<ChecklistItem>) }
        items = items.map((other) => (other.id === existing.id ? updated : other))
        return ok(updated)
      }
      routes[`DELETE ${base}/${existing.id}`] = () => {
        items = items.filter((other) => other.id !== existing.id)
        return noContent()
      }
    }
    return server({ role, tasks: [taskOne], extra: routes })
  }

  it('shows the items with their progress, ticks one, adds one and removes one', async () => {
    const { bodyOf } = checklistServer([item(1, 'Changelog', true), item(2, 'Tag')])
    const { user } = renderApp(`/projects/${project.id}?task=${taskOne.id}`)
    const dialog = await screen.findByRole('dialog')
    const section = await within(dialog).findByRole('region', { name: /Checklist/ })
    expect(await within(section).findByText('1 of 2 done')).toBeInTheDocument()
    expect(within(section).getByRole('checkbox', { name: 'Changelog' })).toBeChecked()

    await user.click(within(section).getByRole('checkbox', { name: 'Tag' }))
    expect(await within(section).findByText('2 of 2 done')).toBeInTheDocument()
    expect(bodyOf(`PATCH ${base}/${item(2, '').id}`)).toEqual({ done: true })

    await user.type(within(section).getByLabelText('New checklist item'), 'Announce')
    await user.click(within(section).getByRole('button', { name: 'Add' }))
    expect(await within(section).findByRole('checkbox', { name: 'Announce' })).not.toBeChecked()
    expect(within(section).getByLabelText('New checklist item')).toHaveValue('')

    await user.click(
      within(section).getByRole('button', { name: 'Remove “Changelog” from the checklist' }),
    )
    await waitFor(() =>
      expect(
        within(section).queryByRole('checkbox', { name: 'Changelog' }),
      ).not.toBeInTheDocument(),
    )
  })

  it('does not add an empty item', async () => {
    const { calls } = checklistServer([])
    const { user } = renderApp(`/projects/${project.id}?task=${taskOne.id}`)
    const dialog = await screen.findByRole('dialog')
    const section = await within(dialog).findByRole('region', { name: /Checklist/ })

    await user.click(within(section).getByRole('button', { name: 'Add' }))

    expect(within(section).getByLabelText('New checklist item')).toBeInvalid()
    expect(calls.some((call) => call.key === `POST ${base}`)).toBe(false)
  })

  it('is read-only for a viewer, and hidden from them while empty', async () => {
    checklistServer([item(1, 'Changelog')], 'viewer')
    const first = renderApp(`/projects/${project.id}?task=${taskOne.id}`)
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByRole('checkbox', { name: 'Changelog' })).toBeDisabled()
    expect(within(dialog).queryByLabelText('New checklist item')).not.toBeInTheDocument()
    first.unmount()

    checklistServer([], 'viewer')
    renderApp(`/projects/${project.id}?task=${taskOne.id}`)
    const empty = await screen.findByRole('dialog')
    await within(empty).findByRole('heading', { name: 'Release' })
    expect(within(empty).queryByRole('region', { name: /Checklist/ })).not.toBeInTheDocument()
  })

  it('shows the progress on the card of the task', async () => {
    server({ tasks: [makeTask(1, { title: 'Release', checklist: { done: 2, total: 5 } })] })
    renderApp(`/projects/${project.id}`)

    expect(await screen.findByText('Checklist: 2 of 5 done')).toBeInTheDocument()
  })
})

describe('links between tasks', () => {
  const taskOne = makeTask(1, { title: 'Build the UI' })
  const base = `${url}/tasks/${taskOne.id}/links`
  const link = (number: number, relation: TaskLink['relation'], done = false): TaskLink => ({
    id: `dddddddd-dddd-4ddd-8ddd-${String(number).padStart(12, '0')}`,
    relation,
    task: { id: makeTask(number).id, key: `CHL-${number}`, title: `Task ${number}`, done },
  })

  function linkServer(initial: TaskLink[], extra: ApiRoutes = {}) {
    let links = initial
    const routes: ApiRoutes = {
      [`GET ${base}`]: () => ok(links),
      [`POST ${base}`]: (body) => {
        const input = body as { relation: TaskLink['relation']; taskNumber: number }
        links = [...links, link(input.taskNumber, input.relation)]
        return ok(links, 201)
      },
    }
    for (const existing of initial) {
      routes[`DELETE ${base}/${existing.id}`] = () => {
        links = links.filter((other) => other.id !== existing.id)
        return noContent()
      }
    }
    return server({ tasks: [taskOne, makeTask(2), makeTask(3)], extra: { ...routes, ...extra } })
  }

  it('lists the links in words, with a link to each task', async () => {
    linkServer([link(2, 'blocked_by', true), link(3, 'parent_of')])
    renderApp(`/projects/${project.id}?task=${taskOne.id}`)
    const dialog = await screen.findByRole('dialog')
    const section = await within(dialog).findByRole('region', { name: 'Linked tasks' })

    const items = await within(section).findAllByRole('listitem')

    expect(items.map((element) => element.textContent)).toEqual([
      expect.stringMatching(/^is blocked by.*CHL-2 Task 2.*\(done\)/),
      expect.stringMatching(/^has the subtask.*CHL-3 Task 3/),
    ])
    expect(within(section).getByRole('link', { name: /CHL-2/ })).toHaveAttribute(
      'href',
      `/projects/${project.id}?task=${makeTask(2).id}`,
    )
  })

  it('adds a link by task key and removes one', async () => {
    const { bodyOf } = linkServer([link(2, 'relates_to')])
    const { user } = renderApp(`/projects/${project.id}?task=${taskOne.id}`)
    const dialog = await screen.findByRole('dialog')
    const section = await within(dialog).findByRole('region', { name: 'Linked tasks' })

    await user.selectOptions(within(section).getByLabelText('Relation'), 'is a subtask of')
    await user.type(within(section).getByLabelText('Task number'), 'chl-3')
    await user.click(within(section).getByRole('button', { name: 'Link' }))

    expect(await within(section).findByRole('link', { name: /CHL-3/ })).toBeInTheDocument()
    expect(bodyOf(`POST ${base}`)).toEqual({ relation: 'subtask_of', taskNumber: 3 })

    await user.click(within(section).getByRole('button', { name: 'Remove the link to CHL-2' }))
    await waitFor(() =>
      expect(within(section).queryByRole('link', { name: /CHL-2/ })).not.toBeInTheDocument(),
    )
  })

  it('asks for a proper task number and shows what the server refuses', async () => {
    const { calls } = linkServer([], {
      [`POST ${base}`]: () => apiError(409, 'CONFLICT', 'These two tasks are linked already'),
    })
    const { user } = renderApp(`/projects/${project.id}?task=${taskOne.id}`)
    const dialog = await screen.findByRole('dialog')
    const section = await within(dialog).findByRole('region', { name: 'Linked tasks' })
    const field = within(section).getByLabelText('Task number')

    await user.type(field, 'OPS-3')
    await user.click(within(section).getByRole('button', { name: 'Link' }))
    expect(field).toBeInvalid()
    expect(field).toHaveAccessibleDescription(/for example 12 or CHL-12/)
    expect(calls.some((call) => call.key === `POST ${base}`)).toBe(false)

    await user.clear(field)
    await user.type(field, '#2')
    await user.click(within(section).getByRole('button', { name: 'Link' }))

    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'These two tasks are linked already',
    )
  })
})

describe('working with the task list', () => {
  const tasks = [
    makeTask(1, { title: 'Write docs', priority: 'high' }),
    makeTask(2, { title: 'Fix login', statusId: doing.id }),
    makeTask(3, { title: 'Write tests' }),
  ]
  const listPath = `/projects/${project.id}/list`
  const listRequests = (calls: { key: string }[]) =>
    calls.filter((call) => call.key.startsWith(`GET ${url}/tasks?`)).map((call) => call.key)

  it('sorts by a column on a click and turns the order around on the next', async () => {
    const { calls } = server({ tasks })
    const { user } = renderApp(listPath)
    await screen.findByText('3 tasks')
    const heading = () => screen.getByRole('columnheader', { name: /Priority/ })
    expect(heading()).not.toHaveAttribute('aria-sort')

    await user.click(within(heading()).getByRole('button'))
    await waitFor(() => expect(heading()).toHaveAttribute('aria-sort', 'descending'))
    await user.click(within(heading()).getByRole('button'))
    await waitFor(() => expect(heading()).toHaveAttribute('aria-sort', 'ascending'))

    expect(listRequests(calls)).toEqual([
      `GET ${url}/tasks?sort=priority&order=desc`,
      `GET ${url}/tasks?sort=priority&order=asc`,
    ])
    expect(screen.getByRole('columnheader', { name: 'Assignee' })).not.toContainElement(
      screen.queryByRole('button', { name: 'Assignee' }),
    )
  })

  it('opens with the filters and the order of the address', async () => {
    const { calls } = server({ tasks })
    renderApp(`${listPath}?priority=high&sort=due&order=desc&statusId=not-an-id`)

    await screen.findByText('1 task')

    expect(screen.getByLabelText('Priority')).toHaveValue('high')
    expect(screen.getByLabelText('Status')).toHaveValue('')
    expect(screen.getByRole('columnheader', { name: /Due/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    expect(listRequests(calls)).toEqual([`GET ${url}/tasks?priority=high&sort=due&order=desc`])
  })

  describe('bulk actions', () => {
    function bulkServer(role: Project['role'] = 'owner') {
      return server({
        role,
        tasks,
        extra: { [`POST ${url}/tasks/bulk`]: () => ok({ affected: 2 }) },
      })
    }
    const tick = async (user: ReturnType<typeof renderApp>['user'], key: string) =>
      user.click(await screen.findByRole('checkbox', { name: `Select ${key}` }))

    it('applies one action to the ticked tasks and clears the selection', async () => {
      const { bodyOf } = bulkServer()
      const { user } = renderApp(listPath)

      await tick(user, 'CHL-1')
      await tick(user, 'CHL-3')
      const bar = screen.getByRole('group', { name: 'Actions for the selected tasks' })
      expect(within(bar).getByRole('status')).toHaveTextContent('2 selected')
      await user.selectOptions(within(bar).getByLabelText('Move to…'), 'Done')

      await waitFor(() =>
        expect(
          screen.queryByRole('group', { name: 'Actions for the selected tasks' }),
        ).not.toBeInTheDocument(),
      )
      expect(bodyOf(`POST ${url}/tasks/bulk`)).toEqual({
        taskIds: [tasks[0]?.id, tasks[2]?.id],
        action: { type: 'update', patch: { statusId: done.id } },
      })
      expect(screen.getByRole('checkbox', { name: 'Select CHL-1' })).not.toBeChecked()
    })

    it('assigns, unassigns and sets a priority', async () => {
      const { calls } = bulkServer()
      const { user } = renderApp(listPath)
      const act = async (label: string, option: string) => {
        await tick(user, 'CHL-2')
        const bar = screen.getByRole('group', { name: 'Actions for the selected tasks' })
        await user.selectOptions(within(bar).getByLabelText(label), option)
        await waitFor(() => expect(bar).not.toBeInTheDocument())
      }

      await act('Assign to…', 'Bob')
      await act('Assign to…', 'Unassigned')
      await act('Set priority…', 'Urgent')

      const patches = calls
        .filter((call) => call.key === `POST ${url}/tasks/bulk`)
        .map((call) => (call.body as { action: { patch: unknown } }).action.patch)
      expect(patches).toEqual([
        { assigneeId: bob.id },
        { assigneeId: null },
        { priority: 'urgent' },
      ])
    })

    it('selects everything on screen at once and asks before deleting', async () => {
      const { calls, bodyOf } = bulkServer()
      const { user } = renderApp(listPath)

      await user.click(await screen.findByRole('checkbox', { name: 'Select all tasks' }))
      const bar = screen.getByRole('group', { name: 'Actions for the selected tasks' })
      expect(within(bar).getByRole('status')).toHaveTextContent('3 selected')
      await user.click(within(bar).getByRole('button', { name: 'Delete' }))
      expect(within(bar).getByText(/Delete 3 tasks with their comments/)).toBeInTheDocument()
      expect(calls.some((call) => call.key === `POST ${url}/tasks/bulk`)).toBe(false)

      await user.click(within(bar).getByRole('button', { name: 'Yes, delete' }))

      await waitFor(() =>
        expect(bodyOf(`POST ${url}/tasks/bulk`)).toEqual({
          taskIds: tasks.map((task) => task.id),
          action: { type: 'delete' },
        }),
      )
    })

    it('keeps the selection and says why when the server refuses', async () => {
      server({
        tasks,
        extra: {
          [`POST ${url}/tasks/bulk`]: () => apiError(404, 'NOT_FOUND', 'Task not found'),
        },
      })
      const { user } = renderApp(listPath)

      await tick(user, 'CHL-1')
      const bar = screen.getByRole('group', { name: 'Actions for the selected tasks' })
      await user.selectOptions(within(bar).getByLabelText('Set priority…'), 'Low')

      expect(await within(bar).findByRole('alert')).toHaveTextContent('Task not found')
      expect(screen.getByRole('checkbox', { name: 'Select CHL-1' })).toBeChecked()
    })

    it('offers nothing to tick to someone who cannot change tasks', async () => {
      bulkServer('viewer')
      renderApp(listPath)

      await screen.findByText('3 tasks')

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    })
  })

  describe('saved filters', () => {
    const filter = (number: number, name: string, query: string): SavedFilter => ({
      id: `eeeeeeee-eeee-4eee-8eee-${String(number).padStart(12, '0')}`,
      name,
      query,
    })

    function filterServer(initial: SavedFilter[]) {
      let saved = initial
      const routes: ApiRoutes = {
        [`GET ${url}/filters`]: () => ok(saved),
        [`POST ${url}/filters`]: (body) => {
          const input = body as { name: string; query: string }
          const created = filter(saved.length + 1, input.name, input.query)
          saved = [...saved, created]
          return ok(created, 201)
        },
      }
      for (const existing of initial) {
        routes[`DELETE ${url}/filters/${existing.id}`] = () => {
          saved = saved.filter((other) => other.id !== existing.id)
          return noContent()
        }
      }
      return server({ tasks, extra: routes })
    }

    it('saves what is on screen under a name and offers it afterwards', async () => {
      const { bodyOf } = filterServer([])
      const { user } = renderApp(listPath)
      await screen.findByText('3 tasks')
      // Nothing to save while nothing is filtered or sorted.
      expect(screen.queryByRole('button', { name: 'Save filter' })).not.toBeInTheDocument()

      await user.selectOptions(screen.getByLabelText('Priority'), 'High')
      await user.click(await screen.findByRole('button', { name: 'Save filter' }))
      await user.type(screen.getByLabelText('Name of the filter'), 'Important')
      await user.click(screen.getByRole('button', { name: 'Save filter' }))

      const select = await screen.findByLabelText('Saved filters')
      expect(select).toHaveDisplayValue('Important')
      expect(bodyOf(`POST ${url}/filters`)).toEqual({ name: 'Important', query: 'priority=high' })
      expect(
        screen.getByRole('button', { name: 'Delete the filter “Important”' }),
      ).toBeInTheDocument()
    })

    it('applies a saved filter and deletes it', async () => {
      const { calls } = filterServer([filter(1, 'Urgent first', 'sort=priority&order=desc')])
      const { user } = renderApp(listPath)
      await screen.findByText('3 tasks')

      await user.selectOptions(await screen.findByLabelText('Saved filters'), 'Urgent first')

      await waitFor(() =>
        expect(screen.getByRole('columnheader', { name: /Priority/ })).toHaveAttribute(
          'aria-sort',
          'descending',
        ),
      )
      expect(listRequests(calls)).toEqual([`GET ${url}/tasks?sort=priority&order=desc`])

      await user.click(screen.getByRole('button', { name: 'Delete the filter “Urgent first”' }))
      await waitFor(() => expect(screen.queryByLabelText('Saved filters')).not.toBeInTheDocument())
    })

    it('asks for a name and shows what the server refuses', async () => {
      server({
        tasks,
        extra: {
          [`GET ${url}/filters`]: () => ok([]),
          [`POST ${url}/filters`]: () =>
            apiError(409, 'CONFLICT', 'You already have a filter named "Mine"'),
        },
      })
      const { user } = renderApp(`${listPath}?priority=low`)

      await user.click(await screen.findByRole('button', { name: 'Save filter' }))
      await user.click(screen.getByRole('button', { name: 'Save filter' }))
      expect(screen.getByLabelText('Name of the filter')).toBeInvalid()

      await user.type(screen.getByLabelText('Name of the filter'), 'Mine')
      await user.click(screen.getByRole('button', { name: 'Save filter' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('You already have a filter named')
    })
  })
})
