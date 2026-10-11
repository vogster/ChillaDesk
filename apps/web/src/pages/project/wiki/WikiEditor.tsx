import {
  createWikiPageRequestSchema,
  type Project,
  type WikiPage,
  type WikiPageSummary,
} from '@chillawiki/shared'
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { ApiError, errorMessage } from '../../../api/client'
import { parseForm, type FieldErrors } from '../../../components/form'
import { Alert, Button, selectClass, Spinner, TextField } from '../../../components/ui'
import { useDraft } from '../../../hooks/useDraft'
import { NotFoundPage } from '../../NotFoundPage'
import { useProjectContext } from '../ProjectLayout'
import { ProjectMarkdown } from '../ProjectMarkdown'
import { descendantIds, wikiPagePath } from './wikiModel'
import { isMissing } from './WikiPageView'
import {
  useCreateWikiPage,
  useFreshWikiPage,
  useOverwriteWikiPage,
  useUpdateWikiPage,
  useWikiPages,
} from './wikiQueries'

interface PageText {
  title: string
  content: string
  parentId: string | null
}

interface EditorFormProps {
  project: Project
  /** Identifies the unsaved draft in session storage. */
  draftKey: string
  /** Pages this one may be placed under. */
  parents: WikiPageSummary[]
  initial: PageText
  submitLabel: string
  isSaving: boolean
  error: unknown
  /**
   * Extra content for the error alert. `validated` returns the text as it would be saved;
   * `done` forgets the stored draft.
   */
  errorActions?: (validated: () => PageText | null, done: () => void) => ReactNode
  /** Called with valid text; `done` forgets the stored draft once the save has succeeded. */
  onSubmit: (text: PageText, done: () => void) => void
  onCancel: () => void
}

function EditorForm({
  project,
  draftKey,
  parents,
  initial,
  submitLabel,
  isSaving,
  error,
  errorActions,
  onSubmit,
  onCancel,
}: EditorFormProps) {
  const draft = useDraft(draftKey, initial)
  const text = draft.value
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [previewing, setPreviewing] = useState(false)
  const dirty =
    text.title !== initial.title ||
    text.content !== initial.content ||
    text.parentId !== initial.parentId

  // Closing the tab or reloading with unsaved text asks first. Moving around inside the app
  // does not need to: the draft is kept and offered back.
  useEffect(() => {
    if (!dirty || isSaving) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, isSaving])

  const validated = (): PageText | null => {
    const parsed = parseForm(createWikiPageRequestSchema, text)
    setFieldErrors(parsed.ok ? {} : parsed.errors)
    return parsed.ok ? parsed.data : null
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const valid = validated()
    if (valid) onSubmit(valid, draft.clear)
  }

  const tabClass = (active: boolean) =>
    `rounded-t-md border-b-2 px-3 py-1.5 text-sm font-medium ${
      active
        ? 'border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
        : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400'
    }`

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      {draft.restored && dirty && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          Your unsaved changes from earlier were restored.
          <button type="button" className="font-medium underline" onClick={draft.discard}>
            Discard them
          </button>
        </p>
      )}
      {Boolean(error) && (
        <Alert>
          {errorMessage(error)}
          {errorActions?.(validated, draft.clear)}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <TextField
          label="Title"
          name="title"
          value={text.title}
          onChange={(event) => draft.set({ ...text, title: event.target.value })}
          maxLength={150}
          required
          error={fieldErrors.title}
        />
        <div>
          <label htmlFor="wiki-parent" className="mb-1 block text-sm font-medium">
            Parent page
          </label>
          <select
            id="wiki-parent"
            className={`${selectClass} w-full py-2`}
            value={text.parentId ?? ''}
            onChange={(event) => draft.set({ ...text, parentId: event.target.value || null })}
          >
            <option value="">None (top level)</option>
            {parents.map((parent) => (
              <option key={parent.id} value={parent.id}>
                {parent.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <div
          role="tablist"
          aria-label="Editor mode"
          className="flex gap-1 border-b border-slate-200 dark:border-slate-800"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!previewing}
            className={tabClass(!previewing)}
            onClick={() => setPreviewing(false)}
          >
            Write
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={previewing}
            className={tabClass(previewing)}
            onClick={() => setPreviewing(true)}
          >
            Preview
          </button>
        </div>
        {previewing ? (
          <div className="min-h-64 rounded-b-md border border-t-0 border-slate-200 p-4 dark:border-slate-800">
            {text.content ? (
              // Links open in a new tab so that checking one does not leave the editor.
              <ProjectMarkdown project={project} linksLeaveInNewTab>
                {text.content}
              </ProjectMarkdown>
            ) : (
              <p className="text-sm text-slate-500">Nothing to preview yet.</p>
            )}
          </div>
        ) : (
          <>
            <label htmlFor="wiki-content" className="sr-only">
              Content
            </label>
            <textarea
              id="wiki-content"
              value={text.content}
              onChange={(event) => draft.set({ ...text, content: event.target.value })}
              rows={18}
              placeholder={`Markdown. Link pages with [[Page title]] and tasks with ${project.key}-1.`}
              aria-invalid={fieldErrors.content ? true : undefined}
              aria-describedby={fieldErrors.content ? 'wiki-content-error' : undefined}
              className="block w-full rounded-b-md border border-t-0 border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900"
            />
            {fieldErrors.content && (
              <p id="wiki-content-error" className="mt-1 text-xs text-red-600 dark:text-red-400">
                {fieldErrors.content}
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex gap-2">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? 'Saving…' : submitLabel}
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            draft.clear()
            onCancel()
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

const draftKeyFor = (projectId: string, page: string) =>
  `chillawiki:wiki-draft:${projectId}:${page}`

function NewPageForm({ project, parents }: { project: Project; parents: WikiPageSummary[] }) {
  const [searchParams] = useSearchParams()
  const createPage = useCreateWikiPage(project.id)
  const navigate = useNavigate()
  const title = searchParams.get('title') ?? ''
  const requestedParent = searchParams.get('parent')
  const parentId = parents.some((page) => page.id === requestedParent) ? requestedParent : null
  const initial = useMemo(() => ({ title, content: '', parentId }), [title, parentId])

  return (
    <EditorForm
      project={project}
      draftKey={draftKeyFor(project.id, `new:${title}`)}
      parents={parents}
      initial={initial}
      submitLabel="Create page"
      isSaving={createPage.isPending}
      error={createPage.error}
      onSubmit={(text, done) =>
        createPage.mutate(text, {
          onSuccess: (page) => {
            done()
            navigate(wikiPagePath(project.id, page.id), { replace: true })
          },
        })
      }
      onCancel={() => navigate(`/projects/${project.id}/wiki`)}
    />
  )
}

/** `/wiki/new`: optional `?title=` (from a link to a missing page) and `?parent=`. */
export function WikiNewPage() {
  const { project, canEdit } = useProjectContext()
  const [searchParams] = useSearchParams()
  const pages = useWikiPages(project.id)

  if (!canEdit) return <NotFoundPage />
  if (pages.isPending) return <Spinner />

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">New page</h2>
      {/* A different requested title is a different page to write: start its own form. */}
      <NewPageForm
        key={searchParams.get('title') ?? ''}
        project={project}
        parents={pages.data ?? []}
      />
    </div>
  )
}

/** A save refused because the page moved on, as opposed to a title that is taken. */
const isStaleEdit = (error: unknown) =>
  error instanceof ApiError &&
  error.code === 'CONFLICT' &&
  error.details.some((detail) => detail.path === 'baseVersion')

function EditExisting({ project, page }: { project: Project; page: WikiPage }) {
  const pages = useWikiPages(project.id)
  const updatePage = useUpdateWikiPage(project.id, page.id)
  const overwritePage = useOverwriteWikiPage(project.id, page.id)
  const navigate = useNavigate()
  const pagePath = wikiPagePath(project.id, page.id)
  const initial = useMemo(
    () => ({ title: page.title, content: page.content, parentId: page.parentId }),
    [page.title, page.content, page.parentId],
  )

  const blocked = descendantIds(pages.data ?? [], page.id)
  const parents = (pages.data ?? []).filter(
    (candidate) => candidate.id !== page.id && !blocked.has(candidate.id),
  )

  const handleSubmit = (text: PageText, done: () => void) => {
    // Only what the user changed is sent. Resending an untouched parent would undo a move
    // someone else made meanwhile, which the version check does not cover.
    const changes = {
      ...(text.title !== page.title ? { title: text.title } : {}),
      ...(text.content !== page.content ? { content: text.content } : {}),
      ...(text.parentId !== page.parentId ? { parentId: text.parentId } : {}),
    }
    const finish = () => {
      done()
      navigate(pagePath)
    }
    if (Object.keys(changes).length === 0) finish()
    else updatePage.mutate({ ...changes, baseVersion: page.version }, { onSuccess: finish })
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Edit page</h2>
      <EditorForm
        project={project}
        // Tied to the version: a draft written against older text is not offered again.
        draftKey={draftKeyFor(project.id, `${page.id}:v${page.version}`)}
        parents={parents}
        initial={initial}
        submitLabel="Save"
        isSaving={updatePage.isPending || overwritePage.isPending}
        error={overwritePage.error ?? updatePage.error}
        errorActions={(validated, done) =>
          isStaleEdit(updatePage.error) &&
          !overwritePage.error && (
            <span className="mt-2 block">
              Your text is still here. Copy what you need, or{' '}
              <button
                type="button"
                className="font-medium underline disabled:opacity-60"
                disabled={overwritePage.isPending}
                onClick={() => {
                  const text = validated()
                  if (!text) return
                  overwritePage.mutate(
                    { title: text.title, content: text.content },
                    {
                      onSuccess: () => {
                        done()
                        navigate(pagePath)
                      },
                    },
                  )
                }}
              >
                save your version over theirs
              </button>
              .
            </span>
          )
        }
        onSubmit={handleSubmit}
        onCancel={() => navigate(pagePath)}
      />
    </div>
  )
}

export function WikiEditPage() {
  const { project, canEdit } = useProjectContext()
  const { pageId = '' } = useParams()
  const page = useFreshWikiPage(project.id, pageId)
  // The page as it was when editing began. Later refetches may deliver a newer version;
  // saving must still be checked against the one the text was based on.
  const [started, setStarted] = useState<WikiPage | null>(null)
  if (!started && page.isFresh && page.data) setStarted(page.data)

  if (!canEdit) return <NotFoundPage />
  if (page.isError && !started) {
    return isMissing(page.error) ? <NotFoundPage /> : <Alert>{errorMessage(page.error)}</Alert>
  }
  if (!started) return <Spinner />
  return <EditExisting key={started.id} project={project} page={started} />
}
