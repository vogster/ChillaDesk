import {
  searchResultsSchema,
  taskInContextSchema,
  type SearchResults,
  type Task,
  type TaskInContext,
  type WikiPage,
} from '@chilladesk/shared'
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

async function addPage(
  fixture: ProjectFixture,
  payload: Record<string, unknown>,
): Promise<WikiPage> {
  const response = await fixture.call(fixture.owner, 'POST', '/wiki', payload)
  expect(response.statusCode, response.body).toBe(201)
  return response.json<WikiPage>()
}

/** Makes `user` a member of another fixture's project. */
async function join(fixture: ProjectFixture, user: TestUser, role = 'member'): Promise<void> {
  const response = await fixture.call(fixture.owner, 'POST', '/members', {
    email: user.email,
    role,
  })
  expect(response.statusCode, response.body).toBe(201)
}

async function myTasks(user: TestUser, query = ''): Promise<TaskInContext[]> {
  const response = await ctx.request(user, 'GET', `/api/me/tasks${query}`)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<TaskInContext[]>()
}

async function search(user: TestUser, q: string): Promise<SearchResults> {
  const response = await ctx.request(user, 'GET', `/api/search?q=${encodeURIComponent(q)}`)
  expect(response.statusCode, response.body).toBe(200)
  return searchResultsSchema.parse(response.json())
}

const titles = (tasks: { title: string }[]) => tasks.map((task) => task.title)

describe('GET /api/me/tasks', () => {
  it('lists the tasks assigned to the user across projects, with project and status', async () => {
    const first = await ctx.createProject()
    const second = await ctx.createProject()
    const me = first.member
    await join(second, me)
    await addTask(first, { title: 'Mine in first', assigneeId: me.id })
    await addTask(second, { title: 'Mine in second', assigneeId: me.id })
    await addTask(first, { title: 'Someone else’s', assigneeId: first.owner.id })
    await addTask(first, { title: 'Nobody’s' })

    const tasks = await myTasks(me)

    expect(titles(tasks).sort()).toEqual(['Mine in first', 'Mine in second'])
    const inFirst = tasks.find((task) => task.title === 'Mine in first')
    expect(taskInContextSchema.parse(inFirst)).toMatchObject({
      project: { id: first.project.id, key: first.project.key, name: first.project.name },
      status: { name: 'To Do', category: 'todo' },
      assignee: { id: me.id },
    })
  })

  it('leaves out finished tasks unless asked for them', async () => {
    const fixture = await ctx.createProject()
    const me = fixture.member
    const [, , done] = fixture.statuses
    await addTask(fixture, { title: 'Open', assigneeId: me.id })
    await addTask(fixture, { title: 'Finished', assigneeId: me.id, statusId: done?.id })

    expect(titles(await myTasks(me))).toEqual(['Open'])
    expect(titles(await myTasks(me, '?includeDone=true')).sort()).toEqual(['Finished', 'Open'])
  })

  it('puts the earliest due date first, then the highest priority, undated tasks last', async () => {
    const fixture = await ctx.createProject()
    const me = fixture.member
    const add = (title: string, extra: Record<string, unknown>) =>
      addTask(fixture, { title, assigneeId: me.id, ...extra })
    await add('No date, low', { priority: 'low' })
    await add('Later', { dueDate: '2030-06-01' })
    await add('No date, urgent', { priority: 'urgent' })
    await add('Sooner', { dueDate: '2030-01-01' })

    expect(titles(await myTasks(me))).toEqual([
      'Sooner',
      'Later',
      'No date, urgent',
      'No date, low',
    ])
  })

  it('drops the tasks of a project the user has left', async () => {
    const fixture = await ctx.createProject()
    const me = fixture.member
    await addTask(fixture, { title: 'Was mine', assigneeId: me.id })

    await fixture.call(me, 'DELETE', `/members/${me.id}`)

    expect(await myTasks(me)).toEqual([])
  })

  it('requires a session and rejects an unknown flag value', async () => {
    const user = await ctx.signUp()

    const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/me/tasks' })
    const invalid = await ctx.request(user, 'GET', '/api/me/tasks?includeDone=yes')

    expect([anonymous.statusCode, invalid.statusCode]).toEqual([401, 400])
  })
})

describe('GET /api/search', () => {
  async function seeded() {
    const mine = await ctx.createProject()
    const alsoMine = await ctx.createProject()
    const foreign = await ctx.createProject()
    const me = mine.viewer
    await join(alsoMine, me, 'viewer')
    await addTask(mine, { title: 'Deploy pipeline', description: 'Runs on every push' })
    await addTask(alsoMine, { title: 'Write runbook', description: 'How to deploy by hand' })
    await addTask(foreign, { title: 'Deploy secret thing' })
    await addPage(mine, { title: 'Deployment', content: 'Use docker compose.' })
    await addPage(alsoMine, { title: 'Glossary', content: 'Deploy: to ship a version, 100% done.' })
    await addPage(foreign, { title: 'Deploy internals' })
    return { mine, alsoMine, foreign, me }
  }

  it('finds tasks and wiki pages in every project of the user, and only there', async () => {
    const { me, mine, alsoMine } = await seeded()

    const results = await search(me, 'DEPLOY')

    expect(titles(results.tasks)).toEqual(['Deploy pipeline', 'Write runbook'])
    expect(results.tasks.map((task) => task.project.key)).toEqual([
      mine.project.key,
      alsoMine.project.key,
    ])
    expect(titles(results.pages)).toEqual(['Deployment', 'Glossary'])
    expect(results.pages[0]?.project).toMatchObject({ id: mine.project.id })
  })

  it('puts matches in the title before matches in the text', async () => {
    const { me } = await seeded()

    const results = await search(me, 'deploy')

    expect(titles(results.tasks)[0]).toBe('Deploy pipeline')
    expect(titles(results.pages)[0]).toBe('Deployment')
  })

  it('finds a task by its key, in any case', async () => {
    const { me, mine } = await seeded()
    await addTask(mine, { title: 'Second task here' })

    const results = await search(me, `${mine.project.key.toLowerCase()}-2`)

    expect(titles(results.tasks)).toEqual(['Second task here'])
  })

  it('treats % and _ as ordinary characters', async () => {
    const { me } = await seeded()

    expect(titles((await search(me, '100%')).pages)).toEqual(['Glossary'])
    expect(await search(me, '%%')).toEqual({ tasks: [], pages: [] })
    expect(await search(me, '__')).toEqual({ tasks: [], pages: [] })
  })

  it('returns at most twenty of each kind', async () => {
    const fixture = await ctx.createProject()
    for (let index = 0; index < 23; index += 1) {
      await addTask(fixture, { title: `Bulk item ${index}` })
    }

    const results = await search(fixture.viewer, 'bulk item')

    expect(results.tasks).toHaveLength(20)
  })

  it('requires a session and at least two characters', async () => {
    const user = await ctx.signUp()

    const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/search?q=deploy' })
    const tooShort = await ctx.request(user, 'GET', '/api/search?q=d')
    const missing = await ctx.request(user, 'GET', '/api/search')

    expect([anonymous.statusCode, tooShort.statusCode, missing.statusCode]).toEqual([401, 400, 400])
  })
})
