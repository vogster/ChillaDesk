import { describe, expect, it } from 'vitest'
import {
  commentRequestSchema,
  createStatusRequestSchema,
  createTaskRequestSchema,
  moveTaskRequestSchema,
  reorderStatusesRequestSchema,
  taskListQuerySchema,
  updateTaskRequestSchema,
} from './tasks'

const ID = '11111111-1111-4111-8111-111111111111'

describe('createTaskRequestSchema', () => {
  it('fills the defaults for a task created from just a title', () => {
    expect(createTaskRequestSchema.parse({ title: '  Write docs ' })).toEqual({
      title: 'Write docs',
      description: '',
      priority: 'medium',
      assigneeId: null,
      dueDate: null,
      labelIds: [],
    })
  })

  it.each([
    ['an empty title', { title: '   ' }],
    ['an overlong title', { title: 'x'.repeat(201) }],
    ['an unknown priority', { title: 'T', priority: 'asap' }],
    ['a malformed due date', { title: 'T', dueDate: '31.12.2026' }],
    ['an impossible due date', { title: 'T', dueDate: '2026-02-30' }],
    ['a half-typed year', { title: 'T', dueDate: '0202-05-17' }],
    ['year zero', { title: 'T', dueDate: '0000-01-01' }],
    ['a malformed assignee', { title: 'T', assigneeId: 'me' }],
  ])('rejects %s', (_label, input) => {
    expect(createTaskRequestSchema.safeParse(input).success).toBe(false)
  })
})

describe('updateTaskRequestSchema', () => {
  it('rejects an empty patch', () => {
    expect(updateTaskRequestSchema.safeParse({}).success).toBe(false)
  })

  it('lets the assignee and due date be cleared with null', () => {
    expect(updateTaskRequestSchema.parse({ assigneeId: null, dueDate: null })).toEqual({
      assigneeId: null,
      dueDate: null,
    })
  })

  it('does not accept a status change, which goes through the move endpoint', () => {
    expect(updateTaskRequestSchema.safeParse({ statusId: ID }).success).toBe(false)
  })
})

describe('moveTaskRequestSchema', () => {
  it('defaults to the end of the column', () => {
    expect(moveTaskRequestSchema.parse({ statusId: ID })).toEqual({
      statusId: ID,
      beforeTaskId: null,
    })
  })
})

describe('taskListQuerySchema', () => {
  it('coerces numbers from the query string and applies defaults', () => {
    expect(taskListQuerySchema.parse({ limit: '20', offset: '40' })).toEqual({
      sort: 'board',
      order: 'asc',
      limit: 20,
      offset: 40,
    })
    expect(taskListQuerySchema.parse({})).toEqual({
      sort: 'board',
      order: 'asc',
      limit: 500,
      offset: 0,
    })
  })

  it('accepts a user id or "none" as the assignee filter', () => {
    expect(taskListQuerySchema.safeParse({ assigneeId: 'none' }).success).toBe(true)
    expect(taskListQuerySchema.safeParse({ assigneeId: ID }).success).toBe(true)
    expect(taskListQuerySchema.safeParse({ assigneeId: 'anyone' }).success).toBe(false)
  })

  it('rejects a search text PostgreSQL cannot process', () => {
    expect(taskListQuerySchema.safeParse({ q: 'a\u0000b' }).success).toBe(false)
  })

  it('caps the page size', () => {
    expect(taskListQuerySchema.safeParse({ limit: '501' }).success).toBe(false)
  })
})

describe('status and comment requests', () => {
  it('defaults a new status to the todo category', () => {
    expect(createStatusRequestSchema.parse({ name: 'Review' })).toEqual({
      name: 'Review',
      category: 'todo',
    })
  })

  it('requires at least one status id to reorder', () => {
    expect(reorderStatusesRequestSchema.safeParse({ statusIds: [] }).success).toBe(false)
  })

  it('rejects a blank comment', () => {
    expect(commentRequestSchema.safeParse({ body: '  \n ' }).success).toBe(false)
  })
})
