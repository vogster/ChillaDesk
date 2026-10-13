import type { TaskWatchers } from '@chilladesk/shared'
import { and, asc, eq } from 'drizzle-orm'
import type { Db, Executor } from '../../db/client'
import { taskWatchers, users } from '../../db/schema'
import { getProject } from '../projects/service'
import { assertTaskInProject } from './service'

/**
 * Makes people watchers of a task, if they are not already. Called when someone gets
 * involved in a task: creating it, being assigned to it, commenting on it.
 */
export async function watchTask(
  db: Executor,
  taskId: string,
  userIds: (string | null | undefined)[],
): Promise<void> {
  const watchers = [...new Set(userIds.filter((id): id is string => typeof id === 'string'))]
  if (watchers.length === 0) return
  await db
    .insert(taskWatchers)
    .values(watchers.map((userId) => ({ taskId, userId })))
    .onConflictDoNothing()
}

/** Ids of everyone watching a task. Does not check access. */
export async function watcherIdsOf(db: Executor, taskId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: taskWatchers.userId })
    .from(taskWatchers)
    .where(eq(taskWatchers.taskId, taskId))
  return rows.map((row) => row.userId)
}

/** Who watches a task, and whether the asker is one of them. */
export async function listWatchers(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
): Promise<TaskWatchers> {
  await getProject(db, userId, projectId)
  await assertTaskInProject(db, projectId, taskId)
  const watchers = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(taskWatchers)
    .innerJoin(users, eq(users.id, taskWatchers.userId))
    .where(eq(taskWatchers.taskId, taskId))
    .orderBy(asc(users.name), asc(users.id))
  return { watching: watchers.some((watcher) => watcher.id === userId), watchers }
}

/**
 * Starts or stops watching a task for the asker. Any member may, viewers included:
 * following a task changes nothing in the project.
 */
export async function setWatching(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
  watching: boolean,
): Promise<TaskWatchers> {
  await getProject(db, userId, projectId)
  await assertTaskInProject(db, projectId, taskId)
  if (watching) await watchTask(db, taskId, [userId])
  else {
    await db
      .delete(taskWatchers)
      .where(and(eq(taskWatchers.taskId, taskId), eq(taskWatchers.userId, userId)))
  }
  return listWatchers(db, userId, projectId, taskId)
}
