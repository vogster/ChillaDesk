import type {
  CreateStatusRequest,
  Status,
  StatusCategory,
  UpdateStatusRequest,
} from '@chillawiki/shared'
import { and, asc, eq, gt, max, sql } from 'drizzle-orm'
import type { Db, Executor, Tx } from '../../db/client'
import { projects, statuses, tasks } from '../../db/schema'
import { conflict, invalid, isForeignKeyViolation, notFound } from '../../errors'
import { getProject } from '../projects/service'

const DEFAULT_STATUSES: readonly { name: string; category: StatusCategory }[] = [
  { name: 'To Do', category: 'todo' },
  { name: 'In Progress', category: 'in_progress' },
  { name: 'Done', category: 'done' },
]

type StatusRow = typeof statuses.$inferSelect

function toStatus(row: StatusRow): Status {
  return { id: row.id, name: row.name, category: row.category, position: row.position }
}

export async function createDefaultStatuses(tx: Tx, projectId: string): Promise<void> {
  await tx
    .insert(statuses)
    .values(DEFAULT_STATUSES.map((status, position) => ({ ...status, projectId, position })))
}

/** Columns of a project, left to right. Does not check access. */
export function loadStatuses(db: Executor, projectId: string): Promise<StatusRow[]> {
  return db
    .select()
    .from(statuses)
    .where(eq(statuses.projectId, projectId))
    .orderBy(asc(statuses.position), asc(statuses.id))
}

/**
 * Makes changes to a project's set of columns run one at a time. Without it two owners
 * could each delete "one of the last two" columns, or append two columns at the same position.
 */
async function lockBoard(tx: Tx, projectId: string): Promise<void> {
  await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .for('update')
}

export async function listStatuses(db: Db, userId: string, projectId: string): Promise<Status[]> {
  await getProject(db, userId, projectId)
  return (await loadStatuses(db, projectId)).map(toStatus)
}

export async function createStatus(
  db: Db,
  userId: string,
  projectId: string,
  input: CreateStatusRequest,
): Promise<Status> {
  await getProject(db, userId, projectId, 'owner')
  return db.transaction(async (tx) => {
    await lockBoard(tx, projectId)
    const [last] = await tx
      .select({ position: max(statuses.position) })
      .from(statuses)
      .where(eq(statuses.projectId, projectId))
    const [created] = await tx
      .insert(statuses)
      .values({ ...input, projectId, position: (last?.position ?? -1) + 1 })
      .returning()
    if (!created) throw new Error('Insert returned no status row')
    return toStatus(created)
  })
}

const inProject = (projectId: string, statusId: string) =>
  and(eq(statuses.projectId, projectId), eq(statuses.id, statusId))

export async function updateStatus(
  db: Db,
  userId: string,
  projectId: string,
  statusId: string,
  patch: UpdateStatusRequest,
): Promise<Status> {
  await getProject(db, userId, projectId, 'owner')
  const [updated] = await db
    .update(statuses)
    .set(patch)
    .where(inProject(projectId, statusId))
    .returning()
  if (!updated) throw notFound('Status')
  return toStatus(updated)
}

export async function reorderStatuses(
  db: Db,
  userId: string,
  projectId: string,
  statusIds: string[],
): Promise<Status[]> {
  await getProject(db, userId, projectId, 'owner')
  return db.transaction(async (tx) => {
    await lockBoard(tx, projectId)
    const current = await loadStatuses(tx, projectId)
    const known = new Set(current.map((status) => status.id))
    const complete =
      statusIds.length === current.length &&
      new Set(statusIds).size === statusIds.length &&
      statusIds.every((id) => known.has(id))
    if (!complete) throw invalid('statusIds must list every status of the project exactly once')

    for (const [position, id] of statusIds.entries()) {
      await tx.update(statuses).set({ position }).where(eq(statuses.id, id))
    }
    return (await loadStatuses(tx, projectId)).map(toStatus)
  })
}

const STATUS_IN_USE = 'Move the tasks out of this status before deleting it'

export async function deleteStatus(
  db: Db,
  userId: string,
  projectId: string,
  statusId: string,
): Promise<void> {
  await getProject(db, userId, projectId, 'owner')
  try {
    await db.transaction(async (tx) => {
      await lockBoard(tx, projectId)
      const current = await loadStatuses(tx, projectId)
      const target = current.find((status) => status.id === statusId)
      if (!target) throw notFound('Status')
      if (current.length === 1) throw conflict('A board must keep at least one status')

      // Waits for any task being created in or moved into this column right now.
      await tx
        .select({ id: statuses.id })
        .from(statuses)
        .where(eq(statuses.id, statusId))
        .for('update')
      const [used] = await tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(eq(tasks.statusId, statusId))
        .limit(1)
      if (used) throw conflict(STATUS_IN_USE)

      await tx.delete(statuses).where(eq(statuses.id, statusId))
      await tx
        .update(statuses)
        .set({ position: sql`${statuses.position} - 1` })
        .where(and(eq(statuses.projectId, projectId), gt(statuses.position, target.position)))
    })
  } catch (error) {
    // The foreign key is the last line of defence if a task slipped in after the check.
    if (isForeignKeyViolation(error)) throw conflict(STATUS_IN_USE)
    throw error
  }
}
