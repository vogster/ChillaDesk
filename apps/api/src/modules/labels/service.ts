import type { CreateLabelRequest, Label, UpdateLabelRequest } from '@chilladesk/shared'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db, Executor, Tx } from '../../db/client'
import { labels, taskLabels } from '../../db/schema'
import { conflict, invalid, isUniqueViolation, notFound } from '../../errors'
import { getProject } from '../projects/service'

const labelColumns = { id: labels.id, name: labels.name, color: labels.color }
const byName = sql`lower(${labels.name})`

const nameTaken = (name: string) => conflict(`A label named "${name}" already exists`)

export async function listLabels(db: Db, userId: string, projectId: string): Promise<Label[]> {
  await getProject(db, userId, projectId)
  return db.select(labelColumns).from(labels).where(eq(labels.projectId, projectId)).orderBy(byName)
}

export async function createLabel(
  db: Db,
  userId: string,
  projectId: string,
  input: CreateLabelRequest,
): Promise<Label> {
  await getProject(db, userId, projectId, 'member')
  try {
    const [created] = await db
      .insert(labels)
      .values({ ...input, projectId })
      .returning(labelColumns)
    if (!created) throw new Error('Insert returned no label row')
    return created
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken(input.name)
    throw error
  }
}

const inProject = (projectId: string, labelId: string) =>
  and(eq(labels.projectId, projectId), eq(labels.id, labelId))

export async function updateLabel(
  db: Db,
  userId: string,
  projectId: string,
  labelId: string,
  patch: UpdateLabelRequest,
): Promise<Label> {
  await getProject(db, userId, projectId, 'member')
  try {
    const [updated] = await db
      .update(labels)
      .set(patch)
      .where(inProject(projectId, labelId))
      .returning(labelColumns)
    if (!updated) throw notFound('Label')
    return updated
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken(patch.name ?? '')
    throw error
  }
}

/** Deleting a label takes it off every task that had it. */
export async function deleteLabel(
  db: Db,
  userId: string,
  projectId: string,
  labelId: string,
): Promise<void> {
  await getProject(db, userId, projectId, 'member')
  const removed = await db
    .delete(labels)
    .where(inProject(projectId, labelId))
    .returning({ id: labels.id })
  if (removed.length === 0) throw notFound('Label')
}

/** Labels of each given task, sorted by name. Tasks without labels are absent from the map. */
export async function loadLabelsOfTasks(
  db: Executor,
  taskIds: string[],
): Promise<Map<string, Label[]>> {
  if (taskIds.length === 0) return new Map()
  const rows = await db
    .select({ taskId: taskLabels.taskId, ...labelColumns })
    .from(taskLabels)
    .innerJoin(labels, eq(labels.id, taskLabels.labelId))
    .where(inArray(taskLabels.taskId, taskIds))
    .orderBy(byName)

  const byTask = new Map<string, Label[]>()
  for (const { taskId, ...label } of rows) {
    byTask.set(taskId, [...(byTask.get(taskId) ?? []), label])
  }
  return byTask
}

/** Replaces the labels of a task. Every id must be a label of the task's project. */
export async function setTaskLabels(
  tx: Tx,
  projectId: string,
  taskId: string,
  labelIds: string[],
): Promise<void> {
  if (labelIds.length > 0) {
    const known = await tx
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.projectId, projectId), inArray(labels.id, labelIds)))
    if (known.length !== labelIds.length) throw invalid('labelIds must be labels of this project')
  }
  await tx.delete(taskLabels).where(eq(taskLabels.taskId, taskId))
  if (labelIds.length > 0) {
    await tx.insert(taskLabels).values(labelIds.map((labelId) => ({ taskId, labelId })))
  }
}
