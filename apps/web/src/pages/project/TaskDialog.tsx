import {
  dueDateSchema,
  taskPrioritySchema,
  updateTaskRequestSchema,
  type Task,
  type TaskPriority,
} from '@chilladesk/shared'
import { useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, errorMessage } from '../../api/client'
import { Attachments } from '../../components/Attachments'
import { parseForm, type FieldErrors } from '../../components/form'
import { Modal } from '../../components/Modal'
import { Alert, Button, selectClass, Spinner } from '../../components/ui'
import { intlLocale, useT } from '../../i18n'
import { TaskLabels } from './labels/TaskLabels'
import { MentionTextarea } from './mentions/MentionTextarea'
import type { ProjectContext } from './ProjectLayout'
import { ProjectMarkdown } from './ProjectMarkdown'
import { useMilestones } from './milestones/milestoneQueries'
import { useMembers } from './projectQueries'
import { TaskChecklist } from './TaskChecklist'
import { TaskComments } from './TaskComments'
import { TaskHistory } from './TaskHistory'
import { TaskLinks } from './TaskLinks'
import { TaskWatch } from './TaskWatch'
import { formatDueDate } from './taskDisplay'
import {
  taskKeys,
  useDeleteTask,
  useMoveTask,
  useStatuses,
  useTask,
  useUpdateTask,
} from './taskQueries'

const fieldClass =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900'

interface TaskDialogProps {
  context: ProjectContext
  taskId: string
  onClose: () => void
}

export function TaskDialog({ context, taskId, onClose }: TaskDialogProps) {
  const t = useT()
  const text = t.tasks.dialog
  const task = useTask(context.project.id, taskId)
  // A malformed id fails validation; either way there is no such task to show.
  const missing =
    task.error instanceof ApiError &&
    (task.error.code === 'NOT_FOUND' || task.error.code === 'VALIDATION_ERROR')

  return (
    <Modal
      label={task.data ? `${task.data.key}: ${task.data.title}` : text.label}
      onClose={onClose}
    >
      {task.isPending && <Spinner />}
      {task.isError && (
        <div className="space-y-3">
          <Alert>{missing ? text.missing : errorMessage(task.error)}</Alert>
          <Button variant="secondary" onClick={onClose}>
            {t.common.close}
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
  const t = useT()
  const text = t.tasks.dialog
  const { project, canEdit } = context
  const statuses = useStatuses(project.id)
  const members = useMembers(project.id)
  const milestones = useMilestones(project.id)
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
          aria-label={t.common.close}
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
              {text.title}
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
              {text.description}
            </label>
            <MentionTextarea
              projectId={project.id}
              id="task-description"
              name="description"
              defaultValue={task.description}
              rows={8}
              placeholder={text.descriptionPlaceholder}
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
              {t.common.save}
            </Button>
            <Button variant="secondary" onClick={() => setEditing(false)}>
              {t.common.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-xl font-semibold">{task.title}</h2>
            {canEdit && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                {t.common.edit}
              </Button>
            )}
          </div>
          {task.description ? (
            <ProjectMarkdown project={project}>{task.description}</ProjectMarkdown>
          ) : (
            <p className="text-sm text-slate-500">{text.noDescription}</p>
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
        <Field label={text.status} htmlFor={canEdit ? 'task-status' : undefined}>
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
        <Field label={text.priority} htmlFor={canEdit ? 'task-priority' : undefined}>
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
                  {t.common.priority[option]}
                </option>
              ))}
            </select>
          ) : (
            t.common.priority[task.priority]
          )}
        </Field>
        <Field label={text.assignee} htmlFor={canEdit ? 'task-assignee' : undefined}>
          {canEdit ? (
            <select
              id="task-assignee"
              className={selectClass}
              value={task.assignee?.id ?? ''}
              onChange={(event) => updateTask.mutate({ assigneeId: event.target.value || null })}
            >
              <option value="">{text.unassigned}</option>
              {members.data?.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.name}
                </option>
              ))}
            </select>
          ) : (
            (task.assignee?.name ?? text.unassigned)
          )}
        </Field>
        <Field label={text.dueDate} htmlFor={canEdit ? 'task-due' : undefined}>
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
            text.noDueDate
          )}
        </Field>
        <Field label={text.milestone} htmlFor={canEdit ? 'task-milestone' : undefined}>
          {canEdit ? (
            <select
              id="task-milestone"
              className={selectClass}
              value={task.milestone?.id ?? ''}
              onChange={(event) => updateTask.mutate({ milestoneId: event.target.value || null })}
            >
              <option value="">{text.noMilestone}</option>
              {milestones.data
                // A closed milestone is only offered while the task is still on it.
                ?.filter((milestone) => !milestone.closed || milestone.id === task.milestone?.id)
                .map((milestone) => (
                  <option key={milestone.id} value={milestone.id}>
                    {milestone.name}
                  </option>
                ))}
            </select>
          ) : (
            (task.milestone?.name ?? text.noMilestone)
          )}
        </Field>
        <div className="text-xs text-slate-500 sm:col-span-2">
          {text.created(
            task.reporter?.name ?? null,
            new Date(task.createdAt).toLocaleDateString(intlLocale(), { dateStyle: 'medium' }),
          )}
        </div>
      </dl>

      <TaskChecklist projectId={project.id} taskId={task.id} canEdit={canEdit} />
      <TaskLinks
        projectId={project.id}
        projectKey={project.key}
        taskId={task.id}
        canEdit={canEdit}
      />
      <Attachments
        path={`/projects/${project.id}/tasks/${task.id}/attachments`}
        queryKey={[...taskKeys.detail(project.id, task.id), 'attachments']}
        canEdit={canEdit}
      />
      <TaskWatch projectId={project.id} taskId={task.id} />
      <TaskComments context={context} taskId={task.id} />
      <TaskHistory projectId={project.id} taskId={task.id} />

      {canEdit && (
        <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
          {confirmingDelete ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm">{text.deleteConfirm}</p>
              <Button variant="danger" onClick={handleDelete} disabled={deleteTask.isPending}>
                {text.deleteYes}
              </Button>
              <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
                {t.common.cancel}
              </Button>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setConfirmingDelete(true)}>
              {text.deleteTask}
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
  const t = useT()
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
          {t.tasks.dialog.dueDateInvalid}
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
