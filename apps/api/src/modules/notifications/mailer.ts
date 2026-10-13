import type { NotificationType } from '@chilladesk/shared'
import {
  aliasedTable,
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm'
import { createTransport } from 'nodemailer'
import type { Db } from '../../db/client'
import { notifications, projectMembers, projects, tasks, users, wikiPages } from '../../db/schema'

export interface MailMessage {
  to: string
  subject: string
  text: string
}

export type SendMail = (message: MailMessage) => Promise<void>

/** A stuck SMTP server must not hold up the batch, or the shutdown of the API. */
const SMTP_TIMEOUT_MS = 15_000

/** A sender backed by an SMTP server, given as an `smtp://user:pass@host:port` URL. */
export function createMailSender(
  transport: string | { jsonTransport: true },
  from: string,
  onSent?: (info: unknown) => void,
): SendMail {
  const mailer = createTransport(
    typeof transport === 'string'
      ? {
          url: transport,
          connectionTimeout: SMTP_TIMEOUT_MS,
          greetingTimeout: SMTP_TIMEOUT_MS,
          socketTimeout: SMTP_TIMEOUT_MS,
        }
      : transport,
  )
  return async (message) => {
    const info: unknown = await mailer.sendMail({ from, ...message })
    onSent?.(info)
  }
}

/** Notifications older than this are not worth an email any more. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000
const BATCH_SIZE = 20
/** After this many failed attempts the email is given up; the notification stays in the app. */
export const MAX_ATTEMPTS = 5
/**
 * Emails one person gets per hour. Whoever can mention or assign someone can make the
 * server write to them, so this bounds how much; the rest is still shown in the app.
 */
export const MAX_EMAILS_PER_HOUR = 30
const HOUR_MS = 60 * 60 * 1000

const actors = aliasedTable(users, 'actors')

interface PendingEmail {
  id: string
  userId: string
  type: NotificationType
  excerpt: string
  readAt: Date | null
  createdAt: Date
  attempts: number
  to: string
  wantsEmail: boolean
  /** Null when the recipient has left the project since. */
  memberId: string | null
  actorName: string | null
  project: { id: string; key: string; name: string }
  task: { number: number; title: string } | null
  page: { id: string; title: string } | null
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

const ACTIONS: Record<NotificationType, string> = {
  task_assigned: 'assigned you a task',
  task_commented: 'commented on a task',
  mentioned: 'mentioned you',
}

function renderEmail(pending: PendingEmail, publicUrl: string): MailMessage {
  const { project, task, page } = pending
  const who = oneLine(pending.actorName ?? 'Someone')
  const taskKey = task ? `${project.key}-${task.number}` : null
  const base = `${publicUrl.replace(/\/+$/, '')}/projects/${project.id}`

  const where = page
    ? `on the wiki page “${page.title}”`
    : taskKey && pending.type === 'mentioned'
      ? `in ${taskKey} ${task?.title ?? ''}`.trimEnd()
      : `in ${project.name}`
  // An assignment's excerpt is the task title, which the heading line already carries.
  const heading = taskKey && pending.type !== 'mentioned' ? `${taskKey} ${task?.title ?? ''}` : null
  const quote = pending.type === 'task_assigned' ? null : pending.excerpt
  const link = page ? `${base}/wiki/${page.id}` : task ? `${base}/tasks/${task.number}` : base

  const blocks = [`${who} ${ACTIONS[pending.type]} ${where}:`, heading, quote, link]
  return {
    to: pending.to,
    subject: oneLine(`[${taskKey ?? project.key}] ${who} ${ACTIONS[pending.type]}`),
    text: blocks.filter((block): block is string => Boolean(block)).join('\n\n'),
  }
}

/**
 * Takes a batch out of the outbox by counting an attempt and pushing the next one into the
 * future: 2 minutes after the first, then 8, 32 and so on. That one write is both the lease
 * that keeps a second API instance away while the email is being sent, and the retry
 * schedule if sending fails or the process dies half-way. Rows that keep failing therefore
 * move out of the way of newer ones.
 */
async function claimBatch(db: Db, now: Date): Promise<PendingEmail[]> {
  const nowSql = sql`${now.toISOString()}::timestamptz`
  const next = db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(
        isNull(notifications.emailedAt),
        lt(notifications.emailAttempts, MAX_ATTEMPTS),
        or(isNull(notifications.emailNextAttemptAt), lte(notifications.emailNextAttemptAt, now)),
      ),
    )
    .orderBy(asc(notifications.createdAt))
    .limit(BATCH_SIZE)
    .for('update', { skipLocked: true })
  const claimed = await db
    .update(notifications)
    .set({
      emailNextAttemptAt: sql`${nowSql} + interval '2 minutes' * power(4, ${notifications.emailAttempts})`,
      emailAttempts: sql`${notifications.emailAttempts} + 1`,
    })
    .where(inArray(notifications.id, next))
    .returning({ id: notifications.id })
  if (claimed.length === 0) return []

  return db
    .select({
      id: notifications.id,
      userId: notifications.userId,
      type: notifications.type,
      excerpt: notifications.excerpt,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
      attempts: notifications.emailAttempts,
      to: users.email,
      wantsEmail: users.emailNotifications,
      memberId: projectMembers.userId,
      actorName: actors.name,
      project: { id: projects.id, key: projects.key, name: projects.name },
      task: { number: tasks.number, title: tasks.title },
      page: { id: wikiPages.id, title: wikiPages.title },
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .innerJoin(projects, eq(projects.id, notifications.projectId))
    .leftJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, notifications.projectId),
        eq(projectMembers.userId, notifications.userId),
      ),
    )
    .leftJoin(actors, eq(actors.id, notifications.actorId))
    .leftJoin(tasks, eq(tasks.id, notifications.taskId))
    .leftJoin(wikiPages, eq(wikiPages.id, notifications.wikiPageId))
    .where(
      inArray(
        notifications.id,
        claimed.map((row) => row.id),
      ),
    )
    .orderBy(asc(notifications.createdAt))
}

/** How many emails each of these people got within the last hour. */
async function recentlySent(db: Db, userIds: string[], now: Date): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map()
  const rows = await db
    .select({ userId: notifications.userId, sent: count() })
    .from(notifications)
    .where(
      and(
        inArray(notifications.userId, userIds),
        eq(notifications.emailSent, true),
        gt(notifications.emailedAt, new Date(now.getTime() - HOUR_MS)),
      ),
    )
    .groupBy(notifications.userId)
  return new Map(rows.map((row) => [row.userId, row.sent]))
}

const finish = (db: Db, id: string, now: Date, emailSent: boolean) =>
  db.update(notifications).set({ emailedAt: now, emailSent }).where(eq(notifications.id, id))

export interface DeliveryResult {
  sent: number
  failed: number
}

export interface DeliveryOptions {
  /** Where people open ChillaDesk, for the link in the email. */
  publicUrl: string
  now?: Date
  onError?: (error: unknown, notificationId: string) => void
  /** Checked before each email, so a shutdown does not wait for the whole batch. */
  shouldStop?: () => boolean
}

/** Emails one batch of notifications that have not been emailed yet. */
export async function deliverPending(
  db: Db,
  send: SendMail,
  { publicUrl, now = new Date(), onError, shouldStop }: DeliveryOptions,
): Promise<DeliveryResult> {
  const batch = await claimBatch(db, now)
  const sentTo = await recentlySent(db, [...new Set(batch.map((pending) => pending.userId))], now)
  const result = { sent: 0, failed: 0 }

  for (const pending of batch) {
    // What is left keeps its claim and is picked up again when that runs out.
    if (shouldStop?.()) break

    const sentThisHour = sentTo.get(pending.userId) ?? 0
    // No email for what was already seen in the app, would arrive a day late, is about a
    // project the recipient has left, goes to someone who turned emails off, or would be
    // one too many for this hour.
    const worthSending =
      !pending.readAt &&
      now.getTime() - pending.createdAt.getTime() < MAX_AGE_MS &&
      pending.memberId !== null &&
      pending.wantsEmail &&
      sentThisHour < MAX_EMAILS_PER_HOUR
    if (!worthSending) {
      await finish(db, pending.id, now, false)
      continue
    }

    try {
      await send(renderEmail(pending, publicUrl))
    } catch (error) {
      result.failed += 1
      onError?.(error, pending.id)
      if (pending.attempts >= MAX_ATTEMPTS) await finish(db, pending.id, now, false)
      continue
    }
    // Right away, not after the batch: a crash later on must not send this one twice.
    await finish(db, pending.id, now, true)
    sentTo.set(pending.userId, sentThisHour + 1)
    result.sent += 1
  }
  return result
}

interface WorkerLog {
  warn(details: object, message: string): void
  error(details: object, message: string): void
}

/** The parts of a mail error that say what went wrong without quoting the recipient. */
function describeMailError(error: unknown): { code?: unknown; responseCode?: unknown } {
  if (typeof error !== 'object' || error === null) return {}
  const { code, responseCode } = error as { code?: unknown; responseCode?: unknown }
  return { code, responseCode }
}

export interface MailWorkerOptions {
  db: Db
  send: SendMail
  publicUrl: string
  log: WorkerLog
  intervalMs?: number
}

/** Emails new notifications in the background. Returns a function that stops it. */
export function startMailWorker({
  db,
  send,
  publicUrl,
  log,
  intervalMs = 15_000,
}: MailWorkerOptions): () => Promise<void> {
  let running: Promise<void> = Promise.resolve()
  let busy = false
  let stopped = false

  async function run(): Promise<void> {
    try {
      await deliverPending(db, send, {
        publicUrl,
        shouldStop: () => stopped,
        // Mail errors quote the address they were about, so only their codes are logged.
        onError: (error, notificationId) =>
          log.warn(
            { notificationId, ...describeMailError(error) },
            'notification email failed, will retry',
          ),
      })
    } catch (error) {
      log.error({ err: error }, 'mail worker run failed')
    }
  }

  const timer = setInterval(() => {
    if (busy) return
    busy = true
    running = run().finally(() => {
      busy = false
    })
  }, intervalMs)
  timer.unref()

  return async () => {
    stopped = true
    clearInterval(timer)
    await running
  }
}
