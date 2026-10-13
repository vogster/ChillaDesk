import type { MoveTaskRequest, Status, Task } from '@chilladesk/shared'
import type { DragItem } from '../../../i18n/en/tasks'
import { currentMessages } from '../../../i18n/messages'

const COLUMN_PREFIX = 'column:'

/** Drop-target id of a whole column, as opposed to a task card inside it. */
export const columnDropId = (statusId: string) => `${COLUMN_PREFIX}${statusId}`

const byPosition = (left: Task, right: Task) =>
  left.position - right.position || left.number - right.number

/** Tasks of each status in board order; statuses without tasks get an empty list. */
export function groupByStatus(statuses: Status[], tasks: Task[]): Map<string, Task[]> {
  const grouped = new Map<string, Task[]>(statuses.map((status) => [status.id, []]))
  for (const task of [...tasks].sort(byPosition)) {
    grouped.get(task.statusId)?.push(task)
  }
  return grouped
}

function column(tasks: Task[], statusId: string): Task[] {
  return tasks.filter((task) => task.statusId === statusId).sort(byPosition)
}

/**
 * The ids of the cards in each column, in the order shown. While a card is dragged the board
 * keeps its own copy of this, so the card can sit in the column under the pointer before
 * anything is saved.
 */
export type BoardOrder = Readonly<Record<string, readonly string[]>>

export function toOrder(columns: Map<string, Task[]>): BoardOrder {
  return Object.fromEntries(
    [...columns].map(([statusId, items]) => [statusId, items.map((item) => item.id)]),
  )
}

/** The column a drag id belongs to: a card's column, or the column a drop target stands for. */
export function columnOf(order: BoardOrder, id: string): string | undefined {
  if (id.startsWith(COLUMN_PREFIX)) {
    const statusId = id.slice(COLUMN_PREFIX.length)
    return statusId in order ? statusId : undefined
  }
  return Object.keys(order).find((statusId) => order[statusId]?.includes(id))
}

/**
 * Moves the dragged card into the column it is hovering, if that is not its own: next to the
 * hovered card (after it when `placeAfter`), or at the end when the column itself is hovered.
 * Returns the same object when nothing changes.
 */
export function moveToColumn(
  order: BoardOrder,
  activeId: string,
  overId: string,
  placeAfter: boolean,
): BoardOrder {
  const from = columnOf(order, activeId)
  const to = columnOf(order, overId)
  if (!from || !to || from === to) return order

  const target = order[to] ?? []
  const overIndex = target.indexOf(overId)
  const index = overIndex < 0 ? target.length : overIndex + (placeAfter ? 1 : 0)
  return {
    ...order,
    [from]: (order[from] ?? []).filter((id) => id !== activeId),
    [to]: [...target.slice(0, index), activeId, ...target.slice(index)],
  }
}

/** Within one column, moves the dragged card to the place of the card it was dropped on. */
export function reorderInColumn(order: BoardOrder, activeId: string, overId: string): BoardOrder {
  const statusId = columnOf(order, activeId)
  if (!statusId || activeId === overId || columnOf(order, overId) !== statusId) return order

  const ids = order[statusId] ?? []
  const to = ids.indexOf(overId)
  if (to < 0) return order
  const without = ids.filter((id) => id !== activeId)
  return { ...order, [statusId]: [...without.slice(0, to), activeId, ...without.slice(to)] }
}

/** Where a card sits in the order, as the request that would put it there. */
export function targetOf(order: BoardOrder, taskId: string): MoveTaskRequest | null {
  const statusId = columnOf(order, taskId)
  if (!statusId) return null
  const ids = order[statusId] ?? []
  return { statusId, beforeTaskId: ids[ids.indexOf(taskId) + 1] ?? null }
}

/** Whether the task is already where the request would put it, so there is nothing to save. */
export function isSamePlace(tasks: Task[], taskId: string, target: MoveTaskRequest): boolean {
  const task = tasks.find((item) => item.id === taskId)
  if (!task || task.statusId !== target.statusId) return false
  const siblings = column(tasks, task.statusId)
  const following = siblings[siblings.indexOf(task) + 1]
  return (following?.id ?? null) === target.beforeTaskId
}

/**
 * The task list as it will look once the server applies the move, for an instant UI update.
 * Positions are approximations; the server's values replace them on the next fetch.
 */
export function applyMove(tasks: Task[], taskId: string, target: MoveTaskRequest): Task[] {
  const moving = tasks.find((task) => task.id === taskId)
  if (!moving) return tasks

  const others = column(tasks, target.statusId).filter((task) => task.id !== taskId)
  const nextIndex = target.beforeTaskId
    ? others.findIndex((task) => task.id === target.beforeTaskId)
    : -1
  const next = nextIndex >= 0 ? others[nextIndex] : undefined
  const previous = next ? others[nextIndex - 1] : others.at(-1)

  const position = next
    ? previous
      ? (previous.position + next.position) / 2
      : next.position - 1
    : (previous?.position ?? 0) + 1

  return tasks.map((task) =>
    task.id === taskId ? { ...task, statusId: target.statusId, position } : task,
  )
}

/** Names a drag source or drop target for screen-reader announcements. */
export function dragItemOf(statuses: Status[], tasks: Task[], id: string): DragItem {
  if (id.startsWith(COLUMN_PREFIX)) {
    const status = statuses.find((item) => item.id === id.slice(COLUMN_PREFIX.length))
    return { kind: 'column', name: status?.name ?? null }
  }
  const task = tasks.find((item) => item.id === id)
  return { kind: 'task', name: task ? `${task.key} ${task.title}` : null }
}

/** The same in words, in the current language. */
export function describeDragItem(statuses: Status[], tasks: Task[], id: string): string {
  return currentMessages().tasks.board.drag.describe(dragItemOf(statuses, tasks, id))
}
