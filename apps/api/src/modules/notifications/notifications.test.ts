import {
  notificationListSchema,
  type CreatedApiToken,
  type NotificationList,
  type Task,
  type WikiPage,
} from '@chillawiki/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  type ProjectFixture,
  type TestContext,
  type TestUser,
} from '../../test/harness'
import { excerptOf } from './service'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

async function inbox(user: TestUser, query = ''): Promise<NotificationList> {
  const response = await ctx.request(user, 'GET', `/api/notifications${query}`)
  expect(response.statusCode, response.body).toBe(200)
  return notificationListSchema.parse(response.json())
}

const types = async (user: TestUser) => (await inbox(user)).items.map((item) => item.type)

async function addTask(
  fixture: ProjectFixture,
  payload: Record<string, unknown>,
  user: TestUser = fixture.owner,
): Promise<Task> {
  const response = await fixture.call(user, 'POST', '/tasks', payload)
  expect(response.statusCode, response.body).toBe(201)
  return response.json<Task>()
}

const mention = (user: TestUser) => `@${user.email}`

describe('assignment', () => {
  it('tells the assignee of a new task who assigned it and which task', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Review the PR', assigneeId: fixture.member.id })

    const { items, unreadCount } = await inbox(fixture.member)

    expect(unreadCount).toBe(1)
    expect(items).toMatchObject([
      {
        type: 'task_assigned',
        actor: { id: fixture.owner.id, name: 'Olga Owner' },
        project: { id: fixture.project.id, key: fixture.project.key },
        task: { id: task.id, key: task.key, title: 'Review the PR' },
        page: null,
        excerpt: 'Review the PR',
        readAt: null,
      },
    ])
  })

  it('tells a new assignee on reassignment, and nobody when the assignee is unchanged or cleared', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Pass around', assigneeId: fixture.member.id })
    const patch = (payload: Record<string, unknown>) =>
      fixture.call(fixture.owner, 'PATCH', `/tasks/${task.id}`, payload)

    await patch({ assigneeId: fixture.member.id, title: 'Same assignee' })
    await patch({ assigneeId: fixture.viewer.id })
    await patch({ assigneeId: null })

    expect(await types(fixture.member)).toEqual(['task_assigned'])
    const viewerInbox = await inbox(fixture.viewer)
    expect(viewerInbox.items).toMatchObject([{ type: 'task_assigned', excerpt: 'Same assignee' }])
  })

  it('tells an assignee who is also mentioned in the description only once', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, {
      title: 'Both',
      assigneeId: fixture.member.id,
      description: `For ${mention(fixture.member)} and ${mention(fixture.viewer)}`,
    })
    await fixture.call(fixture.owner, 'PATCH', `/tasks/${task.id}`, {
      assigneeId: fixture.viewer.id,
      description: `Now for ${mention(fixture.viewer)} and ${mention(fixture.owner)}`,
    })

    expect(await types(fixture.member)).toEqual(['task_assigned'])
    expect(await types(fixture.viewer)).toEqual(['task_assigned', 'mentioned'])
  })

  it('does not notify people about what they did themselves', async () => {
    const fixture = await ctx.createProject()

    await addTask(fixture, {
      title: 'Mine',
      assigneeId: fixture.owner.id,
      description: `Note to self ${mention(fixture.owner)}`,
    })

    expect((await inbox(fixture.owner)).items).toEqual([])
  })
})

describe('mentions', () => {
  it('notifies a member mentioned in a task description, a comment and a wiki page', async () => {
    const fixture = await ctx.createProject()
    const who = mention(fixture.member)
    const task = await addTask(fixture, { title: 'T', description: `Please look ${who}` })
    await fixture.call(fixture.owner, 'POST', `/tasks/${task.id}/comments`, {
      body: `Ping ${who.toUpperCase()}`,
    })
    const page = (
      await fixture.call(fixture.owner, 'POST', '/wiki', {
        title: 'Plan',
        content: `Owner: ${who}`,
      })
    ).json<WikiPage>()

    const { items } = await inbox(fixture.member)

    expect(
      items.map(({ type, task: about, page: where }) => [type, about?.id, where?.title]),
    ).toEqual([
      ['mentioned', undefined, 'Plan'],
      ['mentioned', task.id, undefined],
      ['mentioned', task.id, undefined],
    ])
    expect(items[0]).toMatchObject({ page: { id: page.id }, task: null, excerpt: `Owner: ${who}` })
  })

  it('only notifies about mentions added by an edit', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, {
      title: 'T',
      description: `First ${mention(fixture.member)}`,
    })
    const comment = (
      await fixture.call(fixture.owner, 'POST', `/tasks/${task.id}/comments`, {
        body: 'No one yet',
      })
    ).json<{ id: string }>()
    const page = (
      await fixture.call(fixture.owner, 'POST', '/wiki', { title: 'Notes', content: 'Empty' })
    ).json<WikiPage>()

    await fixture.call(fixture.owner, 'PATCH', `/tasks/${task.id}`, {
      description: `First ${mention(fixture.member)}, now also ${mention(fixture.viewer)}`,
    })
    await fixture.call(fixture.owner, 'PATCH', `/tasks/${task.id}/comments/${comment.id}`, {
      body: `Edited: ${mention(fixture.viewer)}`,
    })
    await fixture.call(fixture.owner, 'PATCH', `/wiki/${page.id}`, {
      content: `Now ${mention(fixture.viewer)}`,
      baseVersion: 1,
    })
    await fixture.call(fixture.owner, 'PATCH', `/wiki/${page.id}`, {
      title: 'Renamed',
      baseVersion: 2,
    })

    expect(await types(fixture.member)).toEqual(['mentioned'])
    expect(await types(fixture.viewer)).toEqual(['mentioned', 'mentioned', 'mentioned'])
  })

  it('ignores people outside the project, unknown addresses and mentions inside code', async () => {
    const fixture = await ctx.createProject()

    await addTask(fixture, {
      title: 'T',
      description: [
        `Outsider ${mention(fixture.outsider)} and @ghost@example.com`,
        `Quoted \`${mention(fixture.member)}\``,
      ].join('\n'),
    })

    expect((await inbox(fixture.outsider)).items).toEqual([])
    expect((await inbox(fixture.member)).items).toEqual([])
  })
})

describe('comments', () => {
  it('tells the assignee and the creator of the task, but not the commenter', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Discuss', assigneeId: fixture.member.id })

    await fixture.call(fixture.viewer, 'GET', `/tasks/${task.id}/comments`)
    await fixture.call(fixture.member, 'POST', `/tasks/${task.id}/comments`, { body: 'On it' })

    const ownerInbox = await inbox(fixture.owner)
    expect(ownerInbox.items).toMatchObject([
      { type: 'task_commented', actor: { id: fixture.member.id }, excerpt: 'On it' },
    ])
    expect(await types(fixture.member)).toEqual(['task_assigned'])
    expect(await types(fixture.viewer)).toEqual([])
  })

  it('sends one notification to someone who is both responsible and mentioned', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Discuss' })

    await fixture.call(fixture.member, 'POST', `/tasks/${task.id}/comments`, {
      body: `What do you think ${mention(fixture.owner)}?`,
    })

    expect(await types(fixture.owner)).toEqual(['mentioned'])
  })

  it('takes the notifications of a project away from someone who leaves it', async () => {
    const fixture = await ctx.createProject()
    await addTask(fixture, { title: 'Secret plan', assigneeId: fixture.member.id })
    expect((await inbox(fixture.member)).unreadCount).toBe(1)

    await fixture.call(fixture.owner, 'DELETE', `/members/${fixture.member.id}`)

    expect(await inbox(fixture.member)).toEqual({ items: [], unreadCount: 0 })
  })

  it('stops telling someone who has left the project', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Theirs' }, fixture.member)
    await fixture.call(fixture.owner, 'DELETE', `/members/${fixture.member.id}`)

    await fixture.call(fixture.owner, 'POST', `/tasks/${task.id}/comments`, { body: 'Anyone?' })

    expect((await inbox(fixture.member)).items).toEqual([])
  })
})

describe('reading notifications', () => {
  async function three() {
    const fixture = await ctx.createProject()
    for (const title of ['One', 'Two', 'Three']) {
      await addTask(fixture, { title, assigneeId: fixture.member.id })
    }
    return fixture
  }
  const markRead = (user: TestUser, payload: Record<string, unknown>) =>
    ctx.request(user, 'POST', '/api/notifications/read', payload)

  it('lists newest first and limits the page without changing the unread count', async () => {
    const fixture = await three()

    const all = await inbox(fixture.member)
    const page = await inbox(fixture.member, '?limit=2')

    expect(all.items.map((item) => item.excerpt)).toEqual(['Three', 'Two', 'One'])
    expect(page.items).toHaveLength(2)
    expect(page.unreadCount).toBe(3)
  })

  it('marks chosen notifications as read and can list only the unread ones', async () => {
    const fixture = await three()
    const [newest, middle] = (await inbox(fixture.member)).items

    const response = await markRead(fixture.member, { ids: [newest?.id, middle?.id] })

    const unread = await inbox(fixture.member, '?unread=true')
    expect(response.statusCode).toBe(204)
    expect(unread).toMatchObject({ unreadCount: 1, items: [{ excerpt: 'One' }] })
    const everything = await inbox(fixture.member)
    expect(everything.items.map((item) => item.readAt !== null)).toEqual([true, true, false])
  })

  it('marks everything as read at once', async () => {
    const fixture = await three()

    await markRead(fixture.member, {})

    expect(await inbox(fixture.member)).toMatchObject({ unreadCount: 0 })
  })

  it('cannot touch another user’s notifications', async () => {
    const fixture = await three()
    const ids = (await inbox(fixture.member)).items.map((item) => item.id)

    const response = await markRead(fixture.owner, { ids })

    expect(response.statusCode).toBe(204)
    expect((await inbox(fixture.member)).unreadCount).toBe(3)
    expect((await inbox(fixture.owner)).items).toEqual([])
  })

  it('requires a session, and a write token to mark as read', async () => {
    const fixture = await three()
    const token = (
      await ctx.request(fixture.member, 'POST', '/api/tokens', { name: 'Reader', scope: 'read' })
    ).json<CreatedApiToken>().token
    const headers = { authorization: `Bearer ${token}` }

    const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/notifications' })
    const readList = await ctx.app.inject({ method: 'GET', url: '/api/notifications', headers })
    const readMark = await ctx.app.inject({
      method: 'POST',
      url: '/api/notifications/read',
      headers,
      payload: {},
    })

    expect([anonymous.statusCode, readList.statusCode, readMark.statusCode]).toEqual([
      401, 200, 403,
    ])
  })

  it('goes away with the task it was about', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture, { title: 'Short-lived', assigneeId: fixture.member.id })

    await fixture.call(fixture.owner, 'DELETE', `/tasks/${task.id}`)

    expect(await inbox(fixture.member)).toEqual({ items: [], unreadCount: 0 })
  })
})

describe('excerptOf', () => {
  it('puts the text on one line and cuts it with an ellipsis', () => {
    expect(excerptOf('  Two\n\nlines\there ')).toBe('Two lines here')
    const long = excerptOf('word '.repeat(100))
    expect(long).toHaveLength(200)
    expect(long.endsWith('…')).toBe(true)
  })
})
