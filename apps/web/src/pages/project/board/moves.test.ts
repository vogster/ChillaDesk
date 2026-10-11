import type { Status, Task } from '@chillawiki/shared'
import { describe, expect, it } from 'vitest'
import { applyMove, columnDropId, describeDragItem, groupByStatus, planMove } from './moves'

const TIMESTAMP = '2026-01-01T00:00:00.000Z'

const statuses: Status[] = [
  { id: 'todo', name: 'To Do', category: 'todo', position: 0 },
  { id: 'doing', name: 'In Progress', category: 'in_progress', position: 1 },
  { id: 'done', name: 'Done', category: 'done', position: 2 },
]

function task(id: string, statusId: string, position: number): Task {
  return {
    id,
    projectId: 'p',
    number: position,
    key: `P-${id}`,
    title: id,
    description: '',
    statusId,
    priority: 'medium',
    assignee: null,
    reporter: null,
    dueDate: null,
    position,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  }
}

// To Do: a, b, c — In Progress: x, y — Done: empty
const tasks = [
  task('a', 'todo', 1),
  task('b', 'todo', 2),
  task('c', 'todo', 3),
  task('x', 'doing', 1),
  task('y', 'doing', 2),
]

const ids = (list: Task[]) => list.map((item) => item.id)

describe('groupByStatus', () => {
  it('gives every status a list, sorted by position', () => {
    const grouped = groupByStatus(statuses, [tasks[2], tasks[0], tasks[4], tasks[3]] as Task[])

    expect(ids(grouped.get('todo') ?? [])).toEqual(['a', 'c'])
    expect(ids(grouped.get('doing') ?? [])).toEqual(['x', 'y'])
    expect(grouped.get('done')).toEqual([])
  })
})

describe('planMove', () => {
  const plan = (activeId: string, overId: string) => planMove(tasks, activeId, overId)

  it('returns nothing when a task is dropped on itself or on something unknown', () => {
    expect(plan('a', 'a')).toBeNull()
    expect(plan('a', 'missing')).toBeNull()
    expect(plan('missing', 'a')).toBeNull()
  })

  it('appends to a column when dropped on the column itself', () => {
    expect(plan('a', columnDropId('done'))).toEqual({ statusId: 'done', beforeTaskId: null })
    expect(plan('a', columnDropId('doing'))).toEqual({ statusId: 'doing', beforeTaskId: null })
  })

  it('does nothing when the last task is dropped on its own column', () => {
    expect(plan('c', columnDropId('todo'))).toBeNull()
  })

  it('places the task before the one it is dropped on in another column', () => {
    expect(plan('a', 'y')).toEqual({ statusId: 'doing', beforeTaskId: 'y' })
  })

  it('moves a task up within its column to just before the target', () => {
    expect(plan('c', 'a')).toEqual({ statusId: 'todo', beforeTaskId: 'a' })
  })

  it('moves a task down within its column to just after the target', () => {
    expect(plan('a', 'b')).toEqual({ statusId: 'todo', beforeTaskId: 'c' })
    expect(plan('a', 'c')).toEqual({ statusId: 'todo', beforeTaskId: null })
  })

  it('moves past the last card of a two-card column', () => {
    expect(planMove([task('a', 'todo', 1), task('b', 'todo', 2)], 'a', 'b')).toEqual({
      statusId: 'todo',
      beforeTaskId: null,
    })
  })
})

describe('describeDragItem', () => {
  it('names tasks by key and title and columns by name', () => {
    expect(describeDragItem(statuses, tasks, 'a')).toBe('P-a a')
    expect(describeDragItem(statuses, tasks, columnDropId('doing'))).toBe('the In Progress column')
  })

  it('falls back to a generic word for something unknown', () => {
    expect(describeDragItem(statuses, tasks, 'missing')).toBe('a task')
    expect(describeDragItem(statuses, tasks, columnDropId('missing'))).toBe('a column')
  })
})

describe('applyMove', () => {
  const columnAfter = (result: Task[], statusId: string) =>
    ids(groupByStatus(statuses, result).get(statusId) ?? [])

  it('moves a task to the end of another column', () => {
    const result = applyMove(tasks, 'a', { statusId: 'doing', beforeTaskId: null })

    expect(columnAfter(result, 'todo')).toEqual(['b', 'c'])
    expect(columnAfter(result, 'doing')).toEqual(['x', 'y', 'a'])
  })

  it('moves a task before another one', () => {
    const result = applyMove(tasks, 'c', { statusId: 'doing', beforeTaskId: 'y' })

    expect(columnAfter(result, 'doing')).toEqual(['x', 'c', 'y'])
  })

  it('moves a task to the very top of a column', () => {
    const result = applyMove(tasks, 'c', { statusId: 'todo', beforeTaskId: 'a' })

    expect(columnAfter(result, 'todo')).toEqual(['c', 'a', 'b'])
  })

  it('puts a task into an empty column', () => {
    const result = applyMove(tasks, 'x', { statusId: 'done', beforeTaskId: null })

    expect(columnAfter(result, 'done')).toEqual(['x'])
  })

  it('does not mutate its input', () => {
    const before = structuredClone(tasks)

    applyMove(tasks, 'a', { statusId: 'done', beforeTaskId: null })

    expect(tasks).toEqual(before)
  })

  it('returns the list unchanged for an unknown task', () => {
    expect(applyMove(tasks, 'missing', { statusId: 'done', beforeTaskId: null })).toBe(tasks)
  })
})
