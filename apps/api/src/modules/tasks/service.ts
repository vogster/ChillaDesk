import type {
  CreateTaskRequest,
  Label,
  MoveTaskRequest,
  Task,
  TaskInContext,
  TaskList,
  TaskListQuery,
  UpdateTaskRequest,
  UserSummary,
} from '@chilladesk/shared'
import { and, asc, count, eq, ilike, isNull, lt, max, ne, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Db, Executor, Tx } from '../../db/client'
import { containsPattern } from '../../db/like'
import { projectMembers, projects, statuses, taskLabels, tasks, users } from '../../db/schema'
import { invalid, notFound } from '../../errors'
import { loadLabelsOfTasks, setTaskLabels } from '../labels/service'
import { notifyAssignment, notifyMentions } from '../notifications/service'
import { getProject } from '../projects/service'
import { diffTask, labelNamesOf, recordTaskChanges } from './history.service'
import { toStatus } from './statuses.service'

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

function toTask({ task, projectKey, assignee, reporter }: TaskRow, labels: Label[]): Task {
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
    labels,
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

/** Turns query rows into tasks, fetching the labels of all of them in one go. */
async function toTasks(db: Executor, rows: TaskRow[]): Promise<Task[]> {
  const labels = await loadLabelsOfTasks(
    db,
    rows.map((row) => row.task.id),
  )
  return rows.map((row) => toTask(row, labels.get(row.task.id) ?? []))
}

async function toSingleTask(db: Executor, row: TaskRow | undefined): Promise<Task> {
  const [task] = row ? await toTasks(db, [row]) : []
  if (!task) throw notFound('Task')
  return task
}

const inProject = (projectId: string, taskId: string) =>
  and(eq(tasks.projectId, projectId), eq(tasks.id, taskId))

/** Loads a task without checking access; the caller has already authorised the project. */
async function loadTask(db: Executor, projectId: string, taskId: string): Promise<Task> {
  const [row] = await selectTasks(db).where(inProject(projectId, taskId))
  return toSingleTask(db, row)
}

interface CrossProjectQuery {
  where: SQL | undefined
  orderBy: SQL[]
  limit: number
}

/**
 * Tasks from every project the user is a member of, each with its project and status.
 * The membership join is the access check: nothing outside the user's projects can match.
 */
export async function findTasksOfUser(
  db: Db,
  userId: string,
  { where, orderBy, limit }: CrossProjectQuery,
): Promise<TaskInContext[]> {
  const rows = await db
    .select({
      ...taskColumns,
      project: { id: projects.id, key: projects.key, name: projects.name },
      status: statuses,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .innerJoin(
      projectMembers,
      and(eq(projectMembers.projectId, tasks.projectId), eq(projectMembers.userId, userId)),
    )
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .leftJoin(reporter, eq(reporter.id, tasks.reporterId))
    .where(where)
    .orderBy(...orderBy)
    .limit(limit)

  const found = await toTasks(db, rows)
  return rows.flatMap(({ project, status }, index) => {
    const task = found[index]
    return task ? [{ ...task, project, status: toStatus(status) }] : []
  })
}

function filters(projectId: string, query: TaskListQuery): SQL | undefined {
  const pattern = query.q ? containsPattern(query.q) : undefined
  return and(
    eq(tasks.projectId, projectId),
    query.statusId ? eq(tasks.statusId, query.statusId) : undefined,
    query.priority ? eq(tasks.priority, query.priority) : undefined,
    query.assigneeId === 'none'
      ? isNull(tasks.assigneeId)
      : query.assigneeId
        ? eq(tasks.assigneeId, query.assigneeId)
        : undefined,
    query.labelId
      ? sql`exists (select 1 from ${taskLabels} where ${taskLabels.taskId} = ${tasks.id} and ${taskLabels.labelId} = ${query.labelId})`
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
  return { items: await toTasks(db, rows), total: counted?.total ?? 0 }
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
  return toSingleTask(db, row)
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
    await setTaskLabels(tx, projectId, created.id, input.labelIds)
    await recordTaskChanges(tx, created.id, userId, [{ field: 'created' }])

    const subject = { projectId, actorId: userId, taskId: created.id }
    await notifyAssignment(tx, subject, input.assigneeId, input.title)
    // The assignee has just been told about this task; a mention in it adds nothing.
    await notifyMentions(
      tx,
      subject,
      input.description,
      '',
      input.assigneeId ? [input.assigneeId] : [],
    )
    return loadTask(tx, projectId, created.id)
  })
}

export async function updateTask(
  db: Db,
  userId: string,
  projectId: string,
  taskId: string,
  { labelIds, ...fields }: UpdateTaskRequest,
): Promise<Task> {
  await getProject(db, userId, projectId, 'member')
  return db.transaction(async (tx) => {
    if (fields.assigneeId !== undefined) await assertAssignable(tx, projectId, fields.assigneeId)

    // The previous values decide who hears about the change: only a new assignee and only
    // people not already mentioned in the description.
    const [before] = await tx.select().from(tasks).where(inProject(projectId, taskId)).for('update')
    if (!before) throw notFound('Task')
    const labelsBefore = labelIds === undefined ? undefined : await labelNamesOf(tx, taskId)

    const [updated] = await tx
      .update(tasks)
      .set({ ...fields, updatedAt: new Date() })
      .where(inProject(projectId, taskId))
      .returning()
    if (!updated) throw notFound('Task')
    if (labelIds !== undefined) await setTaskLabels(tx, projectId, taskId, labelIds)

    const changes = await diffTask(
      tx,
      { fields: before, ...(labelsBefore ? { labels: labelsBefore } : {}) },
      { fields: updated, ...(labelsBefore ? { labels: await labelNamesOf(tx, taskId) } : {}) },
    )
    await recordTaskChanges(tx, taskId, userId, changes)

    const subject = { projectId, actorId: userId, taskId }
    const newAssignee =
      fields.assigneeId && fields.assigneeId !== before.assigneeId ? fields.assigneeId : null
    await notifyAssignment(tx, subject, newAssignee, updated.title)
    if (fields.description !== undefined) {
      await notifyMentions(
        tx,
        subject,
        fields.description,
        before.description,
        newAssignee ? [newAssignee] : [],
      )
    }
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
    const [before] = await tx.select().from(tasks).where(inProject(projectId, taskId)).for('update')
    if (!before) throw notFound('Task')
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
    // Only a change of column is history; a new place in the same column is not.
    const changes = await diffTask(tx, { fields: before }, { fields: { ...before, statusId } })
    await recordTaskChanges(tx, taskId, userId, changes)
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
