import type { Comment, CommentRequest } from '@chillawiki/shared'
import { and, asc, eq } from 'drizzle-orm'
import type { Db, Executor } from '../../db/client'
import { comments, users } from '../../db/schema'
import { forbidden, notFound } from '../../errors'
import { getProject } from '../projects/service'
import { assertTaskInProject } from './service'

const commentColumns = {
  comment: comments,
  author: { id: users.id, name: users.name, email: users.email },
}

function selectComments(db: Executor) {
  return db.select(commentColumns).from(comments).leftJoin(users, eq(users.id, comments.authorId))
}

type CommentRow = Awaited<ReturnType<typeof selectComments>>[number]

function toComment({ comment, author }: CommentRow): Comment {
  return {
    id: comment.id,
    taskId: comment.taskId,
    author,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  }
}

const onTask = (taskId: string, commentId: string) =>
  and(eq(comments.taskId, taskId), eq(comments.id, commentId))

async function loadComment(db: Executor, taskId: string, commentId: string): Promise<Comment> {
  const [row] = await selectComments(db).where(onTask(taskId, commentId))
  if (!row) throw notFound('Comment')
  return toComment(row)
}

export async function listComments(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
): Promise<Comment[]> {
  await getProject(db, userId, projectId)
  await assertTaskInProject(db, projectId, taskId)
  const rows = await selectComments(db)
    .where(eq(comments.taskId, taskId))
    .orderBy(asc(comments.createdAt), asc(comments.id))
  return rows.map(toComment)
}

export async function addComment(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
  input: CommentRequest,
): Promise<Comment> {
  await getProject(db, userId, projectId, 'member')
  await assertTaskInProject(db, projectId, taskId)
  const [created] = await db
    .insert(comments)
    .values({ taskId, authorId: userId, body: input.body })
    .returning({ id: comments.id })
  if (!created) throw new Error('Insert returned no comment row')
  return loadComment(db, taskId, created.id)
}

export async function updateComment(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
  commentId: string,
  input: CommentRequest,
): Promise<Comment> {
  await getProject(db, userId, projectId, 'member')
  await assertTaskInProject(db, projectId, taskId)
  const existing = await loadComment(db, taskId, commentId)
  if (existing.author?.id !== userId) throw forbidden('Only the author can edit a comment')

  await db
    .update(comments)
    .set({ body: input.body, updatedAt: new Date() })
    .where(onTask(taskId, commentId))
  return loadComment(db, taskId, commentId)
}

/** Authors remove their own comments; project owners can remove anyone's. */
export async function deleteComment(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
  commentId: string,
): Promise<void> {
  const project = await getProject(db, userId, projectId)
  await assertTaskInProject(db, projectId, taskId)
  const existing = await loadComment(db, taskId, commentId)
  if (existing.author?.id !== userId && project.role !== 'owner') {
    throw forbidden('Only the author or a project owner can delete a comment')
  }
  await db.delete(comments).where(onTask(taskId, commentId))
}
