import { updateProjectRequestSchema, type Project } from '@chillawiki/shared'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage } from '../../api/client'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../../components/form'
import { Alert, Button, Card, TextField } from '../../components/ui'
import { useDeleteProject, useUpdateProject } from './projectQueries'

/** Owner-only: rename the project or delete it. */
export function ProjectSettings({ project }: { project: Project }) {
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
      <h2 className="mb-4 text-base font-semibold">Settings</h2>
      <form onSubmit={handleSave} noValidate className="space-y-4">
        {updateProject.isError && <Alert>{errorMessage(updateProject.error)}</Alert>}
        <TextField
          label="Name"
          name="name"
          defaultValue={project.name}
          required
          error={fieldErrors.name}
        />
        <TextField
          label="Description"
          name="description"
          defaultValue={project.description}
          error={fieldErrors.description}
        />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={updateProject.isPending}>
            Save changes
          </Button>
          {updateProject.isSuccess && (
            <span role="status" className="text-sm text-slate-500">
              Saved
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
              Delete <strong>{project.name}</strong> with all its data? This cannot be undone.
            </p>
            <Button variant="danger" onClick={handleDelete} disabled={deleteProject.isPending}>
              Yes, delete
            </Button>
            <Button variant="secondary" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setConfirmingDelete(true)}>
            Delete project…
          </Button>
        )}
      </div>
    </Card>
  )
}
