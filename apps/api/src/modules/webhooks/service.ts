import { randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import {
  WEBHOOKS_PER_PROJECT_MAX,
  type CreatedWebhook,
  type CreateWebhookRequest,
  type UpdateWebhookRequest,
  type Webhook,
  type WebhookDelivery,
  type WebhookEvent,
} from '@chilladesk/shared'
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { projects, users, webhookDeliveries, webhooks } from '../../db/schema'
import { conflict, invalid, notFound } from '../../errors'
import { getProject } from '../projects/service'
import { isPublicAddress } from './address'
import { queueDeliveries } from './events'

type WebhookRow = typeof webhooks.$inferSelect
type DeliveryRow = typeof webhookDeliveries.$inferSelect

export interface WebhookPolicy {
  /** Whether webhooks may point at private addresses (a CI server in the same network). */
  allowPrivate: boolean
}

function toDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    event: row.event as WebhookDelivery['event'],
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.responseStatus,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
  }
}

/**
 * The address with its path hidden: for Slack, Discord and Telegram the path is a key that
 * lets anyone post as the integration, and even read-only tokens list webhooks.
 */
export function maskUrl(url: string): string {
  const { origin, pathname, search } = new URL(url)
  const rest = `${pathname}${search}`
  return rest.length > 1 ? `${origin}/…${rest.slice(-4)}` : origin
}

function toWebhook(row: WebhookRow, last: DeliveryRow | undefined): Webhook {
  return {
    id: row.id,
    url: maskUrl(row.url),
    format: row.format,
    events: row.events as WebhookEvent[],
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    lastDelivery: last ? toDelivery(last) : null,
  }
}

/**
 * Refuses a port outside the web and unprivileged ranges, and an address that is plainly
 * private: an IP address of the server's own networks, or `localhost`. Names are checked
 * again whenever a delivery connects, as what they resolve to can change.
 */
function assertReachable(url: string, { allowPrivate }: WebhookPolicy): void {
  const target = new URL(url)
  // Web ports and the unprivileged range: not SSH, SMTP, databases and the like.
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80))
  if (port !== 80 && port !== 443 && port < 1024) {
    throw invalid('Webhooks can use ports 80, 443 and 1024 and above')
  }
  if (allowPrivate) return
  const host = target.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const isLocalName = host === 'localhost' || host.endsWith('.localhost')
  if (isLocalName || (isIP(host) !== 0 && !isPublicAddress(host))) {
    throw invalid('Webhooks cannot point at private addresses on this server')
  }
}

async function lastDeliveries(db: Db, webhookIds: string[]): Promise<Map<string, DeliveryRow>> {
  if (webhookIds.length === 0) return new Map()
  const rows = await db
    .selectDistinctOn([webhookDeliveries.webhookId])
    .from(webhookDeliveries)
    .where(inArray(webhookDeliveries.webhookId, webhookIds))
    .orderBy(asc(webhookDeliveries.webhookId), desc(webhookDeliveries.createdAt))
  return new Map(rows.map((row) => [row.webhookId, row]))
}

async function loadWebhook(db: Db, projectId: string, webhookId: string): Promise<WebhookRow> {
  const [row] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.projectId, projectId), eq(webhooks.id, webhookId)))
  if (!row) throw notFound('Webhook')
  return row
}

/** A project's webhooks with how their last delivery went. Owners only. */
export async function listWebhooks(db: Db, userId: string, projectId: string): Promise<Webhook[]> {
  await getProject(db, userId, projectId, 'owner')
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.projectId, projectId))
    .orderBy(asc(webhooks.createdAt))
  const last = await lastDeliveries(
    db,
    rows.map((row) => row.id),
  )
  return rows.map((row) => toWebhook(row, last.get(row.id)))
}

export async function createWebhook(
  db: Db,
  userId: string,
  projectId: string,
  input: CreateWebhookRequest,
  policy: WebhookPolicy,
): Promise<CreatedWebhook> {
  await getProject(db, userId, projectId, 'owner')
  assertReachable(input.url, policy)
  return db.transaction(async (tx) => {
    // Locked, so two owners adding at once cannot pass the limit together.
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update')
    const [existing] = await tx
      .select({ total: count() })
      .from(webhooks)
      .where(eq(webhooks.projectId, projectId))
    if ((existing?.total ?? 0) >= WEBHOOKS_PER_PROJECT_MAX) {
      throw conflict('This project has too many webhooks, delete some first')
    }
    const [created] = await tx
      .insert(webhooks)
      .values({
        projectId,
        ...input,
        secret: randomBytes(32).toString('base64url'),
        createdById: userId,
      })
      .returning()
    if (!created) throw new Error('Insert returned no webhook row')
    return { ...toWebhook(created, undefined), secret: created.secret }
  })
}

export async function updateWebhook(
  db: Db,
  userId: string,
  projectId: string,
  webhookId: string,
  patch: UpdateWebhookRequest,
  policy: WebhookPolicy,
): Promise<Webhook> {
  await getProject(db, userId, projectId, 'owner')
  if (patch.url) assertReachable(patch.url, policy)
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(webhooks)
      // Whoever changes it answers for it from now on.
      .set({ ...patch, createdById: userId })
      .where(and(eq(webhooks.projectId, projectId), eq(webhooks.id, webhookId)))
      .returning()
    if (!row) throw notFound('Webhook')
    // Events queued for the old address are not sent to the new one.
    if (patch.url) {
      await tx
        .update(webhookDeliveries)
        .set({ status: 'failed', error: 'The address was changed' })
        .where(
          and(eq(webhookDeliveries.webhookId, row.id), eq(webhookDeliveries.status, 'pending')),
        )
    }
    return row
  })
  const last = await lastDeliveries(db, [updated.id])
  return toWebhook(updated, last.get(updated.id))
}

export async function deleteWebhook(
  db: Db,
  userId: string,
  projectId: string,
  webhookId: string,
): Promise<void> {
  await getProject(db, userId, projectId, 'owner')
  const removed = await db
    .delete(webhooks)
    .where(and(eq(webhooks.projectId, projectId), eq(webhooks.id, webhookId)))
    .returning({ id: webhooks.id })
  if (removed.length === 0) throw notFound('Webhook')
}

/** Recent deliveries of a webhook, newest first. */
export async function listDeliveries(
  db: Db,
  userId: string,
  projectId: string,
  webhookId: string,
): Promise<WebhookDelivery[]> {
  await getProject(db, userId, projectId, 'owner')
  await loadWebhook(db, projectId, webhookId)
  const rows = await db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(30)
  return rows.map(toDelivery)
}

/** Queues a test message, sent like any other delivery. */
export async function pingWebhook(
  db: Db,
  userId: string,
  projectId: string,
  webhookId: string,
): Promise<WebhookDelivery> {
  const project = await getProject(db, userId, projectId, 'owner')
  const webhook = await loadWebhook(db, projectId, webhookId)
  if (!webhook.active) throw conflict('Turn the webhook on to send it a test')
  const [actor] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
  const [delivery] = await queueDeliveries(db, [webhook.id], {
    event: 'ping',
    occurredAt: new Date().toISOString(),
    project: { id: project.id, key: project.key, name: project.name },
    actor: actor ?? null,
  })
  if (!delivery) throw new Error('The test delivery was not queued')
  return toDelivery(delivery)
}
