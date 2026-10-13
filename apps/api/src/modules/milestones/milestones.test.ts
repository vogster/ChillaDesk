import type { Milestone, Task, TaskEvent, TaskList } from '@chilladesk/shared'
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

async function milestone(
  fixture: ProjectFixture,
  payload: Record<string, unknown>,
  user: TestUser = fixture.member,
): Promise<Milestone> {
  const response = await fixture.call(user, 'POST', '/milestones', payload)
  expect(response.statusCode, response.body).toBe(201)
  return response.json<Milestone>()
}

const listed = async (fixture: ProjectFixture, user: TestUser = fixture.viewer) =>
  (await fixture.call(user, 'GET', '/milestones')).json<Milestone[]>()

async function addTask(fixture: ProjectFixture, payload: Record<string, unknown>): Promise<Task> {
  const response = await fixture.call(fixture.owner, 'POST', '/tasks', payload)
  expect(response.statusCode, response.body).toBe(201)
  return response.json<Task>()
}

describe('milestones', () => {
  it('are created open, with or without a date, and listed nearest first', async () => {
    const fixture = await ctx.createProject()

    const created = await milestone(fixture, { name: '  Version 2  ', dueDate: '2030-06-01' })
    await milestone(fixture, { name: 'Someday' })
    await milestone(fixture, { name: 'Version 1', dueDate: '2030-03-01' })

    expect(created).toEqual({
      id: created.id,
      name: 'Version 2',
      dueDate: '2030-06-01',
      closed: false,
      progress: { done: 0, total: 0 },
    })
    expect((await listed(fixture)).map((item) => item.name)).toEqual([
      'Version 1',
      'Version 2',
      'Someday',
    ])
  })

  it('show how many of their tasks are finished', async () => {
    const fixture = await ctx.createProject()
    const release = await milestone(fixture, { name: 'Release' })
    const done = fixture.statuses.find((status) => status.category === 'done')
    await addTask(fixture, { title: 'One', milestoneId: release.id })
    await addTask(fixture, { title: 'Two', milestoneId: release.id, statusId: done?.id })
    await addTask(fixture, { title: 'Three', milestoneId: release.id, statusId: done?.id })
    await addTask(fixture, { title: 'Elsewhere' })

    expect((await listed(fixture))[0]?.progress).toEqual({ done: 2, total: 3 })
  })

  it('can be renamed, re-dated, closed and reopened; closed ones go to the end', async () => {
    const fixture = await ctx.createProject()
    const first = await milestone(fixture, { name: 'First', dueDate: '2030-01-01' })
    await milestone(fixture, { name: 'Second', dueDate: '2030-02-01' })
    const patch = (payload: Record<string, unknown>) =>
      fixture.call(fixture.member, 'PATCH', `/milestones/${first.id}`, payload)

    const renamed = await patch({ name: 'Alpha', dueDate: null })
    const closed = await patch({ closed: true })

    expect(renamed.json()).toMatchObject({ name: 'Alpha', dueDate: null, closed: false })
    expect(closed.json()).toMatchObject({ closed: true })
    expect((await listed(fixture)).map((item) => [item.name, item.closed])).toEqual([
      ['Second', false],
      ['Alpha', true],
    ])
    expect((await patch({ closed: false })).json()).toMatchObject({ closed: false })
  })

  it('keep their names unique in a project, and are validated', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    const first = await milestone(fixture, { name: 'Release' })
    await milestone(fixture, { name: 'Beta' })
    const create = (payload: Record<string, unknown>) =>
      fixture.call(fixture.member, 'POST', '/milestones', payload)

    const answers = [
      await create({ name: 'Release' }),
      await create({ name: '   ' }),
      await create({ name: 'Bad date', dueDate: '2030-13-45' }),
      await fixture.call(fixture.member, 'PATCH', `/milestones/${first.id}`, { name: 'Beta' }),
      await fixture.call(fixture.member, 'PATCH', `/milestones/${first.id}`, {}),
    ]

    expect(answers.map((response) => response.statusCode)).toEqual([409, 400, 400, 409, 400])
    // The same name is free in another project.
    expect((await milestone(other, { name: 'Release' })).name).toBe('Release')
  })

  it('are for members to change and for the project to see', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    const mine = await milestone(fixture, { name: 'Mine' })

    const statuses = [
      (await fixture.call(fixture.viewer, 'POST', '/milestones', { name: 'By viewer' })).statusCode,
      (await fixture.call(fixture.viewer, 'PATCH', `/milestones/${mine.id}`, { closed: true }))
        .statusCode,
      (await fixture.call(fixture.viewer, 'DELETE', `/milestones/${mine.id}`)).statusCode,
      (await fixture.call(fixture.outsider, 'GET', '/milestones')).statusCode,
      // A milestone is only reachable through its own project.
      (await other.call(other.owner, 'PATCH', `/milestones/${mine.id}`, { closed: true }))
        .statusCode,
      (await other.call(other.owner, 'DELETE', `/milestones/${mine.id}`)).statusCode,
    ]

    expect(statuses).toEqual([403, 403, 403, 404, 404, 404])
    expect(await listed(fixture)).toMatchObject([{ name: 'Mine', closed: false }])
  })
})

describe('tasks and milestones', () => {
  it('put a task on a milestone, move it to another and take it off, with history', async () => {
    const fixture = await ctx.createProject()
    const [alpha, beta] = [
      await milestone(fixture, { name: 'Alpha' }),
      await milestone(fixture, { name: 'Beta' }),
    ]
    const task = await addTask(fixture, { title: 'Travels', milestoneId: alpha.id })
    const patch = (milestoneId: string | null) =>
      fixture.call(fixture.member, 'PATCH', `/tasks/${task.id}`, { milestoneId })

    const moved = await patch(beta.id)
    await patch(null)

    expect(task.milestone).toEqual({ id: alpha.id, name: 'Alpha' })
    expect(moved.json<Task>().milestone).toEqual({ id: beta.id, name: 'Beta' })
    const history = (await fixture.call(fixture.owner, 'GET', `/tasks/${task.id}/history`)).json<
      TaskEvent[]
    >()
    expect(history.map((event) => event.change)).toEqual([
      { field: 'created' },
      { field: 'milestone', from: 'Alpha', to: 'Beta' },
      { field: 'milestone', from: 'Beta', to: null },
    ])
  })

  it('filter the task list by milestone, or by having none', async () => {
    const fixture = await ctx.createProject()
    const release = await milestone(fixture, { name: 'Release' })
    await addTask(fixture, { title: 'In', milestoneId: release.id })
    await addTask(fixture, { title: 'Out' })
    const titles = async (query: string) =>
      (await fixture.call(fixture.owner, 'GET', `/tasks${query}`))
        .json<TaskList>()
        .items.map((task) => task.title)

    expect(await titles(`?milestoneId=${release.id}`)).toEqual(['In'])
    expect(await titles('?milestoneId=none')).toEqual(['Out'])
    expect(await titles('')).toEqual(['In', 'Out'])
  })

  it('refuse a milestone of another project', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    const foreign = await milestone(other, { name: 'Foreign' })
    const task = await addTask(fixture, { title: 'Local' })

    const onCreate = await fixture.call(fixture.owner, 'POST', '/tasks', {
      title: 'New',
      milestoneId: foreign.id,
    })
    const onUpdate = await fixture.call(fixture.owner, 'PATCH', `/tasks/${task.id}`, {
      milestoneId: foreign.id,
    })

    expect([onCreate.statusCode, onUpdate.statusCode]).toEqual([400, 400])
  })

  it('keep the tasks of a deleted milestone, without one', async () => {
    const fixture = await ctx.createProject()
    const release = await milestone(fixture, { name: 'Release' })
    const task = await addTask(fixture, { title: 'Survives', milestoneId: release.id })

    const removed = await fixture.call(fixture.member, 'DELETE', `/milestones/${release.id}`)
    const again = await fixture.call(fixture.member, 'DELETE', `/milestones/${release.id}`)

    expect([removed.statusCode, again.statusCode]).toEqual([204, 404])
    const after = (await fixture.call(fixture.owner, 'GET', `/tasks/${task.id}`)).json<Task>()
    expect(after.milestone).toBeNull()
  })

  it('can be set for several tasks at once', async () => {
    const fixture = await ctx.createProject()
    const release = await milestone(fixture, { name: 'Release' })
    const [one, two] = [
      await addTask(fixture, { title: 'One' }),
      await addTask(fixture, { title: 'Two' }),
    ]

    const response = await fixture.call(fixture.member, 'POST', '/tasks/bulk', {
      taskIds: [one.id, two.id],
      action: { type: 'update', patch: { milestoneId: release.id } },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect((await listed(fixture))[0]?.progress.total).toBe(2)
  })
})
