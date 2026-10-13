import type { NotificationList, Task, TaskWatchers } from '@chilladesk/shared'
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

async function addTask(
  fixture: ProjectFixture,
  payload: Record<string, unknown>,
  user: TestUser = fixture.owner,
): Promise<Task> {
  const response = await fixture.call(user, 'POST', '/tasks', payload)
  expect(response.statusCode, response.body).toBe(201)
  return response.json<Task>()
}

async function watchers(fixture: ProjectFixture, task: Task, user: TestUser = fixture.owner) {
  const response = await fixture.call(user, 'GET', `/tasks/${task.id}/watchers`)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<TaskWatchers>()
}

const namesOf = async (fixture: ProjectFixture, task: Task) =>
  (await watchers(fixture, task)).watchers.map((watcher) => watcher.name)

const notificationsOf = async (user: TestUser) =>
  (await ctx.request(user, 'GET', '/api/notifications'))
    .json<NotificationList>()
    .items.map((item) => [item.type, item.excerpt])

describe('who watches a task', () => {
  it('starts with whoever created it and whoever it is assigned to', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Ours', assigneeId: fixture.member.id })

    const result = await watchers(fixture, task, fixture.viewer)

    expect(result.watchers.map((watcher) => watcher.name)).toEqual(['Max Member', 'Olga Owner'])
    expect(result.watching).toBe(false)
    expect((await watchers(fixture, task)).watching).toBe(true)
  })

  it('adds a new assignee and whoever comments', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Grows' })

    await fixture.call(fixture.owner, 'PATCH', `/tasks/${task.id}`, {
      assigneeId: fixture.member.id,
    })
    await fixture.call(fixture.owner, 'PATCH', `/tasks/${task.id}`, { assigneeId: null })
    await addTask(fixture, { title: 'Another' })

    expect(await namesOf(fixture, task)).toEqual(['Max Member', 'Olga Owner'])
  })

  it('lets any member start and stop, viewers included, as often as they like', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Interesting' })
    const watch = (method: 'PUT' | 'DELETE', user: TestUser) =>
      fixture.call(user, method, `/tasks/${task.id}/watch`)

    const started = await watch('PUT', fixture.viewer)
    await watch('PUT', fixture.viewer)
    expect(started.json<TaskWatchers>()).toMatchObject({ watching: true })
    expect(await namesOf(fixture, task)).toEqual(['Olga Owner', 'Vera Viewer'])

    const stopped = await watch('DELETE', fixture.owner)
    await watch('DELETE', fixture.owner)
    expect(stopped.json<TaskWatchers>()).toMatchObject({ watching: false })
    expect(await namesOf(fixture, task)).toEqual(['Vera Viewer'])
  })

  it('is closed to people outside the project and unknown for a task that is not there', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Private' })
    const missing = '00000000-0000-4000-8000-000000000000'

    const statuses = [
      (await fixture.call(fixture.outsider, 'GET', `/tasks/${task.id}/watchers`)).statusCode,
      (await fixture.call(fixture.outsider, 'PUT', `/tasks/${task.id}/watch`)).statusCode,
      (await fixture.call(fixture.owner, 'PUT', `/tasks/${missing}/watch`)).statusCode,
      (
        await ctx.app.inject({
          method: 'PUT',
          url: `/api/projects/${fixture.project.id}/tasks/${task.id}/watch`,
        })
      ).statusCode,
    ]

    expect(statuses).toEqual([404, 404, 404, 401])
    expect(await namesOf(fixture, task)).toEqual(['Olga Owner'])
  })
})

describe('what watchers hear', () => {
  it('tells everyone watching about a comment, the commenter excepted', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Discuss' })
    await fixture.call(fixture.viewer, 'PUT', `/tasks/${task.id}/watch`)

    await fixture.call(fixture.member, 'POST', `/tasks/${task.id}/comments`, { body: 'First' })
    await fixture.call(fixture.owner, 'POST', `/tasks/${task.id}/comments`, { body: 'Second' })

    expect(await notificationsOf(fixture.viewer)).toEqual([
      ['task_commented', 'Second'],
      ['task_commented', 'First'],
    ])
    // Commenting made the member a watcher, so the reply reaches them.
    expect(await notificationsOf(fixture.member)).toEqual([['task_commented', 'Second']])
    expect(await notificationsOf(fixture.owner)).toEqual([['task_commented', 'First']])
  })

  it('stops telling someone who stopped watching, the creator included', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Noisy' })
    await fixture.call(fixture.owner, 'DELETE', `/tasks/${task.id}/watch`)

    await fixture.call(fixture.member, 'POST', `/tasks/${task.id}/comments`, { body: 'Hello?' })

    expect(await notificationsOf(fixture.owner)).toEqual([])
  })

  it('tells watchers when the task goes to another column, not when it only changes place', async () => {
    const fixture = await ctx.createProject()
    const [todo, , done] = fixture.statuses
    const task = await addTask(fixture, { title: 'Moves', assigneeId: fixture.member.id })
    const other = await addTask(fixture, { title: 'Stays' })
    const move = (statusId: string | undefined, beforeTaskId: string | null) =>
      fixture.call(fixture.owner, 'POST', `/tasks/${task.id}/move`, { statusId, beforeTaskId })

    await move(todo?.id, null)
    await move(todo?.id, other.id)
    await move(done?.id, null)

    expect(await notificationsOf(fixture.member)).toEqual([
      ['task_moved', 'To Do → Done'],
      ['task_assigned', 'Moves'],
    ])
    // Not to whoever moved it.
    expect(await notificationsOf(fixture.owner)).toEqual([])
  })

  it('does not tell a watcher who has left the project', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Theirs' }, fixture.member)
    await fixture.call(fixture.owner, 'DELETE', `/members/${fixture.member.id}`)

    await fixture.call(fixture.owner, 'POST', `/tasks/${task.id}/comments`, { body: 'Anyone?' })

    expect(await notificationsOf(fixture.member)).toEqual([])
  })
})
