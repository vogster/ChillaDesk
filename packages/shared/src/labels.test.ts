import { describe, expect, it } from 'vitest'
import { createLabelRequestSchema, labelIdsSchema, updateLabelRequestSchema } from './labels'
import { createTaskRequestSchema, taskListQuerySchema, updateTaskRequestSchema } from './tasks'

const ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'

describe('label requests', () => {
  it('defaults a new label to gray and trims its name', () => {
    expect(createLabelRequestSchema.parse({ name: ' bug ' })).toEqual({
      name: 'bug',
      color: 'gray',
    })
  })

  it.each([
    ['a blank name', { name: '  ' }],
    ['an overlong name', { name: 'x'.repeat(41) }],
    ['a colour outside the palette', { name: 'bug', color: '#ff0000' }],
  ])('rejects %s', (_label, input) => {
    expect(createLabelRequestSchema.safeParse(input).success).toBe(false)
  })

  it('requires at least one field to update', () => {
    expect(updateLabelRequestSchema.safeParse({}).success).toBe(false)
    expect(updateLabelRequestSchema.parse({ color: 'red' })).toEqual({ color: 'red' })
  })
})

describe('labels on tasks', () => {
  it('rejects repeated ids and more labels than a task may have', () => {
    expect(labelIdsSchema.safeParse([ID, ID]).success).toBe(false)
    expect(labelIdsSchema.safeParse(Array.from({ length: 21 }, () => ID)).success).toBe(false)
    expect(labelIdsSchema.parse([ID, OTHER_ID])).toEqual([ID, OTHER_ID])
  })

  it('creates a task without labels unless some are given', () => {
    expect(createTaskRequestSchema.parse({ title: 'T' }).labelIds).toEqual([])
    expect(createTaskRequestSchema.parse({ title: 'T', labelIds: [ID] }).labelIds).toEqual([ID])
  })

  it('lets an update replace the labels, including with none', () => {
    expect(updateTaskRequestSchema.parse({ labelIds: [] })).toEqual({ labelIds: [] })
    expect(updateTaskRequestSchema.safeParse({ labelIds: ['nope'] }).success).toBe(false)
  })

  it('filters a task list by one label', () => {
    expect(taskListQuerySchema.parse({ labelId: ID }).labelId).toBe(ID)
    expect(taskListQuerySchema.safeParse({ labelId: 'bug' }).success).toBe(false)
  })
})
