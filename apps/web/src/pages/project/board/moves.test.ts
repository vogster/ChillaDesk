import type { Status, Task } from '@chillawiki/shared'
import { describe, expect, it } from 'vitest'
import {
  applyMove,
  columnDropId,
  columnOf,
  describeDragItem,
  groupByStatus,
  isSamePlace,
  moveToColumn,
  reorderInColumn,
  targetOf,
  toOrder,
} from './moves'

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
    labels: [],
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

describe('board order while dragging', () => {
  const order = toOrder(groupByStatus(statuses, tasks))

  it('starts as the ids of each column in board order', () => {
    expect(order).toEqual({ todo: ['a', 'b', 'c'], doing: ['x', 'y'], done: [] })
  })

  it('finds the column of a card or of a column drop target', () => {
    expect(columnOf(order, 'b')).toBe('todo')
    expect(columnOf(order, columnDropId('done'))).toBe('done')
    expect(columnOf(order, 'missing')).toBeUndefined()
    expect(columnOf(order, columnDropId('missing'))).toBeUndefined()
  })

  describe('moveToColumn', () => {
    it('puts the card before the card it hovers, or after it when past its middle', () => {
      expect(moveToColumn(order, 'a', 'y', false)).toEqual({
        todo: ['b', 'c'],
        doing: ['x', 'a', 'y'],
        done: [],
      })
      expect(moveToColumn(order, 'a', 'y', true).doing).toEqual(['x', 'y', 'a'])
    })

    it('appends the card when it hovers the column itself', () => {
      expect(moveToColumn(order, 'a', columnDropId('done'), false)).toEqual({
        todo: ['b', 'c'],
        doing: ['x', 'y'],
        done: ['a'],
      })
      expect(moveToColumn(order, 'a', columnDropId('doing'), false).doing).toEqual(['x', 'y', 'a'])
    })

    it('returns the same object when the card stays in its column or a side is unknown', () => {
      expect(moveToColumn(order, 'a', 'c', true)).toBe(order)
      expect(moveToColumn(order, 'a', columnDropId('todo'), false)).toBe(order)
      expect(moveToColumn(order, 'a', 'missing', false)).toBe(order)
      expect(moveToColumn(order, 'missing', 'x', false)).toBe(order)
    })

    it('does not change the order it was given', () => {
      const before = structuredClone(order)

      moveToColumn(order, 'a', 'y', false)

      expect(order).toEqual(before)
    })
  })

  describe('reorderInColumn', () => {
    it('moves the card to the place of the card it was dropped on', () => {
      expect(reorderInColumn(order, 'a', 'c').todo).toEqual(['b', 'c', 'a'])
      expect(reorderInColumn(order, 'c', 'a').todo).toEqual(['c', 'a', 'b'])
      expect(reorderInColumn(order, 'a', 'b').todo).toEqual(['b', 'a', 'c'])
    })

    it('returns the same object when nothing moves', () => {
      expect(reorderInColumn(order, 'a', 'a')).toBe(order)
      expect(reorderInColumn(order, 'a', columnDropId('todo'))).toBe(order)
      expect(reorderInColumn(order, 'a', 'x')).toBe(order)
    })
  })

  describe('targetOf', () => {
    it('describes where the card ended up as a move request', () => {
      expect(targetOf(order, 'a')).toEqual({ statusId: 'todo', beforeTaskId: 'b' })
      expect(targetOf(order, 'c')).toEqual({ statusId: 'todo', beforeTaskId: null })
      expect(targetOf(moveToColumn(order, 'a', 'y', false), 'a')).toEqual({
        statusId: 'doing',
        beforeTaskId: 'y',
      })
      expect(targetOf(order, 'missing')).toBeNull()
    })
  })

  describe('isSamePlace', () => {
    it('recognises a card dropped back where it was', () => {
      expect(isSamePlace(tasks, 'a', { statusId: 'todo', beforeTaskId: 'b' })).toBe(true)
      expect(isSamePlace(tasks, 'c', { statusId: 'todo', beforeTaskId: null })).toBe(true)
    })

    it('sees a different neighbour or column as a move', () => {
      expect(isSamePlace(tasks, 'a', { statusId: 'todo', beforeTaskId: 'c' })).toBe(false)
      expect(isSamePlace(tasks, 'a', { statusId: 'todo', beforeTaskId: null })).toBe(false)
      expect(isSamePlace(tasks, 'c', { statusId: 'doing', beforeTaskId: null })).toBe(false)
      expect(isSamePlace(tasks, 'missing', { statusId: 'todo', beforeTaskId: null })).toBe(false)
    })
  })

  it('follows a drag across columns and then down past a card', () => {
    // "a" hovers "x" and lands before it, then is dropped on "y".
    const hovering = moveToColumn(order, 'a', 'x', false)
    const dropped = reorderInColumn(hovering, 'a', 'y')

    expect(dropped.doing).toEqual(['x', 'y', 'a'])
    expect(targetOf(dropped, 'a')).toEqual({ statusId: 'doing', beforeTaskId: null })
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
