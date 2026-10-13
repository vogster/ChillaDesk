import type { Label, Task, TaskEvent } from '@chilladesk/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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

async function addTask(fixture: ProjectFixture, payload: Record<string, unknown>): Promise<Task> {
  const response = await fixture.call(fixture.owner, 'POST', '/tasks', payload)
  expect(response.statusCode, response.body).toBe(201)
  return response.json<Task>()
}

async function historyOf(fixture: ProjectFixture, task: Task, user: TestUser = fixture.owner) {
  const response = await fixture.call(user, 'GET', `/tasks/${task.id}/history`)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<TaskEvent[]>()
}

const changesOf = async (fixture: ProjectFixture, task: Task) =>
  (await historyOf(fixture, task)).map((event) => event.change)

describe('task history', () => {
  it('starts with who created the task', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Write docs', assigneeId: fixture.member.id })

    const history = await historyOf(fixture, task, fixture.viewer)

    expect(history).toMatchObject([
      { actor: { id: fixture.owner.id, name: 'Olga Owner' }, change: { field: 'created' } },
    ])
    expect(Date.parse(history[0]?.createdAt ?? '')).not.toBeNaN()
  })

  it('records each changed field with its old and new value, by whoever changed it', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Draft', priority: 'low' })

    await fixture.call(fixture.member, 'PATCH', `/tasks/${task.id}`, {
      title: 'Final',
      description: 'Now with a description',
      priority: 'urgent',
      assigneeId: fixture.member.id,
      dueDate: '2030-05-17',
    })
    await fixture.call(fixture.owner, 'PATCH', `/tasks/${task.id}`, {
      assigneeId: fixture.viewer.id,
      dueDate: null,
    })
    await fixture.call(fixture.owner, 'PATCH', `/tasks/${task.id}`, { assigneeId: null })

    const history = await historyOf(fixture, task)
    expect(history.map((event) => [event.actor?.name, event.change])).toEqual([
      ['Olga Owner', { field: 'created' }],
      ['Max Member', { field: 'title', from: 'Draft', to: 'Final' }],
      ['Max Member', { field: 'description' }],
      ['Max Member', { field: 'priority', from: 'low', to: 'urgent' }],
      ['Max Member', { field: 'assignee', from: null, to: 'Max Member' }],
      ['Max Member', { field: 'dueDate', from: null, to: '2030-05-17' }],
      ['Olga Owner', { field: 'assignee', from: 'Max Member', to: 'Vera Viewer' }],
      ['Olga Owner', { field: 'dueDate', from: '2030-05-17', to: null }],
      ['Olga Owner', { field: 'assignee', from: 'Vera Viewer', to: null }],
    ])
  })

  it('records nothing for a save that changes nothing', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Same', priority: 'high' })

    await fixture.call(fixture.owner, 'PATCH', `/tasks/${task.id}`, {
      title: 'Same',
      priority: 'high',
      assigneeId: null,
      labelIds: [],
    })

    expect(await changesOf(fixture, task)).toEqual([{ field: 'created' }])
  })

  it('records a move to another column by name, but not a new place in the same column', async () => {
    const fixture = await ctx.createProject()
    const [todo, doing] = fixture.statuses
    const first = await addTask(fixture, { title: 'First' })
    const second = await addTask(fixture, { title: 'Second' })
    const move = (taskId: string, statusId: string | undefined, beforeTaskId: string | null) =>
      fixture.call(fixture.member, 'POST', `/tasks/${taskId}/move`, { statusId, beforeTaskId })

    await move(second.id, todo?.id, first.id)
    await move(second.id, doing?.id, null)
    // The column is renamed afterwards: the history keeps what it was called then.
    await fixture.call(fixture.owner, 'PATCH', `/statuses/${doing?.id}`, { name: 'Under way' })

    expect(await changesOf(fixture, second)).toEqual([
      { field: 'created' },
      { field: 'status', from: 'To Do', to: 'In Progress' },
    ])
    expect(await changesOf(fixture, first)).toEqual([{ field: 'created' }])
  })

  it('records labels that were put on and taken off', async () => {
    const fixture = await ctx.createProject()
    const label = async (name: string) =>
      (await fixture.call(fixture.owner, 'POST', '/labels', { name, color: 'red' })).json<Label>()
    const [bug, ui, docs] = [await label('bug'), await label('ui'), await label('docs')]
    const task = await addTask(fixture, { title: 'Labelled', labelIds: [bug.id, ui.id] })

    await fixture.call(fixture.owner, 'PATCH', `/tasks/${task.id}`, {
      labelIds: [ui.id, docs.id],
    })
    await fixture.call(fixture.owner, 'PATCH', `/tasks/${task.id}`, { labelIds: [ui.id, docs.id] })

    expect(await changesOf(fixture, task)).toEqual([
      { field: 'created' },
      { field: 'labels', added: ['docs'], removed: ['bug'] },
    ])
  })

  it('keeps the entries of someone whose account is gone, without their name', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Old' })
    await fixture.call(fixture.member, 'PATCH', `/tasks/${task.id}`, { title: 'Renamed' })
    const { users } = await import('../../db/schema')
    const { eq } = await import('drizzle-orm')

    await ctx.database.db.delete(users).where(eq(users.id, fixture.member.id))

    const history = await historyOf(fixture, task)
    expect(history.map((event) => event.actor?.name ?? null)).toEqual(['Olga Owner', null])
    expect(history[1]?.change).toEqual({ field: 'title', from: 'Old', to: 'Renamed' })
  })

  it('is closed to people outside the project and goes away with the task', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Private' })

    const outsider = await fixture.call(fixture.outsider, 'GET', `/tasks/${task.id}/history`)
    const anonymous = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${fixture.project.id}/tasks/${task.id}/history`,
    })
    await fixture.call(fixture.owner, 'DELETE', `/tasks/${task.id}`)
    const afterDelete = await fixture.call(fixture.owner, 'GET', `/tasks/${task.id}/history`)

    expect([outsider.statusCode, anonymous.statusCode, afterDelete.statusCode]).toEqual([
      404, 401, 404,
    ])
  })
})
