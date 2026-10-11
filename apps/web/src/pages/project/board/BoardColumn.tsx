import type { Status, Task } from '@chillawiki/shared'
import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '../../../api/client'
import { Alert, Button } from '../../../components/ui'
import { useCreateTask } from '../taskQueries'
import { columnDropId } from './moves'
import { TaskCard } from './TaskCard'

function QuickAdd({ projectId, status }: { projectId: string; status: Status }) {
  const createTask = useCreateTask(projectId)
  const [open, setOpen] = useState(false)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const title = String(new FormData(form).get('title') ?? '').trim()
    if (!title) return
    // The form stays open so several tasks can be typed in a row.
    createTask.mutate({ title, statusId: status.id }, { onSuccess: () => form.reset() })
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Add a task to ${status.name}`}
        className="mt-2 w-full rounded-md px-2 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-700 dark:hover:text-slate-100"
      >
        + Add task
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 space-y-2">
      {createTask.isError && <Alert>{errorMessage(createTask.error)}</Alert>}
      <input
        name="title"
        autoFocus
        maxLength={200}
        aria-label={`Title of the new task in ${status.name}`}
        placeholder="What needs to be done?"
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false)
        }}
        className="block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900"
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={createTask.isPending}>
          Add
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </form>
  )
}

interface BoardColumnProps {
  projectId: string
  status: Status
  tasks: Task[]
  canEdit: boolean
}

export function BoardColumn({ projectId, status, tasks, canEdit }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: columnDropId(status.id) })
  const headingId = `column-${status.id}`

  return (
    <section
      aria-labelledby={headingId}
      className={`flex w-72 shrink-0 flex-col rounded-lg bg-slate-100 p-2 dark:bg-slate-800/60 ${
        isOver ? 'ring-2 ring-indigo-400' : ''
      }`}
    >
      <h2 className="flex items-center gap-2 px-1 pb-2 text-sm font-semibold">
        {/* Only the name labels the column; the count is extra information. */}
        <span id={headingId}>{status.name}</span>
        <span className="font-normal text-slate-500">
          {tasks.length}
          <span className="sr-only"> {tasks.length === 1 ? 'task' : 'tasks'}</span>
        </span>
      </h2>
      <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        {/* The list is the drop target, so it keeps some height even when the column is empty. */}
        <ul ref={setNodeRef} className="flex min-h-12 flex-1 flex-col gap-2">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} status={status} draggable={canEdit} />
          ))}
        </ul>
      </SortableContext>
      {canEdit && <QuickAdd projectId={projectId} status={status} />}
    </section>
  )
}
