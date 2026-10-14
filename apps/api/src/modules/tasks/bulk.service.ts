import type { BulkTasksRequest, CreateSavedFilter, SavedFilter } from '@chilladesk/shared'
import { and, asc, count, eq, inArray } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { savedFilters, tasks } from '../../db/schema'
import { conflict, isUniqueViolation, notFound } from '../../errors'
import { getProject } from '../projects/service'
import { deleteTask, lockStatus, moveTask, updateTask } from './service'

/**
 * Applies one action to several tasks, all or nothing: each task goes through the same
 * code as a change to it alone, so history, notifications and checks are the same.
 */
export async function bulkTasks(
  db: Db,
  userId: string,
  projectId: string,
  { taskIds, action }: BulkTasksRequest,
): Promise<{ affected: number }> {
  await getProject(db, userId, projectId, 'member')
  return db.transaction(async (tx) => {
    // A move locks its column first, before any task, like a single move does.
    if (action.type !== 'delete' && action.patch.statusId) {
      await lockStatus(tx, projectId, action.patch.statusId)
    }
    // Locked in a fixed order, so two bulk actions over the same tasks cannot deadlock.
    const found = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), inArray(tasks.id, taskIds)))
      .orderBy(asc(tasks.id))
      .for('update')
    if (found.length !== taskIds.length) throw notFound('Task')

    for (const { id } of found) {
      if (action.type === 'delete') {
        await deleteTask(tx, userId, projectId, id)
        continue
      }
      const { statusId, ...fields } = action.patch
      if (Object.keys(fields).length > 0) await updateTask(tx, userId, projectId, id, fields)
      // A move puts the task at the end of the column, like dropping it there.
      if (statusId) await moveTask(tx, userId, projectId, id, { statusId, beforeTaskId: null })
    }
    return { affected: found.length }
  })
}

/** Filters one person can keep per project. */
export const MAX_SAVED_FILTERS = 30

const toFilter = (row: typeof savedFilters.$inferSelect): SavedFilter => ({
  id: row.id,
  name: row.name,
  query: row.query,
})

const mine = (userId: string, projectId: string) =>
  and(eq(savedFilters.userId, userId), eq(savedFilters.projectId, projectId))

/** The asker's own saved filters of a project, by name. Nobody sees anyone else's. */
export async function listSavedFilters(
  db: Db,
  userId: string,
  projectId: string,
): Promise<SavedFilter[]> {
  await getProject(db, userId, projectId)
  const rows = await db
    .select()
    .from(savedFilters)
    .where(mine(userId, projectId))
    .orderBy(asc(savedFilters.name))
  return rows.map(toFilter)
}

export async function createSavedFilter(
  db: Db,
  userId: string,
  projectId: string,
  input: CreateSavedFilter,
): Promise<SavedFilter> {
  await getProject(db, userId, projectId)
  const [existing] = await db
    .select({ total: count() })
    .from(savedFilters)
    .where(mine(userId, projectId))
  if ((existing?.total ?? 0) >= MAX_SAVED_FILTERS) {
    throw conflict('You have too many saved filters in this project, delete some first')
  }
  try {
    const [created] = await db
      .insert(savedFilters)
      .values({ userId, projectId, name: input.name, query: input.query })
      .returning()
    if (!created) throw new Error('Insert returned no filter row')
    return toFilter(created)
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(`You already have a filter named "${input.name}"`)
    }
    throw error
  }
}

export async function deleteSavedFilter(
  db: Db,
  userId: string,
  projectId: string,
  filterId: string,
): Promise<void> {
  await getProject(db, userId, projectId)
  const removed = await db
    .delete(savedFilters)
    .where(and(mine(userId, projectId), eq(savedFilters.id, filterId)))
    .returning({ id: savedFilters.id })
  if (removed.length === 0) throw notFound('Filter')
}
