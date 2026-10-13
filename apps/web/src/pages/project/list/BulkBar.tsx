import {
  taskPrioritySchema,
  type BulkTasksRequest,
  type ProjectMember,
  type Status,
} from '@chilladesk/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { errorMessage } from '../../../api/client'
import { bulkTasks } from '../../../api/taskExtras'
import { Alert, Button, selectClass } from '../../../components/ui'
import { useT } from '../../../i18n'
import { taskKeys } from '../taskQueries'

type BulkAction = BulkTasksRequest['action']

interface BulkBarProps {
  projectId: string
  taskIds: string[]
  statuses: Status[] | undefined
  members: ProjectMember[] | undefined
  /** Called after an action went through, and for "clear". */
  onDone: () => void
}

/** What can be done to the ticked tasks all at once. */
export function BulkBar({ projectId, taskIds, statuses, members, onDone }: BulkBarProps) {
  const t = useT()
  const text = t.tasks.list.bulk
  const queryClient = useQueryClient()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const run = useMutation({
    mutationFn: (action: BulkAction) => bulkTasks(projectId, { taskIds, action }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: taskKeys.all(projectId) })
      onDone()
    },
  })
  const update = (patch: Extract<BulkAction, { type: 'update' }>['patch']) =>
    run.mutate({ type: 'update', patch })

  return (
    <div
      role="group"
      aria-label={text.label}
      className="space-y-2 rounded-md border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-900 dark:bg-indigo-950"
    >
      {run.isError && <Alert>{errorMessage(run.error)}</Alert>}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span role="status" className="font-medium">
          {text.selected(taskIds.length)}
        </span>
        {/* Each of these acts as soon as something is picked, then shows its prompt again. */}
        <select
          aria-label={text.moveTo}
          className={selectClass}
          value=""
          disabled={run.isPending}
          onChange={(event) => update({ statusId: event.target.value })}
        >
          <option value="">{text.moveTo}</option>
          {statuses?.map((status) => (
            <option key={status.id} value={status.id}>
              {status.name}
            </option>
          ))}
        </select>
        <select
          aria-label={text.assignTo}
          className={selectClass}
          value=""
          disabled={run.isPending}
          onChange={(event) =>
            update({ assigneeId: event.target.value === 'none' ? null : event.target.value })
          }
        >
          <option value="">{text.assignTo}</option>
          <option value="none">{t.tasks.list.unassigned}</option>
          {members?.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.name}
            </option>
          ))}
        </select>
        <select
          aria-label={text.setPriority}
          className={selectClass}
          value=""
          disabled={run.isPending}
          onChange={(event) => {
            const priority = taskPrioritySchema.safeParse(event.target.value)
            if (priority.success) update({ priority: priority.data })
          }}
        >
          <option value="">{text.setPriority}</option>
          {taskPrioritySchema.options.map((option) => (
            <option key={option} value={option}>
              {t.common.priority[option]}
            </option>
          ))}
        </select>
        <Button variant="secondary" onClick={() => setConfirmingDelete(true)}>
          {text.delete}
        </Button>
        <button type="button" onClick={onDone} className="ml-auto text-xs hover:underline">
          {text.clear}
        </button>
      </div>
      {confirmingDelete && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{text.deleteConfirm(taskIds.length)}</span>
          <Button
            variant="danger"
            disabled={run.isPending}
            onClick={() => run.mutate({ type: 'delete' })}
          >
            {t.tasks.dialog.deleteYes}
          </Button>
          <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
            {t.common.cancel}
          </Button>
        </div>
      )}
    </div>
  )
}
