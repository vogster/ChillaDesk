import { updateProjectRequestSchema, type Project } from '@chilladesk/shared'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage } from '../../api/client'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../../components/form'
import { Alert, Button, Card, TextField } from '../../components/ui'
import { useT } from '../../i18n'
import { useDeleteProject, useUpdateProject } from './projectQueries'

/** Owner-only: rename the project or delete it. */
export function ProjectSettings({ project }: { project: Project }) {
  const t = useT()
  const updateProject = useUpdateProject(project.id)
  const deleteProject = useDeleteProject(project.id)
  const navigate = useNavigate()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = parseForm(updateProjectRequestSchema, {
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? ''),
    })
    if (!parsed.ok) {
      updateProject.reset()
      setFieldErrors(parsed.errors)
      focusFirstInvalid(event.currentTarget, parsed.errors)
      return
    }
    setFieldErrors({})
    updateProject.mutate({
      name: parsed.data.name ?? project.name,
      description: parsed.data.description ?? project.description,
    })
  }

  const handleDelete = () => {
    deleteProject.mutate(undefined, { onSuccess: () => navigate('/', { replace: true }) })
  }

  return (
    <Card>
      <h2 className="mb-4 text-base font-semibold">{t.project.settings.heading}</h2>
      <form onSubmit={handleSave} noValidate className="space-y-4">
        {updateProject.isError && <Alert>{errorMessage(updateProject.error)}</Alert>}
        <TextField
          label={t.project.settings.name}
          name="name"
          defaultValue={project.name}
          required
          error={fieldErrors.name}
        />
        <TextField
          label={t.project.settings.description}
          name="description"
          defaultValue={project.description}
          error={fieldErrors.description}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={updateProject.isPending}>
            {t.project.settings.saveChanges}
          </Button>
          {updateProject.isSuccess && (
            <span role="status" className="text-sm text-slate-500">
              {t.project.settings.saved}
            </span>
          )}
        </div>
      </form>

      <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
        {deleteProject.isError && (
          <div className="mb-3">
            <Alert>{errorMessage(deleteProject.error)}</Alert>
          </div>
        )}
        {confirmingDelete ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              {t.project.settings.deleteConfirm.before}
              <strong>{project.name}</strong>
              {t.project.settings.deleteConfirm.after}
            </p>
            <Button variant="danger" onClick={handleDelete} disabled={deleteProject.isPending}>
              {t.project.confirmDelete}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
              {t.common.cancel}
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setConfirmingDelete(true)}>
            {t.project.settings.deleteProject}
          </Button>
        )}
      </div>
    </Card>
  )
}
