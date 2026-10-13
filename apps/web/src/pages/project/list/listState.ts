import {
  sortOrderSchema,
  taskPrioritySchema,
  taskSortSchema,
  type SortOrder,
  type TaskPriority,
  type TaskSort,
} from '@chilladesk/shared'
import { z } from 'zod'
import type { TaskFilters } from '../../../api/tasks'

/** What the list shows and in which order. It lives in the address, so it can be shared. */
export interface ListState {
  q: string
  statusId: string
  /** A user id, `none` for unassigned tasks, or empty for anyone. */
  assigneeId: string
  priority: TaskPriority | ''
  labelId: string
  /** A milestone id, `none` for tasks without one, or empty for any. */
  milestoneId: string
  sort: TaskSort
  order: SortOrder
}

export const DEFAULT_LIST_STATE: ListState = {
  q: '',
  statusId: '',
  assigneeId: '',
  priority: '',
  labelId: '',
  milestoneId: '',
  sort: 'board',
  order: 'asc',
}

const LIST_KEYS = Object.keys(DEFAULT_LIST_STATE) as (keyof ListState)[]

const id = z.uuid()
const idOrNone = z.union([z.uuid(), z.literal('none')])

/** Reads the list state from the address; anything it does not understand counts as unset. */
export function parseListState(params: URLSearchParams): ListState {
  const valid = <T>(schema: z.ZodType<T>, key: keyof ListState): T | null => {
    const result = schema.safeParse(params.get(key))
    return result.success ? result.data : null
  }
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    statusId: valid(id, 'statusId') ?? '',
    assigneeId: valid(idOrNone, 'assigneeId') ?? '',
    priority: valid(taskPrioritySchema, 'priority') ?? '',
    labelId: valid(id, 'labelId') ?? '',
    milestoneId: valid(idOrNone, 'milestoneId') ?? '',
    sort: valid(taskSortSchema, 'sort') ?? DEFAULT_LIST_STATE.sort,
    order: valid(sortOrderSchema, 'order') ?? DEFAULT_LIST_STATE.order,
  }
}

/** The list state as a query string, without what is at its default. */
export function listQuery(state: ListState): string {
  const entries = LIST_KEYS.filter((key) => state[key] !== DEFAULT_LIST_STATE[key]).map(
    (key): [string, string] => [key, state[key]],
  )
  return new URLSearchParams(entries).toString()
}

/** Puts a list state into the address, leaving its other parameters (the open task) alone. */
export function withListState(params: URLSearchParams, state: ListState): URLSearchParams {
  const others = [...params].filter(([key]) => !LIST_KEYS.includes(key as keyof ListState))
  return new URLSearchParams([...others, ...new URLSearchParams(listQuery(state))])
}

/** Whether anything narrows the list down (the order does not). */
export const isFiltered = (state: ListState): boolean =>
  [
    state.q.trim(),
    state.statusId,
    state.assigneeId,
    state.priority,
    state.labelId,
    state.milestoneId,
  ].some(Boolean)

export function toTaskFilters(state: ListState): TaskFilters {
  const q = state.q.trim()
  return {
    ...(q ? { q } : {}),
    ...(state.statusId ? { statusId: state.statusId } : {}),
    ...(state.assigneeId ? { assigneeId: state.assigneeId } : {}),
    ...(state.priority ? { priority: state.priority } : {}),
    ...(state.labelId ? { labelId: state.labelId } : {}),
    ...(state.milestoneId ? { milestoneId: state.milestoneId } : {}),
    ...(state.sort !== 'board' || state.order !== 'asc'
      ? { sort: state.sort, order: state.order }
      : {}),
  }
}

/** The direction a column starts in: the most pressing or most recent first. */
const FIRST_ORDER: Partial<Record<TaskSort, SortOrder>> = {
  priority: 'desc',
  updated: 'desc',
  created: 'desc',
}

/** The state after a click on a column heading: sort by it, or turn the order around. */
export function sortedBy(state: ListState, sort: TaskSort): ListState {
  if (state.sort !== sort) return { ...state, sort, order: FIRST_ORDER[sort] ?? 'asc' }
  return { ...state, order: state.order === 'asc' ? 'desc' : 'asc' }
}
