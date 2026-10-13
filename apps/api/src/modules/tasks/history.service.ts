import { taskChangeSchema, type TaskChange, type TaskEvent } from '@chilladesk/shared'
import { asc, eq, inArray } from 'drizzle-orm'
import type { Db, Executor } from '../../db/client'
import type { tasks } from '../../db/schema'
import { labels, statuses, taskEvents, taskLabels, users } from '../../db/schema'
import { getProject } from '../projects/service'
import { assertTaskInProject } from './service'

type TaskRow = typeof tasks.$inferSelect

/** The fields of a task whose changes are worth a line in its history. */
export type TrackedFields = Pick<
  TaskRow,
  'title' | 'description' | 'statusId' | 'priority' | 'assigneeId' | 'dueDate'
>

/** Names of the labels on a task, for comparing before and after. */
export async function labelNamesOf(db: Executor, taskId: string): Promise<string[]> {
  const rows = await db
    .select({ name: labels.name })
    .from(taskLabels)
    .innerJoin(labels, eq(labels.id, taskLabels.labelId))
    .where(eq(taskLabels.taskId, taskId))
    .orderBy(asc(labels.name))
  return rows.map((row) => row.name)
}

async function namesOf(
  db: Executor,
  table: typeof users | typeof statuses,
  ids: (string | null)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
  if (wanted.length === 0) return new Map()
  const rows = await db
    .select({ id: table.id, name: table.name })
    .from(table)
    .where(inArray(table.id, wanted))
  return new Map(rows.map((row) => [row.id, row.name]))
}

export interface TaskSnapshot {
  fields: TrackedFields
  /** Omitted when the labels were not touched. */
  labels?: string[]
}

/** What differs between two states of a task, as history entries. */
export async function diffTask(
  db: Executor,
  before: TaskSnapshot,
  after: TaskSnapshot,
): Promise<TaskChange[]> {
  const [from, to] = [before.fields, after.fields]
  const people = await namesOf(db, users, [from.assigneeId, to.assigneeId])
  const columns =
    from.statusId === to.statusId
      ? new Map<string, string>()
      : await namesOf(db, statuses, [from.statusId, to.statusId])
  const person = (id: string | null) => (id === null ? null : (people.get(id) ?? null))
  const [oldLabels, newLabels] = [before.labels ?? [], after.labels ?? before.labels ?? []]
  const added = newLabels.filter((name) => !oldLabels.includes(name))
  const removed = oldLabels.filter((name) => !newLabels.includes(name))

  const changes: (TaskChange | false)[] = [
    from.title !== to.title && { field: 'title', from: from.title, to: to.title },
    from.description !== to.description && { field: 'description' },
    from.statusId !== to.statusId && {
      field: 'status',
      from: columns.get(from.statusId) ?? '',
      to: columns.get(to.statusId) ?? '',
    },
    from.priority !== to.priority && { field: 'priority', from: from.priority, to: to.priority },
    from.assigneeId !== to.assigneeId && {
      field: 'assignee',
      from: person(from.assigneeId),
      to: person(to.assigneeId),
    },
    from.dueDate !== to.dueDate && { field: 'dueDate', from: from.dueDate, to: to.dueDate },
    (added.length > 0 || removed.length > 0) && { field: 'labels', added, removed },
  ]
  return changes.filter((change): change is TaskChange => change !== false)
}

/** Adds entries to the history of a task; part of the transaction that made the change. */
export async function recordTaskChanges(
  db: Executor,
  taskId: string,
  actorId: string,
  changes: TaskChange[],
): Promise<void> {
  if (changes.length === 0) return
  await db.insert(taskEvents).values(changes.map((change) => ({ taskId, actorId, change })))
}

/** What happened to a task, oldest first. */
export async function listTaskHistory(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
): Promise<TaskEvent[]> {
  await getProject(db, userId, projectId)
  await assertTaskInProject(db, projectId, taskId)
  const rows = await db
    .select({
      event: taskEvents,
      actor: { id: users.id, name: users.name, email: users.email },
    })
    .from(taskEvents)
    .leftJoin(users, eq(users.id, taskEvents.actorId))
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(asc(taskEvents.createdAt), asc(taskEvents.seq))

  return rows.flatMap(({ event, actor }) => {
    // Written by this module, but read back defensively: an entry of a kind a newer
    // version added (after a downgrade) is left out rather than breaking the whole list.
    const change = taskChangeSchema.safeParse(event.change)
    if (!change.success) return []
    return [
      {
        id: event.id,
        actor,
        change: change.data,
        createdAt: event.createdAt.toISOString(),
      },
    ]
  })
}
