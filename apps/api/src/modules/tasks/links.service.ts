import { INVERSE_RELATION, type CreateTaskLink, type TaskLink } from '@chilladesk/shared'
import { and, asc, eq, or } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Db } from '../../db/client'
import { projects, statuses, taskLinks, tasks } from '../../db/schema'
import { conflict, invalid, isUniqueViolation, notFound } from '../../errors'
import { getProject } from '../projects/service'
import { assertTaskInProject } from './service'

/** Links one task can have; past that the list stops being readable. */
export const MAX_LINKS_PER_TASK = 50

/** The kinds as they are stored: each says what the source is to the target. */
type StoredKind = (typeof taskLinks.$inferSelect)['kind']

/**
 * How a relation, read from one task, is stored: which kind, and whether that task is
 * the source. "A is blocked by B" is kept as "B blocks A".
 */
const STORED: Record<TaskLink['relation'], { kind: StoredKind; fromHere: boolean }> = {
  blocks: { kind: 'blocks', fromHere: true },
  blocked_by: { kind: 'blocks', fromHere: false },
  duplicates: { kind: 'duplicates', fromHere: true },
  duplicated_by: { kind: 'duplicates', fromHere: false },
  subtask_of: { kind: 'subtask_of', fromHere: true },
  parent_of: { kind: 'subtask_of', fromHere: false },
  relates_to: { kind: 'relates_to', fromHere: true },
}

const other = alias(tasks, 'other')

/** The links of a task, each read from that task's side. */
export async function listLinks(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
): Promise<TaskLink[]> {
  await getProject(db, userId, projectId)
  await assertTaskInProject(db, projectId, taskId)
  const rows = await db
    .select({
      link: taskLinks,
      task: { id: other.id, number: other.number, title: other.title },
      projectKey: projects.key,
      category: statuses.category,
    })
    .from(taskLinks)
    // The task at the other end, whichever end this one is.
    .innerJoin(
      other,
      or(
        and(eq(taskLinks.sourceTaskId, taskId), eq(other.id, taskLinks.targetTaskId)),
        and(eq(taskLinks.targetTaskId, taskId), eq(other.id, taskLinks.sourceTaskId)),
      ),
    )
    .innerJoin(projects, eq(projects.id, other.projectId))
    .innerJoin(statuses, eq(statuses.id, other.statusId))
    .where(or(eq(taskLinks.sourceTaskId, taskId), eq(taskLinks.targetTaskId, taskId)))
    .orderBy(asc(taskLinks.kind), asc(other.number))

  return rows.map(({ link, task, projectKey, category }) => ({
    id: link.id,
    relation: link.sourceTaskId === taskId ? link.kind : INVERSE_RELATION[link.kind],
    task: {
      id: task.id,
      key: `${projectKey}-${task.number}`,
      title: task.title,
      done: category === 'done',
    },
  }))
}

export async function addLink(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
  input: CreateTaskLink,
): Promise<TaskLink[]> {
  await getProject(db, userId, projectId, 'member')
  await assertTaskInProject(db, projectId, taskId)
  const [target] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.number, input.taskNumber)))
  if (!target) throw notFound('Task')
  if (target.id === taskId) throw invalid('A task cannot be linked to itself')

  const { kind, fromHere } = STORED[input.relation]
  const [sourceTaskId, targetTaskId] = fromHere ? [taskId, target.id] : [target.id, taskId]
  const already = conflict('These two tasks are linked already')

  try {
    await db.transaction(async (tx) => {
      // Both tasks are locked in a fixed order, so the checks below hold until the insert
      // and two people linking the same pair cannot deadlock.
      for (const id of [taskId, target.id].sort()) {
        await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id)).for('update')
      }
      const between = await tx
        .select({ sourceTaskId: taskLinks.sourceTaskId, kind: taskLinks.kind })
        .from(taskLinks)
        .where(
          or(
            and(eq(taskLinks.sourceTaskId, taskId), eq(taskLinks.targetTaskId, target.id)),
            and(eq(taskLinks.sourceTaskId, target.id), eq(taskLinks.targetTaskId, taskId)),
          ),
        )
      // One link per pair: "A blocks B" next to "B blocks A" or "A duplicates B" says nothing.
      if (between.length > 0) throw already

      const mine = await tx
        .select({ id: taskLinks.id })
        .from(taskLinks)
        .where(or(eq(taskLinks.sourceTaskId, taskId), eq(taskLinks.targetTaskId, taskId)))
      if (mine.length >= MAX_LINKS_PER_TASK) {
        throw conflict(`A task can have at most ${MAX_LINKS_PER_TASK} links`)
      }
      await tx.insert(taskLinks).values({ sourceTaskId, targetTaskId, kind, createdBy: userId })
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw already
    throw error
  }
  return listLinks(db, userId, projectId, taskId)
}

export async function removeLink(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
  linkId: string,
): Promise<void> {
  await getProject(db, userId, projectId, 'member')
  await assertTaskInProject(db, projectId, taskId)
  const removed = await db
    .delete(taskLinks)
    .where(
      and(
        eq(taskLinks.id, linkId),
        or(eq(taskLinks.sourceTaskId, taskId), eq(taskLinks.targetTaskId, taskId)),
      ),
    )
    .returning({ id: taskLinks.id })
  if (removed.length === 0) throw notFound('Link')
}
