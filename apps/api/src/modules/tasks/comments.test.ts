import { commentSchema, type Comment, type Task } from '@chilladesk/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, type ProjectFixture, type TestContext } from '../../test/harness'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

async function withTask(): Promise<ProjectFixture & { task: Task; comments: string }> {
  const fixture = await ctx.createProject()
  const response = await fixture.call(fixture.member, 'POST', '/tasks', { title: 'Discuss' })
  const task = response.json<Task>()
  return { ...fixture, task, comments: `/tasks/${task.id}/comments` }
}

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

describe('task comments', () => {
  it('are added by members and listed oldest first', async () => {
    const { call, member, owner, viewer, comments, task } = await withTask()

    const first = await call(member, 'POST', comments, { body: '  First **thought**  ' })
    await call(owner, 'POST', comments, { body: 'Second' })
    const list = await call(viewer, 'GET', comments)

    expect(first.statusCode).toBe(201)
    expect(commentSchema.parse(first.json())).toMatchObject({
      taskId: task.id,
      body: 'First **thought**',
      author: { id: member.id, name: 'Max Member' },
    })
    expect(list.json<Comment[]>().map((comment) => comment.body)).toEqual([
      'First **thought**',
      'Second',
    ])
  })

  it('cannot be written by viewers or seen by outsiders', async () => {
    const { call, viewer, outsider, comments } = await withTask()

    const write = await call(viewer, 'POST', comments, { body: 'Hi' })
    const read = await call(outsider, 'GET', comments)

    expect([write.statusCode, read.statusCode]).toEqual([403, 404])
  })

  it('belong to an existing task of this project', async () => {
    const { call, member } = await withTask()
    const other = await withTask()

    const unknown = await call(member, 'POST', `/tasks/${UNKNOWN_ID}/comments`, { body: 'Hi' })
    const foreign = await call(member, 'GET', other.comments)

    expect([unknown.statusCode, foreign.statusCode]).toEqual([404, 404])
  })

  it('can be edited only by their author', async () => {
    const { call, member, owner, comments } = await withTask()
    const comment = (await call(member, 'POST', comments, { body: 'Draft' })).json<Comment>()

    const byAuthor = await call(member, 'PATCH', `${comments}/${comment.id}`, { body: 'Final' })
    const byOwner = await call(owner, 'PATCH', `${comments}/${comment.id}`, { body: 'Hijack' })

    expect(byAuthor.statusCode).toBe(200)
    expect(byAuthor.json()).toMatchObject({ id: comment.id, body: 'Final' })
    expect(byOwner.statusCode).toBe(403)
  })

  it('can be deleted by their author or a project owner, not by other members', async () => {
    const { call, member, owner, viewer, comments } = await withTask()
    const mine = (await call(owner, 'POST', comments, { body: 'Owner note' })).json<Comment>()
    const theirs = (await call(member, 'POST', comments, { body: 'Member note' })).json<Comment>()
    const own = (await call(member, 'POST', comments, { body: 'Oops' })).json<Comment>()

    const memberDeletesOwners = await call(member, 'DELETE', `${comments}/${mine.id}`)
    const viewerDeletes = await call(viewer, 'DELETE', `${comments}/${theirs.id}`)
    const ownerDeletesMembers = await call(owner, 'DELETE', `${comments}/${theirs.id}`)
    const authorDeletesOwn = await call(member, 'DELETE', `${comments}/${own.id}`)

    expect([
      memberDeletesOwners.statusCode,
      viewerDeletes.statusCode,
      ownerDeletesMembers.statusCode,
      authorDeletesOwn.statusCode,
    ]).toEqual([403, 403, 204, 204])
    expect((await call(owner, 'GET', comments)).json<Comment[]>()).toHaveLength(1)
  })

  it('report unknown comments and comments addressed through another task', async () => {
    const first = await withTask()
    const second = await withTask()
    const comment = (
      await second.call(second.member, 'POST', second.comments, { body: 'Elsewhere' })
    ).json<Comment>()

    const unknown = await first.call(first.member, 'PATCH', `${first.comments}/${UNKNOWN_ID}`, {
      body: 'X',
    })
    const wrongTask = await first.call(first.owner, 'DELETE', `${first.comments}/${comment.id}`)

    expect([unknown.statusCode, wrongTask.statusCode]).toEqual([404, 404])
  })

  it('disappear together with their task', async () => {
    const { call, member, comments, task } = await withTask()
    await call(member, 'POST', comments, { body: 'Soon gone' })

    await call(member, 'DELETE', `/tasks/${task.id}`)

    expect((await call(member, 'GET', comments)).statusCode).toBe(404)
  })
})
