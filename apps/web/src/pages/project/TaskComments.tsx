import { commentRequestSchema, type Comment } from '@chilladesk/shared'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '../../api/client'
import { Alert, Button, Spinner } from '../../components/ui'
import { intlLocale, useT } from '../../i18n'
import { MentionTextarea } from './mentions/MentionTextarea'
import type { ProjectContext } from './ProjectLayout'
import { ProjectMarkdown } from './ProjectMarkdown'
import { useCommentMutations, useComments } from './taskQueries'

const textAreaClass =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900'

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' })
}

interface CommentItemProps {
  context: ProjectContext
  comment: Comment
  mutations: ReturnType<typeof useCommentMutations>
}

function CommentItem({ context, comment, mutations }: CommentItemProps) {
  const t = useT()
  const text = t.tasks.comments
  const { project, currentUser } = context
  const { add, edit, remove } = mutations
  const [editing, setEditing] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const authorName = comment.author?.name ?? t.common.deletedUser
  const isAuthor = comment.author?.id === currentUser.id
  const canDelete = isAuthor || project.role === 'owner'
  const errorId = `comment-${comment.id}-error`

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = commentRequestSchema.safeParse({
      body: new FormData(event.currentTarget).get('body'),
    })
    setInvalid(!parsed.success)
    if (!parsed.success) return
    add.reset()
    remove.reset()
    edit.mutate(
      { commentId: comment.id, body: parsed.data.body },
      { onSuccess: () => setEditing(false) },
    )
  }

  const actionClass = 'text-xs text-slate-500 hover:underline'

  return (
    <li className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="font-medium text-slate-700 dark:text-slate-200">{authorName}</span>
        <time dateTime={comment.createdAt}>{formatTimestamp(comment.createdAt)}</time>
        {comment.updatedAt !== comment.createdAt && (
          <span title={text.editedAt(formatTimestamp(comment.updatedAt))}>{text.edited}</span>
        )}
        <span className="ml-auto flex gap-3">
          {isAuthor && !editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={text.editYours(formatTimestamp(comment.createdAt))}
              className={`${actionClass} hover:text-indigo-600`}
            >
              {t.common.edit}
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => {
                add.reset()
                edit.reset()
                remove.mutate(comment.id)
              }}
              aria-label={text.deleteBy(comment.author?.name ?? null)}
              className={`${actionClass} hover:text-red-600`}
            >
              {t.common.delete}
            </button>
          )}
        </span>
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="space-y-2">
          <label htmlFor={`comment-${comment.id}`} className="sr-only">
            {text.editLabel}
          </label>
          <MentionTextarea
            projectId={project.id}
            id={`comment-${comment.id}`}
            name="body"
            rows={3}
            defaultValue={comment.body}
            autoFocus
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? errorId : undefined}
            className={textAreaClass}
          />
          {invalid && (
            <p id={errorId} className="text-xs text-red-600 dark:text-red-400">
              {text.emptyBody}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={edit.isPending}>
              {text.save}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setInvalid(false)
                setEditing(false)
              }}
            >
              {t.common.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <ProjectMarkdown project={project}>{comment.body}</ProjectMarkdown>
      )}
    </li>
  )
}

interface TaskCommentsProps {
  context: ProjectContext
  taskId: string
}

export function TaskComments({ context, taskId }: TaskCommentsProps) {
  const t = useT()
  const text = t.tasks.comments
  const { project, canEdit } = context
  const comments = useComments(project.id, taskId)
  const mutations = useCommentMutations(project.id, taskId)
  const { add, edit, remove } = mutations
  const [invalid, setInvalid] = useState(false)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const parsed = commentRequestSchema.safeParse({ body: new FormData(form).get('body') })
    setInvalid(!parsed.success)
    if (!parsed.success) return
    edit.reset()
    remove.reset()
    add.mutate(parsed.data.body, { onSuccess: () => form.reset() })
  }

  const actionError = add.error ?? edit.error ?? remove.error

  return (
    <section aria-labelledby="comments-heading" className="space-y-3">
      <h3 id="comments-heading" className="text-sm font-semibold">
        {text.heading}
      </h3>
      {actionError && <Alert>{errorMessage(actionError)}</Alert>}
      {comments.isPending && <Spinner />}
      {comments.isError && <Alert>{errorMessage(comments.error)}</Alert>}
      {comments.isSuccess && comments.data.length === 0 && (
        <p className="text-sm text-slate-500">{text.empty}</p>
      )}
      {comments.isSuccess && comments.data.length > 0 && (
        <ul className="space-y-3">
          {comments.data.map((comment) => (
            <CommentItem
              key={comment.id}
              context={context}
              comment={comment}
              mutations={mutations}
            />
          ))}
        </ul>
      )}

      {canEdit && (
        <form onSubmit={handleSubmit} className="space-y-2">
          <label htmlFor="new-comment" className="sr-only">
            {text.addLabel}
          </label>
          <MentionTextarea
            projectId={context.project.id}
            id="new-comment"
            name="body"
            rows={3}
            placeholder={text.addPlaceholder}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? 'new-comment-error' : undefined}
            className={textAreaClass}
          />
          {invalid && (
            <p id="new-comment-error" className="text-xs text-red-600 dark:text-red-400">
              {text.emptyBody}
            </p>
          )}
          <Button type="submit" disabled={add.isPending}>
            {text.submit}
          </Button>
        </form>
      )}
    </section>
  )
}
