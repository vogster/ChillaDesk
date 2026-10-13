import type { ChecklistItem, Task, TaskLink, TaskList } from '@chilladesk/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  type ProjectFixture,
  type TestContext,
  type TestUser,
} from '../../test/harness'
import { MAX_CHECKLIST_ITEMS } from './checklist.service'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

async function addTask(fixture: ProjectFixture, title: string): Promise<Task> {
  const response = await fixture.call(fixture.owner, 'POST', '/tasks', { title })
  expect(response.statusCode, response.body).toBe(201)
  return response.json<Task>()
}

describe('checklist', () => {
  const add = (fixture: ProjectFixture, task: Task, text: string, user = fixture.member) =>
    fixture.call(user, 'POST', `/tasks/${task.id}/checklist`, { text })
  const list = async (fixture: ProjectFixture, task: Task, user: TestUser = fixture.viewer) =>
    (await fixture.call(user, 'GET', `/tasks/${task.id}/checklist`)).json<ChecklistItem[]>()
  const taskOf = async (fixture: ProjectFixture, task: Task) =>
    (await fixture.call(fixture.owner, 'GET', `/tasks/${task.id}`)).json<Task>()

  it('keeps items in the order they were added, unticked at first', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, 'Release')

    const first = await add(fixture, task, '  Write the changelog  ')
    await add(fixture, task, 'Tag the version')

    expect(first.statusCode, first.body).toBe(201)
    expect(await list(fixture, task)).toMatchObject([
      { text: 'Write the changelog', done: false },
      { text: 'Tag the version', done: false },
    ])
  })

  it('ticks, rewords and removes an item', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, 'Release')
    const [first, second] = [
      (await add(fixture, task, 'One')).json<ChecklistItem>(),
      (await add(fixture, task, 'Two')).json<ChecklistItem>(),
    ]
    const item = (id: string) => `/tasks/${task.id}/checklist/${id}`

    const ticked = await fixture.call(fixture.member, 'PATCH', item(first.id), { done: true })
    await fixture.call(fixture.member, 'PATCH', item(second.id), { text: 'Second' })
    const removed = await fixture.call(fixture.member, 'DELETE', item(first.id))
    const again = await fixture.call(fixture.member, 'DELETE', item(first.id))

    expect(ticked.json()).toMatchObject({ id: first.id, text: 'One', done: true })
    expect([removed.statusCode, again.statusCode]).toEqual([204, 404])
    expect(await list(fixture, task)).toEqual([{ id: second.id, text: 'Second', done: false }])
  })

  it('shows its progress on the task, alone and in lists', async () => {
    const fixture = await ctx.createProject()
    const [withList, without] = [await addTask(fixture, 'With'), await addTask(fixture, 'Without')]
    const first = (await add(fixture, withList, 'One')).json<ChecklistItem>()
    await add(fixture, withList, 'Two')
    await add(fixture, withList, 'Three')
    await fixture.call(fixture.member, 'PATCH', `/tasks/${withList.id}/checklist/${first.id}`, {
      done: true,
    })

    const listed = (await fixture.call(fixture.owner, 'GET', '/tasks')).json<TaskList>().items

    expect((await taskOf(fixture, withList)).checklist).toEqual({ done: 1, total: 3 })
    expect(without.checklist).toEqual({ done: 0, total: 0 })
    expect(Object.fromEntries(listed.map((task) => [task.title, task.checklist]))).toEqual({
      With: { done: 1, total: 3 },
      Without: { done: 0, total: 0 },
    })
  })

  it('validates the text and limits the length of the list', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, 'Long')

    const empty = await add(fixture, task, '   ')
    const tooLong = await add(fixture, task, 'x'.repeat(301))
    for (let index = 0; index < MAX_CHECKLIST_ITEMS; index += 1) {
      await add(fixture, task, `Item ${index}`)
    }
    const oneTooMany = await add(fixture, task, 'One more')

    expect([empty.statusCode, tooLong.statusCode, oneTooMany.statusCode]).toEqual([400, 400, 409])
    expect((await taskOf(fixture, task)).checklist.total).toBe(MAX_CHECKLIST_ITEMS)
  })

  it('lets viewers read and only members change; outsiders see nothing', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, 'Guarded')
    const other = await addTask(fixture, 'Other task')
    const created = (await add(fixture, task, 'One')).json<ChecklistItem>()
    const item = `/tasks/${task.id}/checklist/${created.id}`

    const statuses = [
      (await add(fixture, task, 'By viewer', fixture.viewer)).statusCode,
      (await fixture.call(fixture.viewer, 'PATCH', item, { done: true })).statusCode,
      (await fixture.call(fixture.viewer, 'DELETE', item)).statusCode,
      (await fixture.call(fixture.outsider, 'GET', `/tasks/${task.id}/checklist`)).statusCode,
      // An item is only reachable through its own task.
      (
        await fixture.call(fixture.member, 'PATCH', `/tasks/${other.id}/checklist/${created.id}`, {
          done: true,
        })
      ).statusCode,
    ]

    expect(statuses).toEqual([403, 403, 403, 404, 404])
    expect(await list(fixture, task)).toMatchObject([{ done: false }])
  })

  it('goes away with its task', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, 'Short-lived')
    await add(fixture, task, 'One')

    await fixture.call(fixture.owner, 'DELETE', `/tasks/${task.id}`)

    expect(
      (await fixture.call(fixture.owner, 'GET', `/tasks/${task.id}/checklist`)).statusCode,
    ).toBe(404)
  })
})

describe('links between tasks', () => {
  const link = (
    fixture: ProjectFixture,
    task: Task,
    relation: string,
    other: Task | number,
    user = fixture.member,
  ) =>
    fixture.call(user, 'POST', `/tasks/${task.id}/links`, {
      relation,
      taskNumber: typeof other === 'number' ? other : other.number,
    })
  const linksOf = async (fixture: ProjectFixture, task: Task, user: TestUser = fixture.viewer) =>
    (await fixture.call(user, 'GET', `/tasks/${task.id}/links`)).json<TaskLink[]>()
  const summary = (links: TaskLink[]) => links.map((item) => [item.relation, item.task.key])

  it('reads a link from either task, each from its own side', async () => {
    const fixture = await ctx.createProject()
    const [api, ui, docs, epic] = [
      await addTask(fixture, 'API'),
      await addTask(fixture, 'UI'),
      await addTask(fixture, 'Docs'),
      await addTask(fixture, 'Epic'),
    ]

    const created = await link(fixture, ui, 'blocked_by', api)
    await link(fixture, ui, 'relates_to', docs)
    await link(fixture, ui, 'subtask_of', epic)

    expect(created.statusCode, created.body).toBe(201)
    expect(summary(await linksOf(fixture, ui))).toEqual([
      ['blocked_by', api.key],
      ['subtask_of', epic.key],
      ['relates_to', docs.key],
    ])
    expect(summary(await linksOf(fixture, api))).toEqual([['blocks', ui.key]])
    expect(summary(await linksOf(fixture, epic))).toEqual([['parent_of', ui.key]])
    expect(summary(await linksOf(fixture, docs))).toEqual([['relates_to', ui.key]])
    expect((await linksOf(fixture, ui))[0]?.task).toEqual({
      id: api.id,
      key: api.key,
      title: 'API',
      done: false,
    })
  })

  it('says whether the task at the other end is finished', async () => {
    const fixture = await ctx.createProject()
    const [blocker, blocked] = [
      await addTask(fixture, 'Blocker'),
      await addTask(fixture, 'Blocked'),
    ]
    await link(fixture, blocked, 'blocked_by', blocker)
    const done = fixture.statuses.find((status) => status.category === 'done')

    await fixture.call(fixture.owner, 'POST', `/tasks/${blocker.id}/move`, {
      statusId: done?.id,
      beforeTaskId: null,
    })

    expect((await linksOf(fixture, blocked))[0]?.task.done).toBe(true)
  })

  it('allows one link between two tasks, whichever way round, and none to itself', async () => {
    const fixture = await ctx.createProject()
    const [first, second] = [await addTask(fixture, 'First'), await addTask(fixture, 'Second')]
    await link(fixture, first, 'blocks', second)

    const answers = [
      await link(fixture, first, 'blocks', second),
      await link(fixture, second, 'blocks', first),
      await link(fixture, first, 'duplicates', second),
      await link(fixture, first, 'relates_to', first),
      await link(fixture, first, 'relates_to', 999),
      await link(fixture, first, 'cousin_of', second),
    ]

    expect(answers.map((response) => response.statusCode)).toEqual([409, 409, 409, 400, 404, 400])
    expect(await linksOf(fixture, first)).toHaveLength(1)
  })

  it('removes a link from either end', async () => {
    const fixture = await ctx.createProject()
    const [first, second, third] = [
      await addTask(fixture, 'First'),
      await addTask(fixture, 'Second'),
      await addTask(fixture, 'Third'),
    ]
    await link(fixture, first, 'blocks', second)
    const [created] = await linksOf(fixture, first)

    const wrongTask = await fixture.call(
      fixture.member,
      'DELETE',
      `/tasks/${third.id}/links/${created?.id}`,
    )
    const removed = await fixture.call(
      fixture.member,
      'DELETE',
      `/tasks/${second.id}/links/${created?.id}`,
    )

    expect([wrongTask.statusCode, removed.statusCode]).toEqual([404, 204])
    expect(await linksOf(fixture, first)).toEqual([])
  })

  it('stays inside the project and is for members to change', async () => {
    const [fixture, elsewhere] = [await ctx.createProject(), await ctx.createProject()]
    const [first, second] = [await addTask(fixture, 'First'), await addTask(fixture, 'Second')]
    await addTask(elsewhere, 'Foreign')
    await addTask(elsewhere, 'Foreign too')
    await addTask(elsewhere, 'Number three exists only there')

    const statuses = [
      (await link(fixture, first, 'blocks', second, fixture.viewer)).statusCode,
      (await link(fixture, first, 'blocks', second, fixture.outsider)).statusCode,
      // Task 3 exists in the other project only.
      (await link(fixture, first, 'blocks', 3)).statusCode,
      (await fixture.call(fixture.outsider, 'GET', `/tasks/${first.id}/links`)).statusCode,
    ]

    expect(statuses).toEqual([403, 404, 404, 404])
  })

  it('goes away when either task is deleted', async () => {
    const fixture = await ctx.createProject()
    const [first, second] = [await addTask(fixture, 'First'), await addTask(fixture, 'Second')]
    await link(fixture, first, 'blocks', second)

    await fixture.call(fixture.owner, 'DELETE', `/tasks/${second.id}`)

    expect(await linksOf(fixture, first)).toEqual([])
  })
})
