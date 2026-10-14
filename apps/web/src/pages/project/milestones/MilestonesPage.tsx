import { createMilestoneRequestSchema, type Milestone } from '@chilladesk/shared'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { errorMessage } from '../../../api/client'
import { parseForm, type FieldErrors } from '../../../components/form'
import { Alert, Button, Card, Spinner, TextField } from '../../../components/ui'
import { useT } from '../../../i18n'
import { useProjectContext } from '../ProjectLayout'
import { formatDueDate, todayIso } from '../taskDisplay'
import { useMilestoneMutations, useMilestones } from './milestoneQueries'

const actionClass = 'text-xs text-slate-500 hover:underline'

function Progress({ milestone }: { milestone: Milestone }) {
  const texts = useT().project.milestones
  const { done, total } = milestone.progress
  const percent = total === 0 ? 0 : Math.round((done / total) * 100)
  return (
    <div className="space-y-1">
      <div
        role="progressbar"
        aria-label={texts.progressOf(milestone.name)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
      >
        <div className="h-full bg-emerald-500" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-slate-500">
        {total === 0 ? texts.noTasks : texts.progress(done, total, percent)}
      </p>
    </div>
  )
}

interface MilestoneItemProps {
  projectId: string
  milestone: Milestone
  canEdit: boolean
  mutations: ReturnType<typeof useMilestoneMutations>
}

function MilestoneItem({ projectId, milestone, canEdit, mutations }: MilestoneItemProps) {
  const t = useT()
  const texts = t.project.milestones
  const [confirming, setConfirming] = useState(false)
  const { update, remove } = mutations
  const overdue = !milestone.closed && milestone.dueDate !== null && milestone.dueDate < todayIso()

  return (
    <li className="space-y-2 rounded-md border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-semibold">
          <Link
            to={`/projects/${projectId}/list?${new URLSearchParams({ milestoneId: milestone.id })}`}
            className="hover:underline"
          >
            {milestone.name}
          </Link>
        </h3>
        {milestone.closed && (
          <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs dark:bg-slate-700">
            {texts.closed}
          </span>
        )}
        <span
          className={`text-sm ${overdue ? 'text-red-600 dark:text-red-400' : 'text-slate-500'}`}
        >
          {milestone.dueDate === null
            ? texts.noDate
            : overdue
              ? texts.overdue(formatDueDate(milestone.dueDate))
              : texts.due(formatDueDate(milestone.dueDate))}
        </span>
        {canEdit && (
          <span className="ml-auto flex gap-3">
            <button
              type="button"
              disabled={update.isPending}
              onClick={() => update.mutate({ id: milestone.id, closed: !milestone.closed })}
              aria-label={(milestone.closed ? texts.reopenLabel : texts.closeLabel)(milestone.name)}
              className={actionClass}
            >
              {milestone.closed ? texts.reopen : texts.close}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(true)}
              aria-label={texts.deleteLabel(milestone.name)}
              className={`${actionClass} hover:text-red-600`}
            >
              {t.common.delete}
            </button>
          </span>
        )}
      </div>
      <Progress milestone={milestone} />
      {confirming && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>{texts.deleteConfirm}</span>
          <Button
            variant="danger"
            disabled={remove.isPending}
            onClick={() => remove.mutate(milestone.id)}
          >
            {t.project.confirmDelete}
          </Button>
          <Button variant="secondary" onClick={() => setConfirming(false)}>
            {t.common.cancel}
          </Button>
        </div>
      )}
    </li>
  )
}

/** The milestones of a project and how far each of them is. */
export function MilestonesPage() {
  const t = useT()
  const texts = t.project.milestones
  const { project, canEdit } = useProjectContext()
  const milestones = useMilestones(project.id)
  const mutations = useMilestoneMutations(project.id)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const { create, update, remove } = mutations
  const actionError = create.error ?? update.error ?? remove.error

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const parsed = parseForm(createMilestoneRequestSchema, {
      name: String(values.get('name') ?? ''),
      dueDate: String(values.get('dueDate') ?? '') || null,
    })
    setFieldErrors(parsed.ok ? {} : parsed.errors)
    if (!parsed.ok) return
    update.reset()
    remove.reset()
    create.mutate(parsed.data, { onSuccess: () => form.reset() })
  }

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-lg font-semibold">{texts.heading}</h2>
      {actionError && <Alert>{errorMessage(actionError)}</Alert>}
      {milestones.isPending && <Spinner />}
      {milestones.isError && <Alert>{errorMessage(milestones.error)}</Alert>}
      {milestones.data?.length === 0 && <p className="text-sm text-slate-500">{texts.empty}</p>}
      {milestones.data && milestones.data.length > 0 && (
        <ul className="space-y-3">
          {milestones.data.map((milestone) => (
            <MilestoneItem
              key={milestone.id}
              projectId={project.id}
              milestone={milestone}
              canEdit={canEdit}
              mutations={mutations}
            />
          ))}
        </ul>
      )}

      {canEdit && (
        <Card>
          <h3 className="mb-3 text-base font-semibold">{texts.newMilestone}</h3>
          <form onSubmit={handleCreate} noValidate className="flex flex-wrap items-start gap-3">
            <TextField
              label={texts.name}
              name="name"
              required
              maxLength={80}
              error={fieldErrors.name}
              className="min-w-48 flex-1"
            />
            <TextField label={texts.date} name="dueDate" type="date" error={fieldErrors.dueDate} />
            <Button type="submit" className="mt-6" disabled={create.isPending}>
              {texts.add}
            </Button>
          </form>
        </Card>
      )}
    </div>
  )
}
