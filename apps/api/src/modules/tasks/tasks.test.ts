import { taskListSchema, taskSchema, type Task, type TaskList } from '@chillawiki/shared'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { tasks as tasksTable } from '../../db/schema'
import {
  createTestContext,
  type ProjectFixture,
  type TestContext,
  type TestUser,
} from '../../test/harness'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

async function addTask(
  fixture: ProjectFixture,
  payload: Record<string, unknown>,
  user: TestUser = fixture.member,
): Promise<Task> {
  const response = await fixture.call(user, 'POST', '/tasks', payload)
  expect(response.statusCode, response.body).toBe(201)
  return response.json<Task>()
}

async function listTitles(fixture: ProjectFixture, query = ''): Promise<string[]> {
  const response = await fixture.call(fixture.viewer, 'GET', `/tasks${query}`)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<TaskList>().items.map((task) => task.title)
}

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

describe('creating tasks', () => {
  it('numbers tasks per project and puts them in the first column', async () => {
    const fixture = await ctx.createProject()

    const first = await addTask(fixture, { title: 'First' })
    const second = await addTask(fixture, { title: 'Second' })

    expect(taskSchema.parse(first)).toMatchObject({
      number: 1,
      key: `${fixture.project.key}-1`,
      title: 'First',
      description: '',
      statusId: fixture.statuses[0]?.id,
      priority: 'medium',
      assignee: null,
      dueDate: null,
      reporter: { id: fixture.member.id, name: 'Max Member' },
    })
    expect(second).toMatchObject({ number: 2, key: `${fixture.project.key}-2` })
    expect(second.position).toBeGreaterThan(first.position)
  })

  it('accepts a column, assignee, priority, due date and description', async () => {
    const fixture = await ctx.createProject()

    const task = await addTask(fixture, {
      title: 'Full',
      description: '# Heading',
      statusId: fixture.statuses[1]?.id,
      priority: 'urgent',
      assigneeId: fixture.owner.id,
      dueDate: '2026-12-31',
    })

    expect(task).toMatchObject({
      description: '# Heading',
      statusId: fixture.statuses[1]?.id,
      priority: 'urgent',
      assignee: { id: fixture.owner.id, email: fixture.owner.email },
      dueDate: '2026-12-31',
    })
  })

  it('never reuses a number, even after a task is deleted', async () => {
    const fixture = await ctx.createProject()
    const first = await addTask(fixture, { title: 'Gone' })
    await fixture.call(fixture.member, 'DELETE', `/tasks/${first.id}`)

    const second = await addTask(fixture, { title: 'Next' })

    expect(second.number).toBe(2)
  })

  it('gives distinct numbers to tasks created at the same time', async () => {
    const fixture = await ctx.createProject()

    const tasks = await Promise.all(
      Array.from({ length: 6 }, (_unused, index) => addTask(fixture, { title: `Task ${index}` })),
    )

    expect(tasks.map((task) => task.number).sort((left, right) => left - right)).toEqual([
      1, 2, 3, 4, 5, 6,
    ])
  })

  it('rejects a column or assignee from outside the project', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    const create = (payload: Record<string, unknown>) =>
      fixture.call(fixture.member, 'POST', '/tasks', { title: 'Bad', ...payload })

    const responses = await Promise.all([
      create({ statusId: other.statuses[0]?.id }),
      create({ assigneeId: fixture.outsider.id }),
      create({ assigneeId: UNKNOWN_ID }),
    ])

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400])
    expect(await listTitles(fixture)).toEqual([])
  })

  it('is forbidden for viewers and hidden from outsiders', async () => {
    const fixture = await ctx.createProject()

    const viewer = await fixture.call(fixture.viewer, 'POST', '/tasks', { title: 'Nope' })
    const outsider = await fixture.call(fixture.outsider, 'POST', '/tasks', { title: 'Nope' })

    expect(viewer.statusCode).toBe(403)
    expect(outsider.statusCode).toBe(404)
  })
})

describe('reading a task', () => {
  it('returns it to any project member', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Readable' })

    const response = await fixture.call(fixture.viewer, 'GET', `/tasks/${task.id}`)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(task)
  })

  it('does not find unknown tasks or tasks of another project', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    const foreign = await addTask(other, { title: 'Foreign' })

    const unknown = await fixture.call(fixture.owner, 'GET', `/tasks/${UNKNOWN_ID}`)
    const crossProject = await fixture.call(fixture.owner, 'GET', `/tasks/${foreign.id}`)
    const outsider = await other.call(fixture.owner, 'GET', `/tasks/${foreign.id}`)

    expect([unknown.statusCode, crossProject.statusCode, outsider.statusCode]).toEqual([
      404, 404, 404,
    ])
  })
})

describe('updating a task', () => {
  it('changes the given fields and leaves the rest', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Old', description: 'Keep', priority: 'low' })

    const response = await fixture.call(fixture.member, 'PATCH', `/tasks/${task.id}`, {
      title: 'New',
      assigneeId: fixture.viewer.id,
      dueDate: '2027-01-15',
    })

    expect(response.statusCode).toBe(200)
    const updated = response.json<Task>()
    expect(updated).toMatchObject({
      title: 'New',
      description: 'Keep',
      priority: 'low',
      assignee: { id: fixture.viewer.id },
      dueDate: '2027-01-15',
      number: task.number,
      position: task.position,
    })
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(task.updatedAt))
  })

  it('clears the assignee and due date with null', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, {
      title: 'Assigned',
      assigneeId: fixture.owner.id,
      dueDate: '2026-12-31',
    })

    const response = await fixture.call(fixture.member, 'PATCH', `/tasks/${task.id}`, {
      assigneeId: null,
      dueDate: null,
    })

    expect(response.json()).toMatchObject({ assignee: null, dueDate: null })
  })

  it('rejects an assignee who is not a member, viewers, and unknown tasks', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Guarded' })

    const badAssignee = await fixture.call(fixture.member, 'PATCH', `/tasks/${task.id}`, {
      assigneeId: fixture.outsider.id,
    })
    const viewer = await fixture.call(fixture.viewer, 'PATCH', `/tasks/${task.id}`, { title: 'X' })
    const unknown = await fixture.call(fixture.member, 'PATCH', `/tasks/${UNKNOWN_ID}`, {
      title: 'X',
    })

    expect([badAssignee.statusCode, viewer.statusCode, unknown.statusCode]).toEqual([400, 403, 404])
  })

  it('unassigns the tasks of someone removed from the project', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Orphan', assigneeId: fixture.member.id })

    await fixture.call(fixture.owner, 'DELETE', `/members/${fixture.member.id}`)

    const response = await fixture.call(fixture.owner, 'GET', `/tasks/${task.id}`)
    expect(response.json()).toMatchObject({ assignee: null, reporter: { id: fixture.member.id } })
  })
})

describe('listing tasks', () => {
  async function seeded() {
    const fixture = await ctx.createProject()
    const [todo, doing] = fixture.statuses.map((status) => status.id)
    await addTask(fixture, { title: 'Alpha', statusId: doing, priority: 'high' })
    await addTask(fixture, {
      title: 'Beta report',
      statusId: todo,
      assigneeId: fixture.owner.id,
      description: 'Quarterly NUMBERS, 100% done',
    })
    await addTask(fixture, { title: 'Gamma', statusId: todo, assigneeId: fixture.member.id })
    return { fixture, todo, doing }
  }

  it('orders by column, then by position within the column', async () => {
    const { fixture } = await seeded()

    const response = await fixture.call(fixture.viewer, 'GET', '/tasks')

    const list = taskListSchema.parse(response.json())
    expect(list.total).toBe(3)
    expect(list.items.map((task) => task.title)).toEqual(['Beta report', 'Gamma', 'Alpha'])
  })

  it('filters by column, assignee and priority', async () => {
    const { fixture, doing } = await seeded()

    expect(await listTitles(fixture, `?statusId=${doing}`)).toEqual(['Alpha'])
    expect(await listTitles(fixture, `?assigneeId=${fixture.owner.id}`)).toEqual(['Beta report'])
    expect(await listTitles(fixture, '?assigneeId=none')).toEqual(['Alpha'])
    expect(await listTitles(fixture, '?priority=high')).toEqual(['Alpha'])
    expect(await listTitles(fixture, `?priority=medium&assigneeId=${fixture.member.id}`)).toEqual([
      'Gamma',
    ])
  })

  it('searches titles and descriptions without case, treating % and _ literally', async () => {
    const { fixture } = await seeded()

    expect(await listTitles(fixture, '?q=GAMMA')).toEqual(['Gamma'])
    expect(await listTitles(fixture, '?q=numbers')).toEqual(['Beta report'])
    expect(await listTitles(fixture, `?q=${encodeURIComponent('100%')}`)).toEqual(['Beta report'])
    expect(await listTitles(fixture, `?q=${encodeURIComponent('%')}`)).toEqual(['Beta report'])
    expect(await listTitles(fixture, '?q=_')).toEqual([])
  })

  it('pages through results and reports the full count', async () => {
    const { fixture } = await seeded()

    const response = await fixture.call(fixture.viewer, 'GET', '/tasks?limit=1&offset=1')

    expect(response.json()).toMatchObject({ total: 3, items: [{ title: 'Gamma' }] })
  })

  it('rejects invalid filters and hides the list from outsiders', async () => {
    const { fixture } = await seeded()

    const invalid = await fixture.call(fixture.viewer, 'GET', '/tasks?priority=asap')
    const outsider = await fixture.call(fixture.outsider, 'GET', '/tasks')

    expect([invalid.statusCode, outsider.statusCode]).toEqual([400, 404])
  })
})

describe('moving tasks on the board', () => {
  async function board() {
    const fixture = await ctx.createProject()
    const [todo, doing] = fixture.statuses.map((status) => status.id)
    const a = await addTask(fixture, { title: 'A' })
    const b = await addTask(fixture, { title: 'B' })
    const c = await addTask(fixture, { title: 'C' })
    const move = (task: Task, payload: Record<string, unknown>, user = fixture.member) =>
      fixture.call(user, 'POST', `/tasks/${task.id}/move`, payload)
    const column = (statusId: string | undefined) => listTitles(fixture, `?statusId=${statusId}`)
    return { fixture, todo, doing, a, b, c, move, column }
  }

  it('moves a task to the end of another column', async () => {
    const { todo, doing, a, b, move, column } = await board()
    await move(b, { statusId: doing })

    const response = await move(a, { statusId: doing })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ id: a.id, statusId: doing })
    expect(await column(doing)).toEqual(['B', 'A'])
    expect(await column(todo)).toEqual(['C'])
  })

  it('places a task before another one', async () => {
    const { todo, doing, a, b, c, move, column } = await board()
    await move(a, { statusId: doing })
    await move(b, { statusId: doing })

    await move(c, { statusId: doing, beforeTaskId: b.id })
    expect(await column(doing)).toEqual(['A', 'C', 'B'])

    await move(b, { statusId: doing, beforeTaskId: a.id })
    expect(await column(doing)).toEqual(['B', 'A', 'C'])
    expect(await column(todo)).toEqual([])
  })

  it('reorders within the same column', async () => {
    const { todo, a, c, move, column } = await board()

    await move(c, { statusId: todo, beforeTaskId: a.id })
    expect(await column(todo)).toEqual(['C', 'A', 'B'])

    await move(c, { statusId: todo })
    expect(await column(todo)).toEqual(['A', 'B', 'C'])
  })

  it('keeps the order correct after many moves into the same gap', async () => {
    const { todo, a, b, c, move, column } = await board()

    // Each move halves the gap between A and its predecessor, forcing a rebalance eventually.
    for (let round = 0; round < 70; round += 1) {
      const mover = round % 2 === 0 ? c : b
      const response = await move(mover, { statusId: todo, beforeTaskId: a.id })
      expect(response.statusCode).toBe(200)
    }

    expect(await column(todo)).toEqual(['C', 'B', 'A'])
  })

  it('places a task correctly even when its neighbours share a position', async () => {
    const { todo, doing, a, b, c, move, column } = await board()
    await move(a, { statusId: doing })
    await move(b, { statusId: doing })
    // Two concurrent moves can leave equal positions behind; recreate that state directly.
    await ctx.database.db
      .update(tasksTable)
      .set({ position: 2048 })
      .where(inArray(tasksTable.id, [a.id, b.id]))
    expect(await column(doing)).toEqual(['A', 'B'])

    const response = await move(c, { statusId: doing, beforeTaskId: b.id })

    expect(response.statusCode).toBe(200)
    expect(await column(doing)).toEqual(['A', 'C', 'B'])
    expect(await column(todo)).toEqual([])
  })

  it('rejects impossible targets', async () => {
    const { fixture, todo, doing, a, b, move } = await board()
    const other = await ctx.createProject()

    const responses = await Promise.all([
      move(a, { statusId: other.statuses[0]?.id }),
      move(a, { statusId: doing, beforeTaskId: b.id }),
      move(a, { statusId: todo, beforeTaskId: a.id }),
      move(a, { statusId: todo, beforeTaskId: UNKNOWN_ID }),
      move(a, { statusId: doing }, fixture.viewer),
      fixture.call(fixture.member, 'POST', `/tasks/${UNKNOWN_ID}/move`, { statusId: todo }),
    ])

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 403, 404])
  })
})

describe('deleting a task', () => {
  it('lets a member delete it', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Temporary' })

    const response = await fixture.call(fixture.member, 'DELETE', `/tasks/${task.id}`)
    const afterDelete = await fixture.call(fixture.member, 'GET', `/tasks/${task.id}`)
    const again = await fixture.call(fixture.member, 'DELETE', `/tasks/${task.id}`)

    expect([response.statusCode, afterDelete.statusCode, again.statusCode]).toEqual([204, 404, 404])
  })

  it('is forbidden for viewers', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Protected' })

    const response = await fixture.call(fixture.viewer, 'DELETE', `/tasks/${task.id}`)

    expect(response.statusCode).toBe(403)
  })
})
