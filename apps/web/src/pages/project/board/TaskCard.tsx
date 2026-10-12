import type { Status, Task } from '@chillawiki/shared'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { LabelList } from '../labels/LabelChip'
import { TASK_PARAM } from '../ProjectLayout'
import { Avatar, DueDate, PriorityBadge } from '../taskDisplay'

/** Link target that opens a task in the dialog while keeping the current page and filters. */
export function useTaskLink(taskId: string): string {
  const [searchParams] = useSearchParams()
  const next = new URLSearchParams(searchParams)
  next.set(TASK_PARAM, taskId)
  return `?${next.toString()}`
}

interface TaskCardBodyProps {
  task: Task
  status: Status | undefined
  /** Rendered at the right of the title row, e.g. the drag handle. */
  action?: ReactNode
}

export function TaskCardBody({ task, status, action }: TaskCardBodyProps) {
  const link = useTaskLink(task.id)
  return (
    <>
      <div className="flex items-start gap-2">
        <Link to={link} className="min-w-0 flex-1 text-sm font-medium hover:underline">
          {task.title}
        </Link>
        {action}
      </div>
      {task.labels.length > 0 && (
        <div className="mt-2">
          <LabelList labels={task.labels} />
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-500">{task.key}</span>
        <PriorityBadge priority={task.priority} />
        <DueDate task={task} status={status} />
        {task.assignee && (
          <span className="ml-auto">
            <Avatar user={task.assignee} />
          </span>
        )}
      </div>
    </>
  )
}

const CARD_CLASS =
  'rounded-md border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900'

function DragHandleIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-4 fill-current">
      <circle cx="5" cy="3" r="1.5" />
      <circle cx="11" cy="3" r="1.5" />
      <circle cx="5" cy="8" r="1.5" />
      <circle cx="11" cy="8" r="1.5" />
      <circle cx="5" cy="13" r="1.5" />
      <circle cx="11" cy="13" r="1.5" />
    </svg>
  )
}

interface TaskCardProps {
  task: Task
  status: Status
  draggable: boolean
}

/**
 * A card can be dragged with the mouse or a long touch from anywhere on it. The handle button
 * is what assistive technology and the keyboard use: it carries the drag semantics, so the
 * card itself stays a plain list item with an ordinary link inside.
 */
export function TaskCard({ task, status, draggable }: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !draggable })

  if (!draggable) {
    return (
      <li className={CARD_CLASS}>
        <TaskCardBody task={task} status={status} />
      </li>
    )
  }

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`${CARD_CLASS} cursor-grab touch-manipulation active:cursor-grabbing ${
        isDragging ? 'opacity-40' : ''
      }`}
      {...listeners}
    >
      <TaskCardBody
        task={task}
        status={status}
        action={
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            aria-label={`Move ${task.title}`}
            className="-mt-0.5 -mr-1 shrink-0 cursor-grab rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:hover:bg-slate-800"
          >
            <DragHandleIcon />
          </button>
        }
      />
    </li>
  )
}

/** The copy of a card that follows the pointer while dragging. */
export function TaskCardPreview({ task, status }: { task: Task; status: Status | undefined }) {
  return (
    <div className={`${CARD_CLASS} rotate-1 shadow-lg`}>
      <TaskCardBody task={task} status={status} />
    </div>
  )
}
