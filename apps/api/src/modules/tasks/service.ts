import type {
  CreateTaskRequest,
  MoveTaskRequest,
  Task,
  TaskList,
  TaskListQuery,
  UpdateTaskRequest,
  UserSummary,
} from '@chillawiki/shared'
import { and, asc, count, eq, ilike, isNull, lt, max, ne, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Db, Executor, Tx } from '../../db/client'
import { projectMembers, projects, statuses, tasks, users } from '../../db/schema'
import { invalid, notFound } from '../../errors'
import { getProject } from '../projects/service'

const assignee = alias(users, 'assignee')
const reporter = alias(users, 'reporter')

const summaryOf = (user: typeof assignee | typeof reporter) => ({
  id: user.id,
  name: user.name,
  email: user.email,
})

const taskColumns = {
  task: tasks,
  projectKey: projects.key,
  assignee: summaryOf(assignee),
  reporter: summaryOf(reporter),
}

// A left join yields the joined columns as nulls when there is no such user.
type JoinedUser = { id: string | null; name: string | null; email: string | null } | null

function toSummary(user: JoinedUser): UserSummary | null {
  return user?.id && user.name !== null && user.email !== null
    ? { id: user.id, name: user.name, email: user.email }
    : null
}

interface TaskRow {
  task: typeof tasks.$inferSelect
  projectKey: string
  assignee: JoinedUser
  reporter: JoinedUser
}

function toTask({ task, projectKey, assignee, reporter }: TaskRow): Task {
  return {
    id: task.id,
    projectId: task.projectId,
    number: task.number,
    key: `${projectKey}-${task.number}`,
    title: task.title,
    description: task.description,
    statusId: task.statusId,
    priority: task.priority,
    assignee: toSummary(assignee),
    reporter: toSummary(reporter),
    dueDate: task.dueDate,
    position: task.position,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  }
}

function selectTasks(db: Executor) {
  return db
    .select(taskColumns)
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .leftJoin(reporter, eq(reporter.id, tasks.reporterId))
}

const inProject = (projectId: string, taskId: string) =>
  and(eq(tasks.projectId, projectId), eq(tasks.id, taskId))

/** Loads a task without checking access; the caller has already authorised the project. */
async function loadTask(db: Executor, projectId: string, taskId: string): Promise<Task> {
  const [row] = await selectTasks(db).where(inProject(projectId, taskId))
  if (!row) throw notFound('Task')
  return toTask(row)
}

// `%`, `_` and `\` are LIKE wildcards; a search for "100%" must match that text literally.
const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&')

function filters(projectId: string, query: TaskListQuery): SQL | undefined {
  const pattern = query.q ? `%${escapeLike(query.q)}%` : undefined
  return and(
    eq(tasks.projectId, projectId),
    query.statusId ? eq(tasks.statusId, query.statusId) : undefined,
    query.priority ? eq(tasks.priority, query.priority) : undefined,
    query.assigneeId === 'none'
      ? isNull(tasks.assigneeId)
      : query.assigneeId
        ? eq(tasks.assigneeId, query.assigneeId)
        : undefined,
    pattern ? or(ilike(tasks.title, pattern), ilike(tasks.description, pattern)) : undefined,
  )
}

export async function listTasks(
  db: Db,
  userId: string,
  projectId: string,
  query: TaskListQuery,
): Promise<TaskList> {
  await getProject(db, userId, projectId)
  const where = filters(projectId, query)
  const [rows, [counted]] = await Promise.all([
    selectTasks(db)
      .where(where)
      // The ids break ties so that paging never repeats or skips a row.
      .orderBy(asc(statuses.position), asc(statuses.id), asc(tasks.position), asc(tasks.number))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ total: count() }).from(tasks).where(where),
  ])
  return { items: rows.map(toTask), total: counted?.total ?? 0 }
}

/** Resolves the number in a task key such as `CHL-12`. */
export async function getTaskByNumber(
  db: Db,
  userId: string,
  projectId: string,
  number: number,
): Promise<Task> {
  await getProject(db, userId, projectId)
  const [row] = await selectTasks(db).where(
    and(eq(tasks.projectId, projectId), eq(tasks.number, number)),
  )
  if (!row) throw notFound('Task')
  return toTask(row)
}

export async function getTask(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
): Promise<Task> {
  await getProject(db, userId, projectId)
  return loadTask(db, projectId, taskId)
}

/**
 * Confirms the status belongs to the project and locks its row until the transaction ends.
 * Everything that reads a column's positions and then writes one holds this lock, so two
 * changes to the same column run one after the other; it also blocks deleting the status.
 */
async function lockStatus(tx: Tx, projectId: string, statusId: string): Promise<void> {
  const [status] = await tx
    .select({ id: statuses.id })
    .from(statuses)
    .where(and(eq(statuses.projectId, projectId), eq(statuses.id, statusId)))
    .for('update')
  if (!status) throw invalid('statusId does not belong to this project')
}

/** Holds the membership row so the member cannot be removed before the task is saved. */
async function assertAssignable(tx: Tx, projectId: string, assigneeId: string | null) {
  if (assigneeId === null) return
  const [membership] = await tx
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, assigneeId)))
    .for('share')
  if (!membership) throw invalid('assigneeId must be a member of this project')
}

async function firstStatusId(db: Executor, projectId: string): Promise<string> {
  const [first] = await db
    .select({ id: statuses.id })
    .from(statuses)
    .where(eq(statuses.projectId, projectId))
    .orderBy(asc(statuses.position), asc(statuses.id))
    .limit(1)
  if (!first) throw new Error(`Project ${projectId} has no statuses`)
  return first.id
}

const POSITION_STEP = 1024
// Below this gap two neighbours are too close to fit another task between them reliably.
const MIN_GAP = 1e-6

async function endOfColumn(tx: Tx, statusId: string, excludeTaskId?: string): Promise<number> {
  const [last] = await tx
    .select({ position: max(tasks.position) })
    .from(tasks)
    .where(
      and(eq(tasks.statusId, statusId), excludeTaskId ? ne(tasks.id, excludeTaskId) : undefined),
    )
  return (last?.position ?? 0) + POSITION_STEP
}

export async function createTask(
  db: Db,
  userId: string,
  projectId: string,
  input: CreateTaskRequest,
): Promise<Task> {
  await getProject(db, userId, projectId, 'member')
  return db.transaction(async (tx) => {
    // The row lock taken by this update serialises concurrent creators, so numbers are unique.
    // It comes first: status changes lock the project before a status, and so must this.
    const [counter] = await tx
      .update(projects)
      .set({ taskCounter: sql`${projects.taskCounter} + 1` })
      .where(eq(projects.id, projectId))
      .returning({ number: projects.taskCounter })
    if (!counter) throw notFound('Project')

    const statusId = input.statusId ?? (await firstStatusId(tx, projectId))
    await lockStatus(tx, projectId, statusId)
    await assertAssignable(tx, projectId, input.assigneeId)

    const [created] = await tx
      .insert(tasks)
      .values({
        projectId,
        number: counter.number,
        title: input.title,
        description: input.description,
        statusId,
        priority: input.priority,
        assigneeId: input.assigneeId,
        reporterId: userId,
        dueDate: input.dueDate,
        position: await endOfColumn(tx, statusId),
      })
      .returning({ id: tasks.id })
    if (!created) throw new Error('Insert returned no task row')
    return loadTask(tx, projectId, created.id)
  })
}

export async function updateTask(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
  patch: UpdateTaskRequest,
): Promise<Task> {
  await getProject(db, userId, projectId, 'member')
  return db.transaction(async (tx) => {
    if (patch.assigneeId !== undefined) await assertAssignable(tx, projectId, patch.assigneeId)

    const [updated] = await tx
      .update(tasks)
      .set({ ...patch, updatedAt: new Date() })
      .where(inProject(projectId, taskId))
      .returning({ id: tasks.id })
    if (!updated) throw notFound('Task')
    return loadTask(tx, projectId, taskId)
  })
}

/** Spreads a column's tasks evenly again: used-up gaps and equal positions both end up apart. */
async function rebalanceColumn(tx: Tx, statusId: string): Promise<void> {
  await tx.execute(sql`
    update "tasks" set "position" = ranked.rank * ${POSITION_STEP}
    from (
      select "id", row_number() over (order by "position", "number") as rank
      from "tasks" where "status_id" = ${statusId}
    ) as ranked
    where "tasks"."id" = ranked."id"
  `)
}

/**
 * Position that sorts the moved task right before `beforeTaskId`.
 * Returns null when the column has to be rebalanced first: the gap is used up, or another
 * task shares the target's position and a midpoint could land on the wrong side of it.
 */
async function positionBefore(
  tx: Tx,
  statusId: string,
  taskId: string,
  beforeTaskId: string,
): Promise<number | null> {
  const [next] = await tx
    .select({ position: tasks.position })
    .from(tasks)
    .where(and(eq(tasks.statusId, statusId), eq(tasks.id, beforeTaskId)))
  if (!next) throw invalid('beforeTaskId must be a task in the target status')

  const others = and(eq(tasks.statusId, statusId), ne(tasks.id, taskId), ne(tasks.id, beforeTaskId))
  const [tied] = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(others, eq(tasks.position, next.position)))
    .limit(1)
  if (tied) return null

  const [previous] = await tx
    .select({ position: max(tasks.position) })
    .from(tasks)
    .where(and(others, lt(tasks.position, next.position)))
  if (previous?.position == null) return next.position - POSITION_STEP
  return next.position - previous.position < MIN_GAP
    ? null
    : (previous.position + next.position) / 2
}

export async function moveTask(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
  { statusId, beforeTaskId }: MoveTaskRequest,
): Promise<Task> {
  await getProject(db, userId, projectId, 'member')
  if (beforeTaskId === taskId) throw invalid('A task cannot be placed before itself')

  return db.transaction(async (tx) => {
    await loadTask(tx, projectId, taskId)
    await lockStatus(tx, projectId, statusId)

    let position: number | null
    if (beforeTaskId === null) {
      position = await endOfColumn(tx, statusId, taskId)
    } else {
      position = await positionBefore(tx, statusId, taskId, beforeTaskId)
      if (position === null) {
        await rebalanceColumn(tx, statusId)
        position = await positionBefore(tx, statusId, taskId, beforeTaskId)
      }
    }
    if (position === null) throw new Error('No room for the task after rebalancing the column')

    await tx
      .update(tasks)
      .set({ statusId, position, updatedAt: new Date() })
      .where(eq(tasks.id, taskId))
    return loadTask(tx, projectId, taskId)
  })
}

export async function deleteTask(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
): Promise<void> {
  await getProject(db, userId, projectId, 'member')
  const removed = await db
    .delete(tasks)
    .where(inProject(projectId, taskId))
    .returning({ id: tasks.id })
  if (removed.length === 0) throw notFound('Task')
}

/** For modules that hang off a task (comments): confirms it exists in the project. */
export async function assertTaskInProject(
  db: Executor,
  projectId: string,
  taskId: string,
): Promise<void> {
  const [task] = await db.select({ id: tasks.id }).from(tasks).where(inProject(projectId, taskId))
  if (!task) throw notFound('Task')
}
