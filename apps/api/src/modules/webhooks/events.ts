import type { TaskChange, TaskPriority, WebhookEvent } from '@chilladesk/shared'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Executor } from '../../db/client'
import { projects, statuses, tasks, users, webhookDeliveries, webhooks } from '../../db/schema'

/** The event as it is kept until it is sent; `json` webhooks get it as it is. */
export interface WebhookPayload {
  event: WebhookEvent | 'ping'
  occurredAt: string
  project: { id: string; key: string; name: string }
  actor: { id: string; name: string } | null
  task?: {
    id: string
    key: string
    number: number
    title: string
    status: string
    priority: TaskPriority
    assignee: { id: string; name: string } | null
  }
  /** What a `task.updated` changed, as in the task's history. */
  changes?: TaskChange[]
  comment?: { id: string; body: string }
  page?: { id: string; title: string }
}

/**
 * What an event is about: a task (with what changed, or the comment added to it), or a page.
 * A deleted task is described while it still exists, in the transaction that deletes it.
 */
export type WebhookSubject =
  | { taskId: string; changes?: TaskChange[]; comment?: { id: string; body: string } }
  | { page: { id: string; title: string } }

/** Deliveries one webhook may have waiting; events past that are not kept for it. */
export const MAX_WAITING = 500

/** Longest comment a delivery carries; the rest is in the app. */
const COMMENT_MAX = 2000

async function describeTask(db: Executor, taskId: string): Promise<WebhookPayload['task']> {
  const assignee = alias(users, 'assignee')
  const [row] = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      key: projects.key,
      status: statuses.name,
      priority: tasks.priority,
      assigneeId: assignee.id,
      assigneeName: assignee.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .where(eq(tasks.id, taskId))
  if (!row) return undefined
  const { assigneeId, assigneeName, key, ...task } = row
  return {
    ...task,
    key: `${key}-${task.number}`,
    assignee: assigneeId && assigneeName ? { id: assigneeId, name: assigneeName } : null,
  }
}

/** Puts one delivery of `payload` into the outbox for each of these webhooks. */
export async function queueDeliveries(
  db: Executor,
  webhookIds: string[],
  payload: WebhookPayload,
): Promise<(typeof webhookDeliveries.$inferSelect)[]> {
  if (webhookIds.length === 0) return []
  return db
    .insert(webhookDeliveries)
    .values(webhookIds.map((webhookId) => ({ webhookId, event: payload.event, payload })))
    .returning()
}

/**
 * Tells the project's webhooks that want to hear about `event`. Called in the transaction of
 * the change itself, so a change that is rolled back is never announced, and one that is
 * committed always is, even if the server stops before sending it.
 */
export async function queueWebhookEvent(
  db: Executor,
  projectId: string,
  actorId: string,
  event: WebhookEvent,
  subject: WebhookSubject,
): Promise<void> {
  const subscribed = await db
    .select({ id: webhooks.id })
    .from(webhooks)
    .where(
      and(
        eq(webhooks.projectId, projectId),
        eq(webhooks.active, true),
        sql`${event} = any(${webhooks.events})`,
      ),
    )
  if (subscribed.length === 0) return
  const backlog = await db
    .select({ webhookId: webhookDeliveries.webhookId, waiting: count() })
    .from(webhookDeliveries)
    .where(
      and(
        inArray(
          webhookDeliveries.webhookId,
          subscribed.map((webhook) => webhook.id),
        ),
        eq(webhookDeliveries.status, 'pending'),
      ),
    )
    .groupBy(webhookDeliveries.webhookId)
  const waiting = new Map(backlog.map((row) => [row.webhookId, row.waiting]))
  // A receiver that is down collects a backlog; past this much, new events are not kept
  // for it, so one webhook cannot fill the database.
  const listening = subscribed.filter((webhook) => (waiting.get(webhook.id) ?? 0) < MAX_WAITING)
  if (listening.length === 0) return

  const [project] = await db
    .select({ id: projects.id, key: projects.key, name: projects.name })
    .from(projects)
    .where(eq(projects.id, projectId))
  if (!project) return
  const [actor] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, actorId))

  const about: Partial<WebhookPayload> =
    'taskId' in subject
      ? {
          task: await describeTask(db, subject.taskId),
          ...(subject.changes ? { changes: subject.changes } : {}),
          ...(subject.comment
            ? { comment: { ...subject.comment, body: subject.comment.body.slice(0, COMMENT_MAX) } }
            : {}),
        }
      : { page: subject.page }
  const payload: WebhookPayload = {
    event,
    occurredAt: new Date().toISOString(),
    project,
    actor: actor ?? null,
    ...about,
  }
  await queueDeliveries(
    db,
    listening.map((webhook) => webhook.id),
    payload,
  )
}
