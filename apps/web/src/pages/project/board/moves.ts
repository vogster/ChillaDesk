import type { MoveTaskRequest, Status, Task } from '@chillawiki/shared'

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
 * Translates a drag-and-drop gesture into a move request.
 * `overId` is either a task id or a column drop id. Returns null when nothing would change.
 */
export function planMove(tasks: Task[], activeId: string, overId: string): MoveTaskRequest | null {
  const active = tasks.find((task) => task.id === activeId)
  if (!active || activeId === overId) return null

  if (overId.startsWith(COLUMN_PREFIX)) {
    const statusId = overId.slice(COLUMN_PREFIX.length)
    const last = column(tasks, statusId).at(-1)
    return last?.id === activeId ? null : { statusId, beforeTaskId: null }
  }

  const over = tasks.find((task) => task.id === overId)
  if (!over) return null

  const target = column(tasks, over.statusId)
  const movingDown = active.statusId === over.statusId && byPosition(active, over) < 0
  if (!movingDown) return { statusId: over.statusId, beforeTaskId: over.id }

  // Dragging down past a card means landing after it, i.e. before the card that follows.
  const following = target[target.indexOf(over) + 1]
  return { statusId: over.statusId, beforeTaskId: following?.id ?? null }
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
export function describeDragItem(statuses: Status[], tasks: Task[], id: string): string {
  if (id.startsWith(COLUMN_PREFIX)) {
    const status = statuses.find((item) => item.id === id.slice(COLUMN_PREFIX.length))
    return status ? `the ${status.name} column` : 'a column'
  }
  const task = tasks.find((item) => item.id === id)
  return task ? `${task.key} ${task.title}` : 'a task'
}
