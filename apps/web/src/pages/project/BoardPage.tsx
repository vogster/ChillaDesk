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
  type DragStartEvent,
} from '@dnd-kit/core'
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useEffect, useMemo, useState } from 'react'
import { errorMessage } from '../../api/client'
import { Alert, Spinner } from '../../components/ui'
import { BoardColumn } from './board/BoardColumn'
import { describeDragItem, groupByStatus, planMove } from './board/moves'
import { TaskCardPreview } from './board/TaskCard'
import { useProjectContext } from './ProjectLayout'
import { useMoveTask, useStatuses, useTasks } from './taskQueries'

export function BoardPage() {
  const { project, canEdit } = useProjectContext()
  const statuses = useStatuses(project.id)
  const tasks = useTasks(project.id)
  const moveTask = useMoveTask(project.id)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const sensors = useSensors(
    // A small threshold keeps a plain click on a card from starting a drag.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A press-and-hold starts a drag on touch screens, so a swipe still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const items = tasks.data?.items
  const columns = useMemo(
    () => groupByStatus(statuses.data ?? [], items ?? []),
    [statuses.data, items],
  )

  // A task in a column this page has not heard of means someone just added the column.
  const refetchStatuses = statuses.refetch
  const hasUnknownStatus =
    statuses.isSuccess &&
    !statuses.isFetching &&
    (items ?? []).some((task) => !columns.has(task.statusId))
  useEffect(() => {
    if (hasUnknownStatus) void refetchStatuses()
  }, [hasUnknownStatus, refetchStatuses])

  if (statuses.isPending || tasks.isPending) return <Spinner />
  if (statuses.isError) return <Alert>{errorMessage(statuses.error)}</Alert>
  if (tasks.isError) return <Alert>{errorMessage(tasks.error)}</Alert>

  const dragging = tasks.data.items.find((task) => task.id === draggingId)
  const statusOf = (statusId: string) => statuses.data.find((status) => status.id === statusId)

  // dnd-kit's default announcements read out raw ids; these use task and column names.
  const name = (id: string | number) =>
    describeDragItem(statuses.data, tasks.data.items, String(id))
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${name(active.id)}.`,
    onDragOver: ({ active, over }) => {
      // Hovering over its own slot is not news; staying quiet keeps the pick-up message audible.
      if (over?.id === active.id) return undefined
      return over
        ? `${name(active.id)} is over ${name(over.id)}.`
        : `${name(active.id)} is not over a column.`
    },
    onDragEnd: ({ active, over }) =>
      over
        ? `${name(active.id)} was dropped on ${name(over.id)}.`
        : `${name(active.id)} was put back.`,
    onDragCancel: ({ active }) => `Moving ${name(active.id)} was cancelled.`,
  }

  const handleDragStart = (event: DragStartEvent) => setDraggingId(String(event.active.id))
  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null)
    if (!event.over) return
    const target = planMove(tasks.data.items, String(event.active.id), String(event.over.id))
    if (target) moveTask.mutate({ taskId: String(event.active.id), target })
  }

  return (
    <div className="space-y-3">
      {moveTask.isError && <Alert>{errorMessage(moveTask.error)}</Alert>}
      {tasks.data.total > tasks.data.items.length && (
        <p className="text-sm text-slate-500">
          Showing the first {tasks.data.items.length} of {tasks.data.total} tasks. Use the list to
          find the rest.
        </p>
      )}
      <DndContext
        sensors={sensors}
        accessibility={{ announcements }}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDraggingId(null)}
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
          {dragging && <TaskCardPreview task={dragging} status={statusOf(dragging.statusId)} />}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
