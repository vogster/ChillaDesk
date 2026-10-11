import { commentRequestSchema, type Comment } from '@chillawiki/shared'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '../../api/client'
import { Markdown } from '../../components/Markdown'
import { Alert, Button, Spinner } from '../../components/ui'
import type { ProjectContext } from './ProjectLayout'
import { useCommentMutations, useComments } from './taskQueries'

const textAreaClass =
  'block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-2 focus:outline-indigo-500 dark:border-slate-700 dark:bg-slate-900'

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

interface TaskCommentsProps {
  context: ProjectContext
  taskId: string
}

export function TaskComments({ context, taskId }: TaskCommentsProps) {
  const { project, currentUser, canEdit } = context
  const comments = useComments(project.id, taskId)
  const { add, remove } = useCommentMutations(project.id, taskId)
  const [invalid, setInvalid] = useState(false)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const parsed = commentRequestSchema.safeParse({ body: new FormData(form).get('body') })
    setInvalid(!parsed.success)
    if (!parsed.success) return
    remove.reset()
    add.mutate(parsed.data.body, { onSuccess: () => form.reset() })
  }

  const canDelete = (comment: Comment) =>
    comment.author?.id === currentUser.id || project.role === 'owner'
  const actionError = add.error ?? remove.error

  return (
    <section aria-labelledby="comments-heading" className="space-y-3">
      <h3 id="comments-heading" className="text-sm font-semibold">
        Comments
      </h3>
      {actionError && <Alert>{errorMessage(actionError)}</Alert>}
      {comments.isPending && <Spinner />}
      {comments.isError && <Alert>{errorMessage(comments.error)}</Alert>}
      {comments.isSuccess && comments.data.length === 0 && (
        <p className="text-sm text-slate-500">No comments yet.</p>
      )}
      {comments.isSuccess && comments.data.length > 0 && (
        <ul className="space-y-3">
          {comments.data.map((comment) => (
            <li
              key={comment.id}
              className="rounded-md border border-slate-200 p-3 dark:border-slate-800"
            >
              <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {comment.author?.name ?? 'Deleted user'}
                </span>
                <time dateTime={comment.createdAt}>{formatTimestamp(comment.createdAt)}</time>
                {canDelete(comment) && (
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => {
                      add.reset()
                      remove.mutate(comment.id)
                    }}
                    aria-label={`Delete comment by ${comment.author?.name ?? 'deleted user'}`}
                    className="ml-auto text-xs text-slate-500 hover:text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                )}
              </div>
              <Markdown>{comment.body}</Markdown>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form onSubmit={handleSubmit} className="space-y-2">
          <label htmlFor="new-comment" className="sr-only">
            Add a comment
          </label>
          <textarea
            id="new-comment"
            name="body"
            rows={3}
            placeholder="Add a comment… Markdown is supported."
            aria-invalid={invalid ? true : undefined}
            aria-describedby={invalid ? 'new-comment-error' : undefined}
            className={textAreaClass}
          />
          {invalid && (
            <p id="new-comment-error" className="text-xs text-red-600 dark:text-red-400">
              Write a comment first.
            </p>
          )}
          <Button type="submit" disabled={add.isPending}>
            Comment
          </Button>
        </form>
      )}
    </section>
  )
}
