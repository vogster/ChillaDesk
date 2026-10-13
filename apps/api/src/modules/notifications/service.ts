import {
  mentionedEmails,
  type MarkNotificationsReadRequest,
  type Notification,
  type NotificationList,
  type NotificationListQuery,
  type NotificationType,
} from '@chilladesk/shared'
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Db, Executor } from '../../db/client'
import { notifications, projectMembers, projects, tasks, users, wikiPages } from '../../db/schema'

const EXCERPT_LENGTH = 200

/** The start of a text on one line, for showing what a notification is about. */
export function excerptOf(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > EXCERPT_LENGTH ? `${flat.slice(0, EXCERPT_LENGTH - 1)}…` : flat
}

/** What every notification about one event has in common. */
interface NotificationSubject {
  projectId: string
  /** The user who caused it; they are never notified about their own action. */
  actorId: string
  taskId?: string
  wikiPageId?: string
}

async function insertFor(
  db: Executor,
  type: NotificationType,
  subject: NotificationSubject,
  recipientIds: string[],
  text: string,
): Promise<void> {
  const recipients = [...new Set(recipientIds)].filter((userId) => userId !== subject.actorId)
  if (recipients.length === 0) return
  await db.insert(notifications).values(
    recipients.map((userId) => ({
      userId,
      type,
      actorId: subject.actorId,
      projectId: subject.projectId,
      taskId: subject.taskId ?? null,
      wikiPageId: subject.wikiPageId ?? null,
      excerpt: excerptOf(text),
    })),
  )
}

/** Of the given users, those who are (still) members of the project. */
async function membersAmong(db: Executor, projectId: string, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const rows = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), inArray(projectMembers.userId, userIds)))
  return rows.map((row) => row.userId)
}

/**
 * Notifies the project members newly mentioned in a text. `before` is the previous version
 * of the same text, so editing it does not notify the same people again.
 * Returns who was notified, so the caller does not tell them twice about the same event.
 */
export async function notifyMentions(
  db: Executor,
  subject: NotificationSubject,
  after: string,
  before = '',
  /** People this event already told something more specific. */
  alreadyNotified: string[] = [],
): Promise<Set<string>> {
  const alreadyMentioned = new Set(mentionedEmails(before))
  const emails = mentionedEmails(after).filter((email) => !alreadyMentioned.has(email))
  if (emails.length === 0) return new Set()

  // Only members can be mentioned: nobody outside the project learns anything about it.
  const rows = await db
    .select({ userId: users.id })
    .from(users)
    .innerJoin(
      projectMembers,
      and(eq(projectMembers.userId, users.id), eq(projectMembers.projectId, subject.projectId)),
    )
    .where(inArray(users.email, emails))
  const mentioned = rows
    .map((row) => row.userId)
    .filter((userId) => userId !== subject.actorId && !alreadyNotified.includes(userId))
  await insertFor(db, 'mentioned', subject, mentioned, after)
  return new Set(mentioned)
}

export async function notifyAssignment(
  db: Executor,
  subject: NotificationSubject & { taskId: string },
  assigneeId: string | null,
  title: string,
): Promise<void> {
  if (assigneeId) await insertFor(db, 'task_assigned', subject, [assigneeId], title)
}

/** Tells the people responsible for a task about a new comment on it. */
export async function notifyComment(
  db: Executor,
  subject: NotificationSubject & { taskId: string },
  body: string,
  alreadyNotified: Set<string>,
): Promise<void> {
  const [task] = await db
    .select({ assigneeId: tasks.assigneeId, reporterId: tasks.reporterId })
    .from(tasks)
    .where(eq(tasks.id, subject.taskId))
  const involved = [task?.assigneeId, task?.reporterId].filter(
    (userId): userId is string => typeof userId === 'string' && !alreadyNotified.has(userId),
  )
  // Someone who left the project keeps their name on the task but hears no more about it.
  await insertFor(
    db,
    'task_commented',
    subject,
    await membersAmong(db, subject.projectId, involved),
    body,
  )
}

const actor = { id: users.id, name: users.name, email: users.email }

const notificationColumns = {
  notification: notifications,
  actor,
  project: { id: projects.id, key: projects.key, name: projects.name },
  task: { id: tasks.id, number: tasks.number, title: tasks.title },
  page: { id: wikiPages.id, title: wikiPages.title },
}

export async function listNotifications(
  db: Db,
  userId: string,
  query: NotificationListQuery,
): Promise<NotificationList> {
  const mine = eq(notifications.userId, userId)
  // Leaving a project removes its notifications; the join makes sure of it even so, since
  // they carry the names of its tasks and pages.
  const stillMember = and(
    eq(projectMembers.projectId, notifications.projectId),
    eq(projectMembers.userId, notifications.userId),
  )
  const unread = and(mine, isNull(notifications.readAt))
  const [rows, [counted]] = await Promise.all([
    db
      .select(notificationColumns)
      .from(notifications)
      .innerJoin(projects, eq(projects.id, notifications.projectId))
      .innerJoin(projectMembers, stillMember)
      .leftJoin(users, eq(users.id, notifications.actorId))
      .leftJoin(tasks, eq(tasks.id, notifications.taskId))
      .leftJoin(wikiPages, eq(wikiPages.id, notifications.wikiPageId))
      .where(query.unread ? unread : mine)
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.limit),
    db
      .select({ total: count() })
      .from(notifications)
      .innerJoin(projectMembers, stillMember)
      .where(unread),
  ])

  const items: Notification[] = rows.map(({ notification, project, task, page, ...row }) => ({
    id: notification.id,
    type: notification.type,
    actor: row.actor,
    project,
    task: task ? { id: task.id, key: `${project.key}-${task.number}`, title: task.title } : null,
    page,
    excerpt: notification.excerpt,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  }))
  return { items, unreadCount: counted?.total ?? 0 }
}

/** Marks the user's own notifications as read: the given ones, or all of them. */
export async function markNotificationsRead(
  db: Db,
  userId: string,
  { ids }: MarkNotificationsReadRequest,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: now })
    .where(
      and(
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        ids ? inArray(notifications.id, ids) : undefined,
      ),
    )
}
