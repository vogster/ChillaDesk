import { describe, expect, it } from 'vitest'
import { doing, done, makeTask } from '../../test/render'
import { formatDueDate, isOverdue, todayIso } from './taskDisplay'

describe('todayIso', () => {
  it('formats the local calendar day with leading zeros', () => {
    expect(todayIso(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(todayIso(new Date(2026, 10, 30, 0, 1))).toBe('2026-11-30')
  })
})

describe('isOverdue', () => {
  const today = '2026-06-15'

  it('is true only for a past date in a column that is not done', () => {
    expect(isOverdue(makeTask(1, { dueDate: '2026-06-14' }), doing, today)).toBe(true)
    expect(isOverdue(makeTask(1, { dueDate: '2026-06-14' }), undefined, today)).toBe(true)
  })

  it('is false for today, the future, no date, or finished work', () => {
    expect(isOverdue(makeTask(1, { dueDate: today }), doing, today)).toBe(false)
    expect(isOverdue(makeTask(1, { dueDate: '2026-06-16' }), doing, today)).toBe(false)
    expect(isOverdue(makeTask(1), doing, today)).toBe(false)
    expect(isOverdue(makeTask(1, { dueDate: '2020-01-01' }), done, today)).toBe(false)
  })
})

describe('formatDueDate', () => {
  it('shows the same calendar day in any time zone', () => {
    const formatted = formatDueDate('2026-12-31')

    expect(formatted).toContain('31')
    expect(formatted).toContain('2026')
  })
})
