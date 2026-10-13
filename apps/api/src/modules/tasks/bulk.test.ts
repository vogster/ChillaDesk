import type { SavedFilter, Task, TaskEvent, TaskList } from '@chilladesk/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resourceOfRoute } from '../events/routes'
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

const listed = async (fixture: ProjectFixture, query = '') =>
  (await fixture.call(fixture.owner, 'GET', `/tasks${query}`)).json<TaskList>().items

describe('sorting the task list', () => {
  async function sample() {
    const fixture = await ctx.createProject()
    const [, doing] = fixture.statuses
    await addTask(fixture, { title: 'banana', priority: 'urgent', dueDate: '2030-03-01' })
    await addTask(fixture, { title: 'Cherry', priority: 'low' })
    await addTask(fixture, {
      title: 'apple',
      priority: 'high',
      dueDate: '2030-01-01',
      statusId: doing?.id,
    })
    return fixture
  }
  const titles = async (fixture: ProjectFixture, query: string) =>
    (await listed(fixture, query)).map((task) => task.title)

  it('keeps the order of the board by default', async () => {
    const fixture = await sample()

    expect(await titles(fixture, '')).toEqual(['banana', 'Cherry', 'apple'])
    expect(await titles(fixture, '?sort=board&order=desc')).toEqual(['apple', 'Cherry', 'banana'])
  })

  it('sorts by each column in both directions', async () => {
    const fixture = await sample()

    expect(await titles(fixture, '?sort=title')).toEqual(['apple', 'banana', 'Cherry'])
    expect(await titles(fixture, '?sort=title&order=desc')).toEqual(['Cherry', 'banana', 'apple'])
    expect(await titles(fixture, '?sort=number&order=desc')).toEqual(['apple', 'Cherry', 'banana'])
    expect(await titles(fixture, '?sort=priority&order=desc')).toEqual([
      'banana',
      'apple',
      'Cherry',
    ])
    expect(await titles(fixture, '?sort=created')).toEqual(['banana', 'Cherry', 'apple'])
  })

  it('puts tasks without a due date last, whichever way the dates go', async () => {
    const fixture = await sample()

    expect(await titles(fixture, '?sort=due')).toEqual(['apple', 'banana', 'Cherry'])
    expect(await titles(fixture, '?sort=due&order=desc')).toEqual(['banana', 'apple', 'Cherry'])
  })

  it('puts the task changed last first when asked for', async () => {
    const fixture = await sample()
    const [first] = await listed(fixture)
    await new Promise((resolve) => setTimeout(resolve, 15))
    await fixture.call(fixture.owner, 'PATCH', `/tasks/${first?.id}`, { priority: 'medium' })

    expect((await titles(fixture, '?sort=updated&order=desc'))[0]).toBe('banana')
  })

  it('refuses an order it does not know', async () => {
    const fixture = await ctx.createProject()

    const answers = await Promise.all([
      fixture.call(fixture.owner, 'GET', '/tasks?sort=colour'),
      fixture.call(fixture.owner, 'GET', '/tasks?order=sideways'),
    ])

    expect(answers.map((response) => response.statusCode)).toEqual([400, 400])
  })
})

describe('bulk actions', () => {
  const bulk = (
    fixture: ProjectFixture,
    taskIds: string[],
    action: Record<string, unknown>,
    user: TestUser = fixture.member,
  ) => fixture.call(user, 'POST', '/tasks/bulk', { taskIds, action })

  async function three(fixture: ProjectFixture) {
    return [
      await addTask(fixture, { title: 'One' }),
      await addTask(fixture, { title: 'Two' }),
      await addTask(fixture, { title: 'Three' }),
    ]
  }

  it('changes several tasks at once and records it on each', async () => {
    const fixture = await ctx.createProject()
    const [one, two, three_] = await three(fixture)
    const done = fixture.statuses.find((status) => status.category === 'done')

    const response = await bulk(fixture, [one?.id ?? '', two?.id ?? ''], {
      type: 'update',
      patch: { statusId: done?.id, assigneeId: fixture.viewer.id, priority: 'urgent' },
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({ affected: 2 })
    const after = await listed(fixture, '?sort=number')
    expect(after.map((task) => [task.title, task.statusId === done?.id, task.priority])).toEqual([
      ['One', true, 'urgent'],
      ['Two', true, 'urgent'],
      ['Three', false, 'medium'],
    ])
    expect(after[0]?.assignee?.id).toBe(fixture.viewer.id)
    expect(after[2]?.id).toBe(three_?.id)
    const history = (await fixture.call(fixture.owner, 'GET', `/tasks/${two?.id}/history`)).json<
      TaskEvent[]
    >()
    expect(history.map((event) => event.change.field).sort()).toEqual([
      'assignee',
      'created',
      'priority',
      'status',
    ])
    expect(history.at(-1)?.actor?.id).toBe(fixture.member.id)
  })

  it('deletes several tasks at once', async () => {
    const fixture = await ctx.createProject()
    const [one, two] = await three(fixture)

    const response = await bulk(fixture, [one?.id ?? '', two?.id ?? ''], { type: 'delete' })

    expect(response.json()).toEqual({ affected: 2 })
    expect((await listed(fixture)).map((task) => task.title)).toEqual(['Three'])
  })

  it('changes nothing at all when one of the tasks cannot be changed', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    const [one, two] = await three(fixture)
    const foreign = await addTask(other, { title: 'Foreign' })
    const ids = [one?.id ?? '', two?.id ?? '']

    const answers = [
      await bulk(fixture, [...ids, foreign.id], { type: 'update', patch: { priority: 'low' } }),
      await bulk(fixture, ids, { type: 'update', patch: { assigneeId: fixture.outsider.id } }),
      await bulk(fixture, ids, {
        type: 'update',
        patch: { priority: 'low', statusId: other.statuses[0]?.id },
      }),
    ]

    expect(answers.map((response) => response.statusCode)).toEqual([404, 400, 400])
    expect((await listed(fixture)).map((task) => task.priority)).toEqual([
      'medium',
      'medium',
      'medium',
    ])
    expect((await listed(other)).map((task) => task.title)).toEqual(['Foreign'])
  })

  it('validates the request', async () => {
    const fixture = await ctx.createProject()
    const [one] = await three(fixture)
    const id = one?.id ?? ''

    const answers = [
      await bulk(fixture, [], { type: 'delete' }),
      await bulk(fixture, [id, id], { type: 'delete' }),
      await bulk(fixture, [id], { type: 'update', patch: {} }),
      await bulk(fixture, [id], { type: 'archive' }),
      await bulk(fixture, [id], { type: 'update', patch: { title: 'Sneaky' } }),
    ]

    expect(answers.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400])
    expect((await listed(fixture))[0]?.title).toBe('One')
  })

  it('is for members: not for viewers, outsiders or read-only tokens', async () => {
    const fixture = await ctx.createProject()
    const [one] = await three(fixture)
    const ids = [one?.id ?? '']
    const readToken = (
      await ctx.request(fixture.member, 'POST', '/api/tokens', { name: 'R', scope: 'read' })
    ).json<{ token: string }>().token

    const statuses = [
      (await bulk(fixture, ids, { type: 'delete' }, fixture.viewer)).statusCode,
      (await bulk(fixture, ids, { type: 'delete' }, fixture.outsider)).statusCode,
      (
        await ctx.app.inject({
          method: 'POST',
          url: `/api/projects/${fixture.project.id}/tasks/bulk`,
          headers: { authorization: `Bearer ${readToken}` },
          payload: { taskIds: ids, action: { type: 'delete' } },
        })
      ).statusCode,
    ]

    expect(statuses).toEqual([403, 404, 403])
    expect(await listed(fixture)).toHaveLength(3)
  })
})

describe('saved filters', () => {
  const save = (fixture: ProjectFixture, user: TestUser, name: string, query = 'priority=high') =>
    fixture.call(user, 'POST', '/filters', { name, query })
  const mine = async (fixture: ProjectFixture, user: TestUser) =>
    (await fixture.call(user, 'GET', '/filters')).json<SavedFilter[]>()

  it('keeps each person their own, by name', async () => {
    const fixture = await ctx.createProject()

    const created = await save(fixture, fixture.member, '  Urgent  ', 'priority=urgent&sort=due')
    await save(fixture, fixture.member, 'All mine', 'assigneeId=me')
    await save(fixture, fixture.viewer, 'Viewer keeps one too')

    expect(created.statusCode, created.body).toBe(201)
    expect((await mine(fixture, fixture.member)).map(({ name, query }) => [name, query])).toEqual([
      ['All mine', 'assigneeId=me'],
      ['Urgent', 'priority=urgent&sort=due'],
    ])
    expect(await mine(fixture, fixture.owner)).toEqual([])
    expect(await mine(fixture, fixture.viewer)).toHaveLength(1)
  })

  it('refuses a second filter of the same name, an empty name and an endless query', async () => {
    const fixture = await ctx.createProject()
    await save(fixture, fixture.member, 'Urgent')

    const answers = [
      await save(fixture, fixture.member, 'Urgent'),
      await save(fixture, fixture.member, '   '),
      await save(fixture, fixture.member, 'Long', 'x'.repeat(501)),
    ]

    expect(answers.map((response) => response.statusCode)).toEqual([409, 400, 400])
    // The same name is free for somebody else.
    expect((await save(fixture, fixture.owner, 'Urgent')).statusCode).toBe(201)
  })

  it('deletes only what is yours', async () => {
    const fixture = await ctx.createProject()
    const filter = (await save(fixture, fixture.member, 'Mine')).json<SavedFilter>()

    const byOwner = await fixture.call(fixture.owner, 'DELETE', `/filters/${filter.id}`)
    const byMe = await fixture.call(fixture.member, 'DELETE', `/filters/${filter.id}`)

    expect([byOwner.statusCode, byMe.statusCode]).toEqual([404, 204])
    expect(await mine(fixture, fixture.member)).toEqual([])
  })

  it('is closed to outsiders and announces nothing to the project', async () => {
    const fixture = await ctx.createProject()

    const outsider = await save(fixture, fixture.outsider, 'Peek')

    expect(outsider.statusCode).toBe(404)
    expect(resourceOfRoute('/api/projects/:projectId/filters/:filterId')).toBeNull()
  })
})
