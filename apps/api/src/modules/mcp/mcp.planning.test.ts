import type { Task } from '@chilladesk/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, type ProjectFixture, type TestContext } from '../../test/harness'
import { mcpClient } from '../../test/mcp'

let ctx: TestContext
const { tokenFor, call, expectData, expectError } = mcpClient(() => ctx)

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

async function setup() {
  const fixture: ProjectFixture = await ctx.createProject()
  return {
    fixture,
    key: fixture.project.key,
    token: await tokenFor(fixture.member),
    reader: await tokenFor(fixture.member, 'read'),
  }
}

interface FullTask {
  key: string
  milestone: string | null
  checklist: { number: number; text: string; done: boolean }[]
  links: { relation: string; task: string; title: string; done: boolean }[]
  attachments: { fileName: string; size: number }[]
}

describe('milestones over MCP', () => {
  it('creates, lists, updates milestones and puts tasks on them by name', async () => {
    const { key, token } = await setup()

    await expectData(
      call(token, 'create_milestone', { project: key, name: 'v1', dueDate: '2030-01-01' }),
    )
    await expectData(call(token, 'create_milestone', { project: key, name: 'Later' }))
    const created = await expectData<{ key: string; milestone: string | null }>(
      call(token, 'create_task', { project: key, title: 'Ship', milestone: 'v1' }),
    )
    await expectData(call(token, 'create_task', { project: key, title: 'Unplanned' }))
    const updated = await expectData(
      call(token, 'update_milestone', {
        project: key,
        milestone: 'V1',
        newName: 'v1.0',
        closed: true,
      }),
    )

    expect(created.milestone).toBe('v1')
    expect(updated).toEqual({ name: 'v1.0', dueDate: '2030-01-01', closed: true })
    expect(await expectData(call(token, 'list_milestones', { project: key }))).toEqual([
      { name: 'Later', dueDate: null, closed: false, tasksDone: 0, tasksTotal: 0 },
      { name: 'v1.0', dueDate: '2030-01-01', closed: true, tasksDone: 0, tasksTotal: 1 },
    ])
    const project = await expectData<{ milestones: { name: string }[] }>(
      call(token, 'get_project', { project: key }),
    )
    // A closed milestone is not offered for new work.
    expect(project.milestones).toEqual([{ name: 'Later', dueDate: null }])
    const listed = await expectData<{ tasks: { title: string }[] }>(
      call(token, 'list_tasks', { project: key, milestone: 'none' }),
    )
    expect(listed.tasks.map((task) => task.title)).toEqual(['Unplanned'])
  })

  it('moves a task between milestones and off them, and names what it does not know', async () => {
    const { key, token } = await setup()
    await expectData(call(token, 'create_milestone', { project: key, name: 'Alpha' }))
    const task = await expectData<{ key: string }>(
      call(token, 'create_task', { project: key, title: 'Wanders', milestone: 'Alpha' }),
    )

    const off = await expectData<{ milestone: string | null }>(
      call(token, 'update_task', { key: task.key, milestone: null }),
    )
    const unknown = await expectError(
      call(token, 'update_task', { key: task.key, milestone: 'Beta' }),
    )

    expect(off.milestone).toBeNull()
    expect(unknown).toBe('Unknown milestone "Beta". This project has: "Alpha"')
  })
})

describe('checklists, links and labels over MCP', () => {
  it('builds a checklist and ticks items by number or text', async () => {
    const { key, token } = await setup()
    const task = await expectData<{ key: string }>(
      call(token, 'create_task', { project: key, title: 'Release' }),
    )

    await expectData(call(token, 'add_checklist_item', { key: task.key, text: 'Changelog' }))
    await expectData(call(token, 'add_checklist_item', { key: task.key, text: 'Tag' }))
    await expectData(call(token, 'check_checklist_item', { key: task.key, item: 2, done: true }))
    const after = await expectData(
      call(token, 'check_checklist_item', { key: task.key, item: 'changelog', done: true }),
    )
    const missing = await expectError(
      call(token, 'check_checklist_item', { key: task.key, item: 5, done: true }),
    )

    expect(after).toEqual([
      { number: 1, text: 'Changelog', done: true },
      { number: 2, text: 'Tag', done: true },
    ])
    expect(missing).toContain('which has 2')
  })

  it('links tasks of one project and shows everything in get_task', async () => {
    const { fixture, key, token } = await setup()
    const [api, ui] = [
      await expectData<{ key: string }>(call(token, 'create_task', { project: key, title: 'API' })),
      await expectData<{ key: string }>(call(token, 'create_task', { project: key, title: 'UI' })),
    ]
    const uiTask = (await fixture.call(fixture.owner, 'GET', '/tasks/by-number/2')).json<Task>()
    await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${fixture.project.id}/tasks/${uiTask.id}/attachments`,
      headers: {
        ...fixture.owner.headers,
        'content-type': 'text/plain',
        'x-file-name': 'spec.txt',
      },
      payload: Buffer.from('spec'),
    })

    const links = await expectData(
      call(token, 'link_tasks', { key: ui.key, relation: 'blocked_by', otherKey: api.key }),
    )
    await expectData(call(token, 'add_checklist_item', { key: ui.key, text: 'Wire it' }))
    const full = await expectData<FullTask>(call(token, 'get_task', { key: ui.key }))
    const fromOtherSide = await expectData<FullTask>(call(token, 'get_task', { key: api.key }))

    expect(links).toEqual([{ relation: 'blocked_by', task: api.key, done: false }])
    expect(full.links).toEqual([
      { relation: 'blocked_by', task: api.key, title: 'API', done: false },
    ])
    expect(full.checklist).toEqual([{ number: 1, text: 'Wire it', done: false }])
    expect(full.attachments).toMatchObject([{ fileName: 'spec.txt', size: 4 }])
    expect(fromOtherSide.links).toMatchObject([{ relation: 'blocks', task: ui.key }])
  })

  it('refuses to link tasks of two projects', async () => {
    const { key, token, fixture } = await setup()
    const other = await ctx.createProject()
    await ctx.request(other.owner, 'POST', `/api/projects/${other.project.id}/members`, {
      email: fixture.member.email,
      role: 'member',
    })
    const here = await expectData<{ key: string }>(
      call(token, 'create_task', { project: key, title: 'Here' }),
    )
    const there = await expectData<{ key: string }>(
      call(token, 'create_task', { project: other.project.key, title: 'There' }),
    )

    const message = await expectError(
      call(token, 'link_tasks', { key: here.key, relation: 'relates_to', otherKey: there.key }),
    )

    expect(message).toBe('Only tasks of the same project can be linked')
  })

  it('creates labels that tasks can then carry', async () => {
    const { key, token } = await setup()

    const label = await expectData(
      call(token, 'create_label', { project: key, name: 'bug', color: 'red' }),
    )
    const task = await expectData<{ labels: string[] }>(
      call(token, 'create_task', { project: key, title: 'Broken', labels: ['bug'] }),
    )

    expect(label).toEqual({ name: 'bug', color: 'red' })
    expect(task.labels).toEqual(['bug'])
  })

  it('watches and unwatches a task for the token owner', async () => {
    const { fixture, key, token } = await setup()
    const task = await expectData<{ key: string }>(
      call(token, 'create_task', { project: key, title: 'Watched' }),
    )

    const stopped = await expectData(call(token, 'watch_task', { key: task.key, watching: false }))
    const started = await expectData(call(token, 'watch_task', { key: task.key, watching: true }))

    expect(stopped).toEqual({ watching: false, watchers: [] })
    expect(started).toEqual({ watching: true, watchers: [fixture.member.email] })
  })
})

describe('notifications over MCP', () => {
  it('lists the unread notifications of the token owner and marks them read', async () => {
    const { fixture, key, token } = await setup()
    await fixture.call(fixture.owner, 'POST', '/tasks', {
      title: 'For you',
      assigneeId: fixture.member.id,
    })

    const inbox = await expectData<{
      unreadCount: number
      notifications: { id: string; type: string; from: string; project: string; task: string }[]
    }>(call(token, 'list_notifications', {}))
    const after = await expectData(
      call(token, 'mark_notifications_read', {
        ids: inbox.notifications.map((item) => item.id),
      }),
    )
    const empty = await expectData<{ notifications: unknown[] }>(
      call(token, 'list_notifications', {}),
    )
    const all = await expectData<{ notifications: { read: boolean }[] }>(
      call(token, 'list_notifications', { unreadOnly: false }),
    )

    expect(inbox.unreadCount).toBe(1)
    expect(inbox.notifications).toMatchObject([
      { type: 'task_assigned', from: fixture.owner.email, project: key, task: `${key}-1` },
    ])
    expect(after).toEqual({ unreadCount: 0 })
    expect(empty.notifications).toEqual([])
    expect(all.notifications).toMatchObject([{ read: true }])
  })
})

describe('read-only tokens', () => {
  it('can read but not use any of the new write tools', async () => {
    const { key, reader } = await setup()

    expect(await expectData(call(reader, 'list_milestones', { project: key }))).toEqual([])
    expect(await expectData(call(reader, 'list_notifications', {}))).toMatchObject({
      unreadCount: 0,
    })
    for (const [name, args] of [
      ['create_milestone', { project: key, name: 'x' }],
      ['create_label', { project: key, name: 'x' }],
      ['mark_notifications_read', {}],
    ] as const) {
      expect(await expectError(call(reader, name, args))).toContain('read-only')
    }
  })
})
