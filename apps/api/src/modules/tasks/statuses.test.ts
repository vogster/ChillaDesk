import { statusSchema, type Status } from '@chilladesk/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, type TestContext } from '../../test/harness'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

const names = (statuses: Status[]) => statuses.map((status) => status.name)

describe('default board', () => {
  it('gives a new project three columns in order', async () => {
    const { statuses } = await ctx.createProject()

    expect(statuses.map((status) => statusSchema.parse(status))).toMatchObject([
      { name: 'To Do', category: 'todo', position: 0 },
      { name: 'In Progress', category: 'in_progress', position: 1 },
      { name: 'Done', category: 'done', position: 2 },
    ])
  })

  it('is visible to viewers and hidden from outsiders', async () => {
    const { call, viewer, outsider } = await ctx.createProject()

    expect((await call(viewer, 'GET', '/statuses')).statusCode).toBe(200)
    expect((await call(outsider, 'GET', '/statuses')).statusCode).toBe(404)
  })
})

describe('managing columns', () => {
  it('lets the owner append a column', async () => {
    const { call, owner } = await ctx.createProject()

    const response = await call(owner, 'POST', '/statuses', { name: ' Review ' })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toMatchObject({ name: 'Review', category: 'todo', position: 3 })
  })

  it('lets the owner rename a column and change its category', async () => {
    const { call, owner, statuses } = await ctx.createProject()

    const response = await call(owner, 'PATCH', `/statuses/${statuses[1]?.id}`, {
      name: 'Doing',
      category: 'todo',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ name: 'Doing', category: 'todo', position: 1 })
  })

  it('is forbidden for members and viewers', async () => {
    const { call, member, viewer, statuses } = await ctx.createProject()
    const id = statuses[0]?.id

    const responses = await Promise.all([
      call(member, 'POST', '/statuses', { name: 'X' }),
      call(member, 'PATCH', `/statuses/${id}`, { name: 'X' }),
      call(viewer, 'DELETE', `/statuses/${id}`),
      call(member, 'PUT', '/statuses/order', { statusIds: statuses.map((status) => status.id) }),
    ])

    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 403])
  })

  it('does not reach a column of another project', async () => {
    const first = await ctx.createProject()
    const second = await ctx.createProject()
    const foreignId = second.statuses[0]?.id

    const update = await first.call(first.owner, 'PATCH', `/statuses/${foreignId}`, { name: 'X' })
    const remove = await first.call(first.owner, 'DELETE', `/statuses/${foreignId}`)

    expect(update.statusCode).toBe(404)
    expect(remove.statusCode).toBe(404)
  })
})

describe('reordering columns', () => {
  it('applies the new left-to-right order', async () => {
    const { call, owner, statuses } = await ctx.createProject()
    const [todo, doing, done] = statuses.map((status) => status.id)

    const response = await call(owner, 'PUT', '/statuses/order', { statusIds: [done, todo, doing] })

    expect(response.statusCode).toBe(200)
    expect(names(response.json<Status[]>())).toEqual(['Done', 'To Do', 'In Progress'])
    expect(names((await call(owner, 'GET', '/statuses')).json<Status[]>())).toEqual([
      'Done',
      'To Do',
      'In Progress',
    ])
  })

  it('requires every column exactly once', async () => {
    const first = await ctx.createProject()
    const second = await ctx.createProject()
    const [todo, doing, done] = first.statuses.map((status) => status.id)
    const order = (statusIds: unknown[]) =>
      first.call(first.owner, 'PUT', '/statuses/order', { statusIds })

    const responses = await Promise.all([
      order([todo, doing]),
      order([todo, doing, doing]),
      order([todo, doing, second.statuses[0]?.id]),
      order([todo, doing, done, second.statuses[0]?.id]),
    ])

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400, 400])
  })
})

describe('deleting columns', () => {
  it('removes an empty column and closes the gap', async () => {
    const { call, owner, statuses } = await ctx.createProject()

    const response = await call(owner, 'DELETE', `/statuses/${statuses[1]?.id}`)

    expect(response.statusCode).toBe(204)
    expect((await call(owner, 'GET', '/statuses')).json()).toMatchObject([
      { name: 'To Do', position: 0 },
      { name: 'Done', position: 1 },
    ])
  })

  it('refuses while the column still has tasks', async () => {
    const { call, owner, statuses } = await ctx.createProject()
    await call(owner, 'POST', '/tasks', { title: 'Blocker', statusId: statuses[2]?.id })

    const response = await call(owner, 'DELETE', `/statuses/${statuses[2]?.id}`)

    expect(response.statusCode).toBe(409)
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(/move|tasks/i)
  })

  it('keeps at least one column', async () => {
    const { call, owner, statuses } = await ctx.createProject()
    await call(owner, 'DELETE', `/statuses/${statuses[0]?.id}`)
    await call(owner, 'DELETE', `/statuses/${statuses[1]?.id}`)

    const response = await call(owner, 'DELETE', `/statuses/${statuses[2]?.id}`)

    expect(response.statusCode).toBe(409)
  })
})
