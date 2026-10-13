import type { Task } from '@chilladesk/shared'
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useEffect, useMemo, useState } from 'react'
import { errorMessage } from '../../api/client'
import { Alert, Spinner } from '../../components/ui'
import { useT } from '../../i18n'
import { BoardColumn } from './board/BoardColumn'
import {
  columnOf,
  dragItemOf,
  groupByStatus,
  isSamePlace,
  moveToColumn,
  reorderInColumn,
  targetOf,
  toOrder,
  type BoardOrder,
} from './board/moves'
import { TaskCardPreview } from './board/TaskCard'
import { useProjectContext } from './ProjectLayout'
import { useMoveTask, useStatuses, useTasks } from './taskQueries'

/**
 * The card order shown instead of the loaded one: while a card is dragged, and after the
 * drop until the saved order arrives (`basedOn` is the task list it was made from).
 */
interface LocalOrder {
  order: BoardOrder
  basedOn: Task[]
}

/** Whether the dragged card has passed the middle of the card it is over. */
function isPastMiddle({ active, over }: DragOverEvent): boolean {
  const dragged = active.rect.current.translated
  return Boolean(over && dragged && dragged.top > over.rect.top + over.rect.height / 2)
}

export function BoardPage() {
  const t = useT()
  const { project, canEdit } = useProjectContext()
  const statuses = useStatuses(project.id)
  const tasks = useTasks(project.id)
  const moveTask = useMoveTask(project.id)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [local, setLocal] = useState<LocalOrder | null>(null)

  const sensors = useSensors(
    // A small threshold keeps a plain click on a card from starting a drag.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A press-and-hold starts a drag on touch screens, so a swipe still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const items = tasks.data?.items
  const loaded = useMemo(
    () => groupByStatus(statuses.data ?? [], items ?? []),
    [statuses.data, items],
  )

  // The local order wins during a drag, and afterwards for as long as the task list is still
  // the one it was made from. Once the list changes (the move was applied, or refused and
  // rolled back) the loaded order takes over again, with no frame in between.
  const localOrder = local && (draggingId !== null || local.basedOn === items) ? local.order : null
  const columns = useMemo(() => {
    if (!localOrder) return loaded
    const byId = new Map((items ?? []).map((task) => [task.id, task]))
    return new Map(
      Object.entries(localOrder).map(([statusId, ids]) => [
        statusId,
        ids.flatMap((id) => byId.get(id) ?? []),
      ]),
    )
  }, [localOrder, loaded, items])

  // A task in a column this page has not heard of means someone just added the column.
  const refetchStatuses = statuses.refetch
  const hasUnknownStatus =
    statuses.isSuccess &&
    !statuses.isFetching &&
    (items ?? []).some((task) => !loaded.has(task.statusId))
  useEffect(() => {
    if (hasUnknownStatus) void refetchStatuses()
  }, [hasUnknownStatus, refetchStatuses])

  if (statuses.isPending || tasks.isPending) return <Spinner />
  if (statuses.isError) return <Alert>{errorMessage(statuses.error)}</Alert>
  if (tasks.isError) return <Alert>{errorMessage(tasks.error)}</Alert>

  const taskList = tasks.data.items
  const dragging = taskList.find((task) => task.id === draggingId)
  const statusOf = (statusId: string | undefined) =>
    statuses.data.find((status) => status.id === statusId)

  // dnd-kit's default announcements read out raw ids; these use task and column names.
  const item = (id: string | number) => dragItemOf(statuses.data, taskList, String(id))
  const { drag } = t.tasks.board
  const announcements: Announcements = {
    onDragStart: ({ active }) => drag.pickedUp(item(active.id)),
    onDragOver: ({ active, over }) => {
      // Hovering over its own slot is not news; staying quiet keeps the pick-up message audible.
      if (over?.id === active.id) return undefined
      return over ? drag.over(item(active.id), item(over.id)) : drag.notOver(item(active.id))
    },
    onDragEnd: ({ active, over }) =>
      over ? drag.dropped(item(active.id), item(over.id)) : drag.putBack(item(active.id)),
    onDragCancel: ({ active }) => drag.cancelled(item(active.id)),
  }

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingId(String(event.active.id))
    setLocal({ order: toOrder(loaded), basedOn: taskList })
  }

  // As soon as the card is over another column it moves there, so that column makes room
  // for it and the drop lands where the card already is.
  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event
    if (!over) return
    setLocal((current) => {
      if (!current) return current
      const order = moveToColumn(
        current.order,
        String(active.id),
        String(over.id),
        isPastMiddle(event),
      )
      return order === current.order ? current : { ...current, order }
    })
  }

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const taskId = String(active.id)
    setDraggingId(null)
    if (!local || !over) {
      setLocal(null)
      return
    }

    const order = reorderInColumn(local.order, taskId, String(over.id))
    const target = targetOf(order, taskId)
    if (!target || isSamePlace(taskList, taskId, target)) {
      setLocal(null)
      return
    }
    // Kept until the task list changes, so the card never shows in its old place.
    setLocal({ order, basedOn: taskList })
    moveTask.move(taskId, target)
  }

  const handleDragCancel = () => {
    setDraggingId(null)
    setLocal(null)
  }

  return (
    <div className="space-y-3">
      {moveTask.isError && <Alert>{errorMessage(moveTask.error)}</Alert>}
      {tasks.data.total > taskList.length && (
        <p className="text-sm text-slate-500">
          {t.tasks.board.truncated(taskList.length, tasks.data.total)}
        </p>
      )}
      <DndContext
        sensors={sensors}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: drag.instructions },
        }}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div className="flex items-start gap-4 overflow-x-auto pb-4">
          {statuses.data.map((status) => (
            <BoardColumn
              key={status.id}
              projectId={project.id}
              status={status}
              tasks={columns.get(status.id) ?? []}
              canEdit={canEdit}
            />
          ))}
        </div>
        <DragOverlay>
          {dragging && (
            <TaskCardPreview
              task={dragging}
              // The column the card is over, so "overdue" matches where it would land.
              status={statusOf(localOrder ? columnOf(localOrder, dragging.id) : dragging.statusId)}
            />
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
