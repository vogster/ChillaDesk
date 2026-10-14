import type {
  ChecklistItem,
  ImportResult,
  Label,
  Milestone,
  Status,
  Task,
  TaskList,
  WikiPage,
} from '@chilladesk/shared'
import { IMPORT_MAX_BYTES } from '@chilladesk/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  type ProjectFixture,
  type TestContext,
  type TestUser,
} from '../../test/harness'
import { labels } from '../../db/schema'
import { MAX_LABELS } from '../labels/service'
import { parseCsv } from './csv'
import { readZip } from '../../test/zip'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

const exportFile = (fixture: ProjectFixture, file: string, user: TestUser = fixture.viewer) =>
  ctx.app.inject({
    method: 'GET',
    url: `/api/projects/${fixture.project.id}/export/${file}`,
    headers: user.headers,
  })

function importFile(
  fixture: ProjectFixture,
  content: string | Buffer,
  { format = 'csv', user = fixture.owner }: { format?: string; user?: TestUser } = {},
) {
  return ctx.app.inject({
    method: 'POST',
    url: `/api/projects/${fixture.project.id}/import/tasks?format=${format}`,
    headers: {
      ...user.headers,
      'content-type': format === 'trello' ? 'application/json' : 'text/csv',
    },
    payload: typeof content === 'string' ? Buffer.from(content) : content,
  })
}

async function imported(fixture: ProjectFixture, content: string, format = 'csv') {
  const response = await importFile(fixture, content, { format })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<ImportResult>()
}

async function tasksOf(fixture: ProjectFixture): Promise<Task[]> {
  const response = await fixture.call(fixture.owner, 'GET', '/tasks?sort=number&order=asc')
  expect(response.statusCode, response.body).toBe(200)
  return response.json<TaskList>().items
}

async function json<T>(fixture: ProjectFixture, path: string): Promise<T> {
  const response = await fixture.call(fixture.owner, 'GET', path)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}

describe('exporting tasks', () => {
  it('gives every task with its details as CSV to anyone in the project', async () => {
    const fixture = await ctx.createProject()
    const label = (
      await fixture.call(fixture.owner, 'POST', '/labels', { name: 'bug', color: 'red' })
    ).json<Label>()
    const milestone = (
      await fixture.call(fixture.owner, 'POST', '/milestones', { name: 'v1' })
    ).json<Milestone>()
    const task = (
      await fixture.call(fixture.owner, 'POST', '/tasks', {
        title: '=cmd|calc',
        description: 'Line one\nline, two',
        priority: 'high',
        assigneeId: fixture.member.id,
        dueDate: '2026-05-01',
        milestoneId: milestone.id,
        labelIds: [label.id],
      })
    ).json<Task>()
    await fixture.call(fixture.owner, 'POST', `/tasks/${task.id}/checklist`, { text: 'Step' })

    const response = await exportFile(fixture, 'tasks.csv')

    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="${fixture.project.key}-tasks.csv"`,
    )
    const [header, row] = parseCsv(response.body)
    const record = Object.fromEntries((header ?? []).map((name, index) => [name, row?.[index]]))
    expect(record).toMatchObject({
      Key: task.key,
      Title: "'=cmd|calc",
      Status: fixture.statuses[0]?.name,
      Priority: 'high',
      Assignee: fixture.member.email,
      Reporter: fixture.owner.email,
      'Due date': '2026-05-01',
      Milestone: 'v1',
      Labels: 'bug',
      Checklist: '[ ] Step',
      Description: 'Line one\nline, two',
    })
  })

  it('names people who have left the project instead of giving their email', async () => {
    const fixture = await ctx.createProject()
    await fixture.call(fixture.member, 'POST', '/tasks', { title: 'Left behind' })
    const removed = await fixture.call(fixture.owner, 'DELETE', `/members/${fixture.member.id}`)
    expect(removed.statusCode, removed.body).toBe(204)

    const [header, row] = parseCsv((await exportFile(fixture, 'tasks.csv')).body)
    expect(row?.[header?.indexOf('Reporter') ?? -1]).toBe('Max Member')
    expect((await exportFile(fixture, 'tasks.csv')).body).not.toContain(fixture.member.email)
  })

  it('is refused to those outside the project', async () => {
    const fixture = await ctx.createProject()
    expect((await exportFile(fixture, 'tasks.csv', fixture.outsider)).statusCode).toBe(404)
    expect((await exportFile(fixture, 'wiki.zip', fixture.outsider)).statusCode).toBe(404)
    const anonymous = await ctx.app.inject({
      method: 'GET',
      url: `/api/projects/${fixture.project.id}/export/tasks.csv`,
    })
    expect(anonymous.statusCode).toBe(401)
  })
})

describe('exporting the wiki', () => {
  it('gives the page tree as a ZIP of Markdown files', async () => {
    const fixture = await ctx.createProject()
    const home = (
      await fixture.call(fixture.member, 'POST', '/wiki', { title: 'Главная', content: 'Hi' })
    ).json<WikiPage>()
    await fixture.call(fixture.member, 'POST', '/wiki', {
      title: 'Setup: Linux',
      content: 'apt install',
      parentId: home.id,
    })

    const response = await exportFile(fixture, 'wiki.zip')

    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['content-type']).toBe('application/zip')
    const files = readZip(response.rawPayload)
    expect([...files.keys()]).toEqual(['Главная.md', 'Главная/Setup- Linux.md'])
    expect(files.get('Главная/Setup- Linux.md')).toBe('# Setup: Linux\n\napt install\n')
  })
})

describe('importing tasks from CSV', () => {
  it('creates tasks and the labels, milestones and columns they name', async () => {
    const fixture = await ctx.createProject()
    const csv = [
      'Title;Status;Priority;Assignee;Due date;Milestone;Labels;Checklist;Description',
      `First;${fixture.statuses[2]?.name};urgent;${fixture.member.email};01.05.2026;v2;"bug, ui";"[x] One\n[ ] Two";Text`,
      'Second;Waiting for QA;low;Max Member;;;;;',
      'Third;Done;;nobody@example.com;someday;;;;',
    ].join('\n')

    const result = await imported(fixture, csv)

    expect(result.created).toBe(3)
    expect(result.skipped).toEqual([])
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        'Added the column "Waiting for QA"',
        '"nobody@example.com" is not a member of this project; left unassigned',
        'Could not read the date "someday"',
      ]),
    )
    const [first, second, third] = await tasksOf(fixture)
    const statuses = await json<Status[]>(fixture, '/statuses')
    expect(statuses.at(-1)?.name).toBe('Waiting for QA')
    expect(first).toMatchObject({
      title: 'First',
      description: 'Text',
      priority: 'urgent',
      statusId: fixture.statuses[2]?.id,
      assignee: { id: fixture.member.id },
      dueDate: '2026-05-01',
      milestone: { name: 'v2' },
      checklist: { done: 1, total: 2 },
    })
    expect(first?.labels.map((label) => label.name).sort()).toEqual(['bug', 'ui'])
    expect(second).toMatchObject({
      statusId: statuses.at(-1)?.id,
      assignee: { id: fixture.member.id },
      priority: 'low',
    })
    // "Done" names no column here, but says which kind it is.
    expect(third).toMatchObject({
      statusId: statuses.find((status) => status.category === 'done')?.id,
      assignee: null,
      dueDate: null,
    })
    const items = await json<ChecklistItem[]>(fixture, `/tasks/${first?.id}/checklist`)
    expect(items.map(({ text, done }) => ({ text, done }))).toEqual([
      { text: 'One', done: true },
      { text: 'Two', done: false },
    ])
  })

  it('brings an exported project into another one as it was', async () => {
    const source = await ctx.createProject()
    const label = (
      await source.call(source.owner, 'POST', '/labels', { name: 'api' })
    ).json<Label>()
    for (const title of ['One', 'Two']) {
      await source.call(source.owner, 'POST', '/tasks', {
        title,
        labelIds: [label.id],
        statusId: source.statuses[1]?.id,
      })
    }
    const csv = (await exportFile(source, 'tasks.csv')).body

    const target = await ctx.createProject()
    const result = await imported(target, csv)

    expect(result).toEqual({ created: 2, skipped: [], warnings: [] })
    const tasks = await tasksOf(target)
    expect(tasks.map((task) => [task.title, task.statusId, task.labels[0]?.name])).toEqual([
      ['One', target.statuses[1]?.id, 'api'],
      ['Two', target.statuses[1]?.id, 'api'],
    ])
  })

  it('notifies nobody, not even an assignee or someone mentioned', async () => {
    const fixture = await ctx.createProject()
    const csv = `Title,Assignee,Description\nHello,${fixture.member.email},Ping @${fixture.viewer.email}`

    await imported(fixture, csv)

    for (const user of [fixture.member, fixture.viewer]) {
      const inbox = await ctx.request(user, 'GET', '/api/notifications')
      expect(inbox.json<{ unreadCount: number }>().unreadCount).toBe(0)
    }
  })

  it('reports rows it skipped and changes nothing when the file cannot be read', async () => {
    const fixture = await ctx.createProject()
    const result = await imported(fixture, 'Title,Status\nGood,\n,Done\n')
    expect(result).toMatchObject({ created: 1, skipped: [{ row: 3, reason: 'No title' }] })

    const unreadable = await importFile(fixture, 'Key,Status\nT-1,Done')
    expect(unreadable.statusCode).toBe(400)
    expect(unreadable.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } })
    expect(await tasksOf(fixture)).toHaveLength(1)
  })

  it('shortens what is too long instead of losing the task', async () => {
    const fixture = await ctx.createProject()
    const result = await imported(fixture, `Title,Labels\n${'x'.repeat(250)},${'y'.repeat(50)}`)
    expect(result.created).toBe(1)
    expect(result.warnings).toContain('Titles longer than 200 characters were shortened')
    const [task] = await tasksOf(fixture)
    expect(task?.title).toHaveLength(200)
    expect(task?.labels[0]?.name).toHaveLength(40)
  })
})

describe('limits of an import', () => {
  it('puts at most the per-task number of labels on a task and makes no more', async () => {
    const fixture = await ctx.createProject()
    const many = Array.from({ length: 500 }, (_, index) => `l${index}`).join(', ')

    const result = await imported(fixture, `Title,Labels\nOne,"${many}"`)

    expect(result.warnings).toContain('A task can have at most 20 labels; the rest were left out')
    expect(await json<Label[]>(fixture, '/labels')).toHaveLength(20)
  })

  it('makes no labels past the project limit', async () => {
    const fixture = await ctx.createProject()
    await ctx.database.db.insert(labels).values(
      Array.from({ length: MAX_LABELS }, (_, index) => ({
        projectId: fixture.project.id,
        name: `label ${index}`,
      })),
    )

    const result = await imported(fixture, 'Title,Labels\nOne,"label 1, fresh"')

    expect(result.created).toBe(1)
    expect(result.warnings).toContain('The project has too many labels; "fresh" was not added')
    const [task] = await tasksOf(fixture)
    expect(task?.labels.map((label) => label.name)).toEqual(['label 1'])
  })
})

describe('importing a Trello board', () => {
  it('turns cards into tasks and lists into columns', async () => {
    const fixture = await ctx.createProject()
    const board = {
      lists: [{ id: 'l1', name: 'Ideas' }],
      labels: [{ id: 'g', name: 'Feature', color: 'green' }],
      cards: [
        { id: 'c1', name: 'Dark theme', desc: 'Please', idList: 'l1', idLabels: ['g'] },
        { id: 'c2', name: 'Gone', idList: 'l1', closed: true },
      ],
      checklists: [{ idCard: 'c1', checkItems: [{ name: 'Colors', state: 'complete' }] }],
    }

    const result = await imported(fixture, JSON.stringify(board), 'trello')

    expect(result.created).toBe(1)
    expect(result.skipped).toEqual([{ row: 2, reason: 'Archived card "Gone"' }])
    const [task] = await tasksOf(fixture)
    expect(task).toMatchObject({
      title: 'Dark theme',
      description: 'Please',
      labels: [{ name: 'Feature', color: 'green' }],
      checklist: { done: 1, total: 1 },
    })
    const statuses = await json<Status[]>(fixture, '/statuses')
    expect(statuses.find((status) => status.id === task?.statusId)?.name).toBe('Ideas')
  })
})

describe('who may import', () => {
  it('lets only owners import', async () => {
    const fixture = await ctx.createProject()
    for (const [user, status] of [
      [fixture.member, 403],
      [fixture.viewer, 403],
      [fixture.outsider, 404],
    ] as const) {
      expect((await importFile(fixture, 'Title\nX', { user })).statusCode).toBe(status)
    }
    const anonymous = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${fixture.project.id}/import/tasks`,
      headers: { 'content-type': 'text/csv' },
      payload: 'Title\nX',
    })
    expect(anonymous.statusCode).toBe(401)
    expect(await tasksOf(fixture)).toHaveLength(0)
  })

  it('refuses empty and oversized files and unknown formats', async () => {
    const fixture = await ctx.createProject()
    expect((await importFile(fixture, '')).statusCode).toBe(400)
    expect((await importFile(fixture, 'Title\nX', { format: 'excel' })).statusCode).toBe(400)
    const huge = Buffer.alloc(IMPORT_MAX_BYTES + 1, 'a')
    expect((await importFile(fixture, huge)).statusCode).toBe(413)
  })
})
