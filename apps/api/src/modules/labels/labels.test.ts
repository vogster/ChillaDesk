import { labelSchema, type Label, type Task, type TaskList } from '@chillawiki/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, type ProjectFixture, type TestContext } from '../../test/harness'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

async function addLabel(
  fixture: ProjectFixture,
  name: string,
  color?: Label['color'],
): Promise<Label> {
  const response = await fixture.call(fixture.member, 'POST', '/labels', {
    name,
    ...(color ? { color } : {}),
  })
  expect(response.statusCode, response.body).toBe(201)
  return response.json<Label>()
}

async function addTask(fixture: ProjectFixture, payload: Record<string, unknown>): Promise<Task> {
  const response = await fixture.call(fixture.member, 'POST', '/tasks', payload)
  expect(response.statusCode, response.body).toBe(201)
  return response.json<Task>()
}

const names = (labels: Label[]) => labels.map((label) => label.name)
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

describe('managing labels', () => {
  it('creates labels and lists them by name, ignoring case', async () => {
    const fixture = await ctx.createProject()
    await addLabel(fixture, 'feature', 'green')
    const bug = await addLabel(fixture, ' Bug ', 'red')
    await addLabel(fixture, 'chore')

    const list = await fixture.call(fixture.viewer, 'GET', '/labels')

    expect(labelSchema.parse(bug)).toMatchObject({ name: 'Bug', color: 'red' })
    expect(list.json<Label[]>()).toMatchObject([
      { name: 'Bug', color: 'red' },
      { name: 'chore', color: 'gray' },
      { name: 'feature', color: 'green' },
    ])
  })

  it('keeps names unique within a project, ignoring case, but not across projects', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    await addLabel(fixture, 'Bug')

    const duplicate = await fixture.call(fixture.member, 'POST', '/labels', { name: 'bug' })
    const elsewhere = await other.call(other.member, 'POST', '/labels', { name: 'Bug' })

    expect(duplicate.statusCode).toBe(409)
    expect(elsewhere.statusCode).toBe(201)
  })

  it('renames and recolours a label, refusing a name that is taken', async () => {
    const fixture = await ctx.createProject()
    await addLabel(fixture, 'Bug')
    const label = await addLabel(fixture, 'Feature')
    const patch = (payload: Record<string, unknown>) =>
      fixture.call(fixture.member, 'PATCH', `/labels/${label.id}`, payload)

    const updated = await patch({ name: 'Improvement', color: 'blue' })
    const taken = await patch({ name: 'BUG' })

    expect(updated.json()).toEqual({ id: label.id, name: 'Improvement', color: 'blue' })
    expect(taken.statusCode).toBe(409)
  })

  it('is read-only for viewers and hidden from outsiders', async () => {
    const fixture = await ctx.createProject()
    const label = await addLabel(fixture, 'Bug')

    const responses = await Promise.all([
      fixture.call(fixture.viewer, 'POST', '/labels', { name: 'X' }),
      fixture.call(fixture.viewer, 'PATCH', `/labels/${label.id}`, { name: 'X' }),
      fixture.call(fixture.viewer, 'DELETE', `/labels/${label.id}`),
      fixture.call(fixture.outsider, 'GET', '/labels'),
    ])

    expect(responses.map((response) => response.statusCode)).toEqual([403, 403, 403, 404])
  })

  it('does not reach a label of another project', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    const foreign = await addLabel(other, 'Foreign')

    const responses = await Promise.all([
      fixture.call(fixture.owner, 'PATCH', `/labels/${foreign.id}`, { name: 'Hijacked' }),
      fixture.call(fixture.owner, 'DELETE', `/labels/${foreign.id}`),
      fixture.call(fixture.owner, 'DELETE', `/labels/${UNKNOWN_ID}`),
    ])

    expect(responses.map((response) => response.statusCode)).toEqual([404, 404, 404])
    expect(names((await other.call(other.viewer, 'GET', '/labels')).json<Label[]>())).toEqual([
      'Foreign',
    ])
  })
})

describe('labels on tasks', () => {
  it('puts labels on a new task, sorted by name', async () => {
    const fixture = await ctx.createProject()
    const urgent = await addLabel(fixture, 'urgent', 'red')
    const bug = await addLabel(fixture, 'Bug')

    const task = await addTask(fixture, { title: 'Crash', labelIds: [urgent.id, bug.id] })
    const plain = await addTask(fixture, { title: 'Plain' })

    expect(task.labels).toEqual([
      { id: bug.id, name: 'Bug', color: 'gray' },
      { id: urgent.id, name: 'urgent', color: 'red' },
    ])
    expect(plain.labels).toEqual([])
  })

  it('replaces the labels of a task and leaves its other fields alone', async () => {
    const fixture = await ctx.createProject()
    const bug = await addLabel(fixture, 'Bug')
    const feature = await addLabel(fixture, 'Feature')
    const task = await addTask(fixture, { title: 'Keep me', priority: 'high', labelIds: [bug.id] })
    const patch = (payload: Record<string, unknown>) =>
      fixture.call(fixture.member, 'PATCH', `/tasks/${task.id}`, payload)

    const swapped = await patch({ labelIds: [feature.id] })
    const untouched = await patch({ title: 'Renamed' })
    const cleared = await patch({ labelIds: [] })

    expect(swapped.json<Task>()).toMatchObject({ title: 'Keep me', priority: 'high' })
    expect(names(swapped.json<Task>().labels)).toEqual(['Feature'])
    expect(names(untouched.json<Task>().labels)).toEqual(['Feature'])
    expect(cleared.json<Task>().labels).toEqual([])
  })

  it('rejects labels that are unknown or belong to another project', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    const foreign = await addLabel(other, 'Foreign')
    const task = await addTask(fixture, { title: 'Guarded' })

    const responses = await Promise.all([
      fixture.call(fixture.member, 'POST', '/tasks', { title: 'Bad', labelIds: [foreign.id] }),
      fixture.call(fixture.member, 'POST', '/tasks', { title: 'Bad', labelIds: [UNKNOWN_ID] }),
      fixture.call(fixture.member, 'PATCH', `/tasks/${task.id}`, { labelIds: [foreign.id] }),
    ])

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400])
    const list = (await fixture.call(fixture.viewer, 'GET', '/tasks')).json<TaskList>()
    expect(list.items.map((item) => item.title)).toEqual(['Guarded'])
  })

  it('returns labels in task lists and filters by one label', async () => {
    const fixture = await ctx.createProject()
    const bug = await addLabel(fixture, 'Bug')
    const feature = await addLabel(fixture, 'Feature')
    await addTask(fixture, { title: 'Both', labelIds: [bug.id, feature.id] })
    await addTask(fixture, { title: 'Bug only', labelIds: [bug.id] })
    await addTask(fixture, { title: 'None' })
    const list = async (query = '') =>
      (await fixture.call(fixture.viewer, 'GET', `/tasks${query}`)).json<TaskList>()

    const all = await list()
    const bugs = await list(`?labelId=${bug.id}`)
    const features = await list(`?labelId=${feature.id}`)

    expect(all.items.map((task) => names(task.labels))).toEqual([['Bug', 'Feature'], ['Bug'], []])
    expect(bugs).toMatchObject({ total: 2, items: [{ title: 'Both' }, { title: 'Bug only' }] })
    expect(features).toMatchObject({ total: 1, items: [{ title: 'Both' }] })
  })

  it('shows a renamed label on its tasks and removes a deleted one from them', async () => {
    const fixture = await ctx.createProject()
    const bug = await addLabel(fixture, 'Bug')
    const keep = await addLabel(fixture, 'Keep')
    const task = await addTask(fixture, { title: 'Labelled', labelIds: [bug.id, keep.id] })
    const read = async () =>
      (await fixture.call(fixture.viewer, 'GET', `/tasks/${task.id}`)).json<Task>()

    await fixture.call(fixture.member, 'PATCH', `/labels/${bug.id}`, { name: 'Defect' })
    const renamed = await read()
    const removal = await fixture.call(fixture.member, 'DELETE', `/labels/${bug.id}`)
    const afterDelete = await read()

    expect(names(renamed.labels)).toEqual(['Defect', 'Keep'])
    expect(removal.statusCode).toBe(204)
    expect(names(afterDelete.labels)).toEqual(['Keep'])
  })
})
