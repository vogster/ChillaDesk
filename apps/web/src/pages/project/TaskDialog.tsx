import {
  dueDateSchema,
  taskPrioritySchema,
  updateTaskRequestSchema,
  type Task,
  type TaskPriority,
} from '@chillawiki/shared'
import { useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, errorMessage } from '../../api/client'
import { parseForm, type FieldErrors } from '../../components/form'
import { Modal } from '../../components/Modal'
import { Alert, Button, selectClass, Spinner } from '../../components/ui'
import { TaskLabels } from './labels/TaskLabels'
import type { ProjectContext } from './ProjectLayout'
import { ProjectMarkdown } from './ProjectMarkdown'
import { useMembers } from './projectQueries'
import { TaskComments } from './TaskComments'
import { formatDueDate, PRIORITY_LABELS } from './taskDisplay'
import { useDeleteTask, useMoveTask, useStatuses, useTask, useUpdateTask } from './taskQueries'

const fieldClass =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900'

interface TaskDialogProps {
  context: ProjectContext
  taskId: string
  onClose: () => void
}

export function TaskDialog({ context, taskId, onClose }: TaskDialogProps) {
  const task = useTask(context.project.id, taskId)
  // A malformed id fails validation; either way there is no such task to show.
  const missing =
    task.error instanceof ApiError &&
    (task.error.code === 'NOT_FOUND' || task.error.code === 'VALIDATION_ERROR')

  return (
    <Modal label={task.data ? `${task.data.key}: ${task.data.title}` : 'Task'} onClose={onClose}>
      {task.isPending && <Spinner />}
      {task.isError && (
        <div className="space-y-3">
          <Alert>{missing ? 'This task does not exist any more.' : errorMessage(task.error)}</Alert>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
      {task.isSuccess && <TaskDetails context={context} task={task.data} onClose={onClose} />}
    </Modal>
  )
}

interface TaskDetailsProps {
  context: ProjectContext
  task: Task
  onClose: () => void
}

function TaskDetails({ context, task, onClose }: TaskDetailsProps) {
  const { project, canEdit } = context
  const statuses = useStatuses(project.id)
  const members = useMembers(project.id)
  const updateTask = useUpdateTask(project.id, task.id)
  const moveTask = useMoveTask(project.id)
  const deleteTask = useDeleteTask(project.id, task.id)
  const [editing, setEditing] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const actionError = updateTask.error ?? moveTask.error ?? deleteTask.error

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = parseForm(updateTaskRequestSchema, {
      title: String(form.get('title') ?? ''),
      description: String(form.get('description') ?? ''),
    })
    if (!parsed.ok) {
      setFieldErrors(parsed.errors)
      return
    }
    setFieldErrors({})
    updateTask.mutate(parsed.data, { onSuccess: () => setEditing(false) })
  }

  const handleDelete = () => deleteTask.mutate(undefined, { onSuccess: onClose })

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-xs text-slate-500">{task.key}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="-mt-1 rounded px-2 text-xl leading-none text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          ×
        </button>
      </div>

      {actionError && <Alert>{errorMessage(actionError)}</Alert>}

      {editing ? (
        <form onSubmit={handleSave} noValidate className="space-y-3">
          <div>
            <label htmlFor="task-title" className="mb-1 block text-sm font-medium">
              Title
            </label>
            <input
              id="task-title"
              name="title"
              defaultValue={task.title}
              maxLength={200}
              required
              autoFocus
              aria-invalid={fieldErrors.title ? true : undefined}
              aria-describedby={fieldErrors.title ? 'task-title-error' : undefined}
              className={fieldClass}
            />
            {fieldErrors.title && (
              <p id="task-title-error" className="mt-1 text-xs text-red-600 dark:text-red-400">
                {fieldErrors.title}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="task-description" className="mb-1 block text-sm font-medium">
              Description
            </label>
            <textarea
              id="task-description"
              name="description"
              defaultValue={task.description}
              rows={8}
              placeholder="Markdown is supported."
              aria-invalid={fieldErrors.description ? true : undefined}
              aria-describedby={fieldErrors.description ? 'task-description-error' : undefined}
              className={`${fieldClass} font-mono`}
            />
            {fieldErrors.description && (
              <p
                id="task-description-error"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {fieldErrors.description}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={updateTask.isPending}>
              Save
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-semibold">{task.title}</h2>
            {canEdit && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
          </div>
          {task.description ? (
            <ProjectMarkdown project={project}>{task.description}</ProjectMarkdown>
          ) : (
            <p className="text-sm text-slate-500">No description.</p>
          )}
        </div>
      )}

      <TaskLabels
        projectId={project.id}
        task={task}
        canEdit={canEdit}
        onChange={(labelIds) => updateTask.mutate({ labelIds })}
      />

      <dl className="grid gap-3 border-y border-slate-200 py-4 text-sm sm:grid-cols-2 dark:border-slate-800">
        <Field label="Status" htmlFor={canEdit ? 'task-status' : undefined}>
          {canEdit ? (
            <select
              id="task-status"
              className={selectClass}
              value={task.statusId}
              disabled={moveTask.isPending}
              onChange={(event) =>
                moveTask.move(task.id, { statusId: event.target.value, beforeTaskId: null })
              }
            >
              {statuses.data?.map((status) => (
                <option key={status.id} value={status.id}>
                  {status.name}
                </option>
              ))}
            </select>
          ) : (
            statuses.data?.find((status) => status.id === task.statusId)?.name
          )}
        </Field>
        <Field label="Priority" htmlFor={canEdit ? 'task-priority' : undefined}>
          {canEdit ? (
            <select
              id="task-priority"
              className={selectClass}
              value={task.priority}
              onChange={(event) =>
                updateTask.mutate({ priority: event.target.value as TaskPriority })
              }
            >
              {taskPrioritySchema.options.map((option) => (
                <option key={option} value={option}>
                  {PRIORITY_LABELS[option]}
                </option>
              ))}
            </select>
          ) : (
            PRIORITY_LABELS[task.priority]
          )}
        </Field>
        <Field label="Assignee" htmlFor={canEdit ? 'task-assignee' : undefined}>
          {canEdit ? (
            <select
              id="task-assignee"
              className={selectClass}
              value={task.assignee?.id ?? ''}
              onChange={(event) => updateTask.mutate({ assigneeId: event.target.value || null })}
            >
              <option value="">Unassigned</option>
              {members.data?.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </select>
          ) : (
            (task.assignee?.name ?? 'Unassigned')
          )}
        </Field>
        <Field label="Due date" htmlFor={canEdit ? 'task-due' : undefined}>
          {canEdit ? (
            <DueDateInput
              // Start again from the saved value whenever it changes.
              key={task.dueDate}
              value={task.dueDate}
              onCommit={(dueDate) => updateTask.mutate({ dueDate })}
            />
          ) : task.dueDate ? (
            formatDueDate(task.dueDate)
          ) : (
            'None'
          )}
        </Field>
        <div className="text-xs text-slate-500 sm:col-span-2">
          Created by {task.reporter?.name ?? 'a deleted user'} on{' '}
          {new Date(task.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
        </div>
      </dl>

      <TaskComments context={context} taskId={task.id} />

      {canEdit && (
        <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
          {confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm">Delete this task and its comments? This cannot be undone.</p>
              <Button variant="danger" onClick={handleDelete} disabled={deleteTask.isPending}>
                Yes, delete
              </Button>
              <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmingDelete(true)}>
              Delete task…
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

interface DueDateInputProps {
  value: string | null
  onCommit: (dueDate: string | null) => void
}

/**
 * Typing a date passes through valid-looking values such as year 0002, so nothing is saved
 * until the field loses focus or Enter is pressed.
 */
function DueDateInput({ value, onCommit }: DueDateInputProps) {
  const [draft, setDraft] = useState(value ?? '')
  const [invalid, setInvalid] = useState(false)

  const commit = () => {
    const next = draft || null
    if (next === value) return
    const valid = next === null || dueDateSchema.safeParse(next).success
    setInvalid(!valid)
    if (valid) onCommit(next)
  }

  return (
    <>
      <input
        id="task-due"
        type="date"
        min="1900-01-01"
        max="2999-12-31"
        className={selectClass}
        value={draft}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={invalid ? 'task-due-error' : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
        }}
      />
      {invalid && (
        <p id="task-due-error" className="mt-1 text-xs text-red-600 dark:text-red-400">
          Enter a year between 1900 and 2999.
        </p>
      )}
    </>
  )
}

interface FieldProps {
  label: string
  /** Id of the control, when the value is editable. */
  htmlFor: string | undefined
  children: ReactNode
}

function Field({ label, htmlFor, children }: FieldProps) {
  return (
    <div>
      <dt className="mb-1 text-xs font-medium text-slate-500">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
      </dt>
      <dd>{children}</dd>
    </div>
  )
}
