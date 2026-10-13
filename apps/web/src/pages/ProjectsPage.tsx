import { createProjectRequestSchema, type Project } from '@chillawiki/shared'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { errorMessage } from '../api/client'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../components/form'
import { Alert, Button, Card, Spinner, TextField } from '../components/ui'
import { useT } from '../i18n'
import { useCreateProject, useProjects } from './project/projectQueries'

function NewProjectForm({ onClose }: { onClose: () => void }) {
  const t = useT()
  const texts = t.shell.projects
  const createProject = useCreateProject()
  const navigate = useNavigate()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = parseForm(createProjectRequestSchema, {
      name: String(form.get('name') ?? ''),
      key: String(form.get('key') ?? '')
        .trim()
        .toUpperCase(),
      description: String(form.get('description') ?? ''),
    })
    if (!parsed.ok) {
      createProject.reset()
      setFieldErrors(parsed.errors)
      focusFirstInvalid(event.currentTarget, parsed.errors)
      return
    }
    setFieldErrors({})
    createProject.mutate(parsed.data, {
      onSuccess: (project) => navigate(`/projects/${project.id}`),
    })
  }

  return (
    <Card className="mb-6">
      <h2 className="mb-4 text-base font-semibold">{texts.newProject}</h2>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {createProject.isError && <Alert>{errorMessage(createProject.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <TextField label={texts.name} name="name" required error={fieldErrors.name} autoFocus />
          <TextField
            label={texts.key}
            name="key"
            placeholder="CHL"
            maxLength={10}
            required
            hint={texts.keyHint}
            error={fieldErrors.key}
          />
        </div>
        <TextField label={texts.description} name="description" error={fieldErrors.description} />
        <div className="flex gap-2">
          <Button type="submit" disabled={createProject.isPending}>
            {createProject.isPending ? texts.creating : texts.create}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t.common.cancel}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function ProjectCard({ project }: { project: Project }) {
  const t = useT()
  return (
    <li>
      <Link
        to={`/projects/${project.id}`}
        className="block h-full rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-400 hover:shadow dark:border-slate-800 dark:bg-slate-900 dark:hover:border-indigo-500"
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-semibold">{project.name}</h2>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {project.key}
          </span>
        </div>
        {project.description && (
          <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
            {project.description}
          </p>
        )}
        <p className="mt-3 text-xs text-slate-500 capitalize">{t.common.role[project.role]}</p>
      </Link>
    </li>
  )
}

export function ProjectsPage() {
  const texts = useT().shell.projects
  const projects = useProjects()
  const [creating, setCreating] = useState(false)

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{texts.title}</h1>
        {!creating && <Button onClick={() => setCreating(true)}>{texts.newProject}</Button>}
      </div>

      {creating && <NewProjectForm onClose={() => setCreating(false)} />}

      {projects.isPending && <Spinner />}
      {projects.isError && <Alert>{errorMessage(projects.error)}</Alert>}
      {projects.isSuccess && projects.data.length === 0 && !creating && (
        <Card className="text-center">
          <p className="font-medium">{texts.empty}</p>
          <p className="mt-1 text-sm text-slate-500">{texts.emptyHint}</p>
        </Card>
      )}
      {projects.isSuccess && projects.data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </ul>
      )}
    </>
  )
}
