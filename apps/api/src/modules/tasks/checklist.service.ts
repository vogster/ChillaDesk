import type {
  ChecklistItem,
  ChecklistProgress,
  CreateChecklistItem,
  UpdateChecklistItem,
} from '@chilladesk/shared'
import { and, asc, count, eq, inArray, max, sql } from 'drizzle-orm'
import type { Db, Executor } from '../../db/client'
import { checklistItems, tasks } from '../../db/schema'
import { conflict, notFound } from '../../errors'
import { getProject } from '../projects/service'
import { assertTaskInProject } from './service'

/** Items one task can have; a longer list is a project plan, not a checklist. */
export const MAX_CHECKLIST_ITEMS = 100

type ItemRow = typeof checklistItems.$inferSelect

const toItem = (row: ItemRow): ChecklistItem => ({ id: row.id, text: row.text, done: row.done })

const ofTask = (taskId: string, itemId: string) =>
  and(eq(checklistItems.taskId, taskId), eq(checklistItems.id, itemId))

/** Progress of the checklists of several tasks at once; tasks without one are absent. */
export async function loadChecklistProgress(
  db: Executor,
  taskIds: string[],
): Promise<Map<string, ChecklistProgress>> {
  if (taskIds.length === 0) return new Map()
  const rows = await db
    .select({
      taskId: checklistItems.taskId,
      total: count(),
      done: sql<number>`count(*) filter (where ${checklistItems.done})`.mapWith(Number),
    })
    .from(checklistItems)
    .where(inArray(checklistItems.taskId, taskIds))
    .groupBy(checklistItems.taskId)
  return new Map(rows.map(({ taskId, done, total }) => [taskId, { done, total }]))
}

export async function listChecklist(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
): Promise<ChecklistItem[]> {
  await getProject(db, userId, projectId)
  await assertTaskInProject(db, projectId, taskId)
  const rows = await db
    .select()
    .from(checklistItems)
    .where(eq(checklistItems.taskId, taskId))
    .orderBy(asc(checklistItems.position), asc(checklistItems.id))
  return rows.map(toItem)
}

export async function addChecklistItem(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
  input: CreateChecklistItem,
): Promise<ChecklistItem> {
  await getProject(db, userId, projectId, 'member')
  return db.transaction(async (tx) => {
    // The task row is locked, so two people adding at once get different positions and
    // cannot push the list past its limit together.
    const [task] = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
      .for('update')
    if (!task) throw notFound('Task')

    const [existing] = await tx
      .select({ total: count(), last: max(checklistItems.position) })
      .from(checklistItems)
      .where(eq(checklistItems.taskId, taskId))
    if ((existing?.total ?? 0) >= MAX_CHECKLIST_ITEMS) {
      throw conflict(`A checklist can have at most ${MAX_CHECKLIST_ITEMS} items`)
    }
    const [created] = await tx
      .insert(checklistItems)
      .values({ taskId, text: input.text, position: (existing?.last ?? 0) + 1 })
      .returning()
    if (!created) throw new Error('Insert returned no checklist row')
    return toItem(created)
  })
}

export async function updateChecklistItem(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
  itemId: string,
  patch: UpdateChecklistItem,
): Promise<ChecklistItem> {
  await getProject(db, userId, projectId, 'member')
  await assertTaskInProject(db, projectId, taskId)
  const [updated] = await db
    .update(checklistItems)
    .set(patch)
    .where(ofTask(taskId, itemId))
    .returning()
  if (!updated) throw notFound('Checklist item')
  return toItem(updated)
}

export async function deleteChecklistItem(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
  itemId: string,
): Promise<void> {
  await getProject(db, userId, projectId, 'member')
  await assertTaskInProject(db, projectId, taskId)
  const removed = await db
    .delete(checklistItems)
    .where(ofTask(taskId, itemId))
    .returning({ id: checklistItems.id })
  if (removed.length === 0) throw notFound('Checklist item')
}
