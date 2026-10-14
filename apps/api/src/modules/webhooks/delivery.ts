import type { WebhookFormat } from '@chilladesk/shared'
import { and, asc, eq, inArray, lt, lte, ne, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { projectMembers, webhookDeliveries, webhooks } from '../../db/schema'
import { BlockedAddressError, postWebhook, type PostResult } from './address'
import type { WebhookPayload } from './events'
import { renderDelivery } from './render'

/** Sends one delivery; `postWebhook` in the server, a stand-in in tests. */
export type PostFn = (
  url: string,
  body: string,
  headers: Record<string, string>,
) => Promise<PostResult>

const BATCH_SIZE = 20
/**
 * A delivery is given up after this many attempts: 1 minute after the first, then 4, 16,
 * 64 and 256 — about five and a half hours in all.
 */
export const MAX_ATTEMPTS = 6
/** Finished deliveries are kept this long, to be shown in the settings. */
const KEEP_DAYS = 14

interface ClaimedDelivery {
  id: string
  payload: unknown
  attempts: number
  url: string
  format: WebhookFormat
  secret: string
  active: boolean
  webhookId: string
  ownerId: string | null
}

/** Deliveries of one webhook taken per batch, so a slow receiver cannot hold up the rest. */
const PER_WEBHOOK = 2

/**
 * Takes a batch out of the outbox by counting an attempt and pushing the next one into the
 * future. That one write is both the lease that keeps a second API instance away while the
 * delivery is being sent, and the retry schedule if sending fails or the process dies.
 * The update checks again that a row is still due, so two workers never take the same one.
 */
async function claimBatch(db: Db, now: Date): Promise<ClaimedDelivery[]> {
  const nowSql = sql`${now.toISOString()}::timestamptz`
  const due = and(
    eq(webhookDeliveries.status, 'pending'),
    lte(webhookDeliveries.nextAttemptAt, now),
  )
  const ranked = db
    .select({
      id: webhookDeliveries.id,
      nextAttemptAt: webhookDeliveries.nextAttemptAt,
      rank: sql<number>`row_number() over (partition by ${webhookDeliveries.webhookId} order by ${webhookDeliveries.nextAttemptAt})`.as(
        'rank',
      ),
    })
    .from(webhookDeliveries)
    .where(due)
    .as('ranked')
  const candidates = await db
    .select({ id: ranked.id })
    .from(ranked)
    .where(lte(ranked.rank, PER_WEBHOOK))
    .orderBy(asc(ranked.nextAttemptAt))
    .limit(BATCH_SIZE)
  if (candidates.length === 0) return []

  const claimed = await db
    .update(webhookDeliveries)
    .set({
      nextAttemptAt: sql`${nowSql} + interval '1 minute' * power(4, ${webhookDeliveries.attempts})`,
      attempts: sql`${webhookDeliveries.attempts} + 1`,
      lastAttemptAt: now,
    })
    .where(
      and(
        inArray(
          webhookDeliveries.id,
          candidates.map((row) => row.id),
        ),
        due,
      ),
    )
    .returning({ id: webhookDeliveries.id })
  if (claimed.length === 0) return []

  return db
    .select({
      id: webhookDeliveries.id,
      webhookId: webhooks.id,
      payload: webhookDeliveries.payload,
      attempts: webhookDeliveries.attempts,
      url: webhooks.url,
      format: webhooks.format,
      secret: webhooks.secret,
      active: webhooks.active,
      // Null once whoever added the webhook no longer owns the project.
      ownerId: projectMembers.userId,
    })
    .from(webhookDeliveries)
    .innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
    .leftJoin(
      projectMembers,
      and(
        eq(projectMembers.projectId, webhooks.projectId),
        eq(projectMembers.userId, webhooks.createdById),
        eq(projectMembers.role, 'owner'),
      ),
    )
    .where(
      inArray(
        webhookDeliveries.id,
        claimed.map((row) => row.id),
      ),
    )
    .orderBy(asc(webhookDeliveries.createdAt))
}

/** What went wrong, in words that say nothing about the server's own network. */
function describeFailure(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  // One message for both, so the answers do not tell which internal names exist.
  if (error instanceof BlockedAddressError || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return 'The address could not be found or is not public'
  }
  if (code === 'ECONNREFUSED') return 'The connection was refused'
  if (code === 'ECONNRESET') return 'The connection was dropped'
  if ((typeof code === 'string' && code.startsWith('ERR_TLS')) || code === 'CERT_HAS_EXPIRED') {
    return 'The TLS certificate was not accepted'
  }
  if (error instanceof Error && error.message.startsWith('No answer within')) return error.message
  return 'The delivery could not be sent'
}

export interface DeliveryRunOptions {
  /** Where people open ChillaDesk, for links in messages; null leaves them out. */
  publicUrl: string | null
  now?: Date
  shouldStop?: () => boolean
}

export interface DeliveryRunResult {
  delivered: number
  failed: number
}

/** Sends one batch of what is waiting in the outbox. */
export async function deliverWebhooks(
  db: Db,
  post: PostFn,
  { publicUrl, now = new Date(), shouldStop }: DeliveryRunOptions,
): Promise<DeliveryRunResult> {
  // What is not sent because of a shutdown keeps its claim and is picked up again later.
  if (shouldStop?.()) return { delivered: 0, failed: 0 }
  const batch = await claimBatch(db, now)
  // All at once: one slow receiver must not hold up the others.
  const outcomes = await Promise.all(
    batch.map((delivery) => sendOne(db, post, delivery, publicUrl, now)),
  )
  return {
    delivered: outcomes.filter((outcome) => outcome === 'delivered').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
  }
}

async function sendOne(
  db: Db,
  post: PostFn,
  delivery: ClaimedDelivery,
  publicUrl: string | null,
  now: Date,
): Promise<'delivered' | 'failed' | 'dropped'> {
  const finish = (values: Partial<typeof webhookDeliveries.$inferInsert>) =>
    db.update(webhookDeliveries).set(values).where(eq(webhookDeliveries.id, delivery.id))

  // A webhook turned off meanwhile gets nothing more, and nothing is kept waiting for it.
  if (!delivery.active) {
    await finish({ status: 'failed', error: 'The webhook was turned off' })
    return 'dropped'
  }
  // Whoever added it may no longer see the project; it stops telling them about it.
  if (!delivery.ownerId) {
    await db.update(webhooks).set({ active: false }).where(eq(webhooks.id, delivery.webhookId))
    await finish({
      status: 'failed',
      error: 'Whoever added this webhook no longer owns the project',
    })
    return 'dropped'
  }
  const { body, headers } = renderDelivery(delivery.payload as WebhookPayload, {
    deliveryId: delivery.id,
    format: delivery.format,
    secret: delivery.secret,
    publicUrl,
    now,
  })
  let outcome: { status: number | null; error: string | null }
  try {
    const response = await post(delivery.url, body, headers)
    outcome =
      response.status >= 200 && response.status < 300
        ? { status: response.status, error: null }
        : { status: response.status, error: `The receiver answered HTTP ${response.status}` }
  } catch (error) {
    outcome = { status: null, error: describeFailure(error) }
  }

  if (outcome.error === null) {
    await finish({ status: 'delivered', responseStatus: outcome.status, error: null })
    return 'delivered'
  }
  const givenUp = delivery.attempts >= MAX_ATTEMPTS
  await finish({
    ...(givenUp ? { status: 'failed' as const } : {}),
    responseStatus: outcome.status,
    error: outcome.error,
  })
  return 'failed'
}

/** Removes finished deliveries older than the settings show. */
export async function pruneDeliveries(db: Db, now = new Date()): Promise<void> {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000)
  await db
    .delete(webhookDeliveries)
    .where(and(ne(webhookDeliveries.status, 'pending'), lt(webhookDeliveries.createdAt, cutoff)))
}

interface WorkerLog {
  error(details: object, message: string): void
}

export interface WebhookWorkerOptions {
  db: Db
  publicUrl: string | null
  allowPrivate: boolean
  log: WorkerLog
  intervalMs?: number
  post?: PostFn
}

/** Sends webhook deliveries in the background. Returns a function that stops it. */
export function startWebhookWorker({
  db,
  publicUrl,
  allowPrivate,
  log,
  intervalMs = 5_000,
  post = (url, body, headers) => postWebhook(url, body, headers, { allowPrivate }),
}: WebhookWorkerOptions): () => Promise<void> {
  let running: Promise<void> = Promise.resolve()
  let busy = false
  let stopped = false
  let runs = 0

  async function run(): Promise<void> {
    try {
      // Pruning is cheap but needless every few seconds; about once an hour is plenty.
      if (runs % 720 === 0) await pruneDeliveries(db)
      runs += 1
      // Batch after batch while there is a backlog, so a burst does not wait minutes.
      for (let round = 0; round < 10 && !stopped; round += 1) {
        const { delivered, failed } = await deliverWebhooks(db, post, {
          publicUrl,
          shouldStop: () => stopped,
        })
        if (delivered + failed < BATCH_SIZE) break
      }
    } catch (error) {
      log.error({ err: error }, 'webhook worker run failed')
    }
  }

  const timer = setInterval(() => {
    if (busy || stopped) return
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
