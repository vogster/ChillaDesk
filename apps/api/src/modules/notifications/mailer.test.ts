import type { Task, WikiPage } from '@chillawiki/shared'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { notifications } from '../../db/schema'
import { createTestContext, type ProjectFixture, type TestContext } from '../../test/harness'
import {
  createMailSender,
  deliverPending,
  MAX_ATTEMPTS,
  MAX_EMAILS_PER_HOUR,
  startMailWorker,
  type MailMessage,
} from './mailer'

const PUBLIC_URL = 'https://wiki.example.com'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

// Every test starts with an empty outbox, whatever the tests before it left behind.
beforeEach(async () => {
  await ctx.database.db.delete(notifications)
})

async function assign(fixture: ProjectFixture, title = 'Review the PR'): Promise<Task> {
  const response = await fixture.call(fixture.owner, 'POST', '/tasks', {
    title,
    assigneeId: fixture.member.id,
  })
  return response.json<Task>()
}

function outbox() {
  const sent: MailMessage[] = []
  return { sent, send: async (message: MailMessage) => void sent.push(message) }
}

const later = (minutes: number) => new Date(Date.now() + minutes * 60 * 1000)

const deliver = (
  send: (message: MailMessage) => Promise<void>,
  now?: Date,
  shouldStop?: () => boolean,
) =>
  deliverPending(ctx.database.db, send, {
    publicUrl: PUBLIC_URL,
    ...(now ? { now } : {}),
    ...(shouldStop ? { shouldStop } : {}),
  })

describe('deliverPending', () => {
  it('emails an assignment with a link to the task, once', async () => {
    const fixture = await ctx.createProject()
    const task = await assign(fixture)
    const { sent, send } = outbox()

    const first = await deliver(send)
    const second = await deliver(send)

    expect([first, second]).toEqual([
      { sent: 1, failed: 0 },
      { sent: 0, failed: 0 },
    ])
    expect(sent).toEqual([
      {
        to: fixture.member.email,
        subject: `[${task.key}] Olga Owner assigned you a task`,
        text: [
          `Olga Owner assigned you a task in ${fixture.project.name}:`,
          '',
          `${task.key} Review the PR`,
          '',
          `${PUBLIC_URL}/projects/${fixture.project.id}/tasks/${task.number}`,
        ].join('\n'),
      },
    ])
  })

  it('words comments and mentions differently and links a wiki page', async () => {
    const fixture = await ctx.createProject()
    const task = await assign(fixture)
    await fixture.call(fixture.member, 'POST', `/tasks/${task.id}/comments`, { body: 'On it' })
    const page = (
      await fixture.call(fixture.owner, 'POST', '/wiki', {
        title: 'Plan',
        content: `Ask @${fixture.viewer.email}`,
      })
    ).json<WikiPage>()
    const { sent, send } = outbox()

    await deliver(send)

    const bySubject = Object.fromEntries(sent.map((message) => [message.subject, message]))
    expect(Object.keys(bySubject).sort()).toEqual([
      `[${task.key}] Max Member commented on a task`,
      `[${task.key}] Olga Owner assigned you a task`,
      `[${fixture.project.key}] Olga Owner mentioned you`,
    ])
    const mention = bySubject[`[${fixture.project.key}] Olga Owner mentioned you`]
    expect(mention?.to).toBe(fixture.viewer.email)
    expect(mention?.text).toContain('Olga Owner mentioned you on the wiki page “Plan”')
    expect(mention?.text).toContain(`Ask @${fixture.viewer.email}`)
    expect(mention?.text).toContain(`${PUBLIC_URL}/projects/${fixture.project.id}/wiki/${page.id}`)
    expect(bySubject[`[${task.key}] Max Member commented on a task`]?.text).toContain('On it')
  })

  it('keeps a notification in the outbox when sending fails, and retries it', async () => {
    const fixture = await ctx.createProject()
    await assign(fixture)
    const { sent, send } = outbox()

    const failed = await deliver(() => Promise.reject(new Error('SMTP is down')))
    const tooSoon = await deliver(send)
    const retried = await deliver(send, later(3))

    expect(failed).toEqual({ sent: 0, failed: 1 })
    expect(tooSoon).toEqual({ sent: 0, failed: 0 })
    expect(retried).toEqual({ sent: 1, failed: 0 })
    expect(sent).toHaveLength(1)
  })

  it('waits longer after every failure and gives up in the end', async () => {
    const fixture = await ctx.createProject()
    await assign(fixture)
    const down = () => Promise.reject(new Error('SMTP is down'))
    const { sent, send } = outbox()

    // 2 minutes after the first failure, then 8, 32 and 128.
    const waits = [0, 3, 12, 45, 175]
    expect(waits).toHaveLength(MAX_ATTEMPTS)
    const results = []
    for (const minutes of waits) results.push((await deliver(down, later(minutes))).failed)
    const afterwards = await deliver(send, later(60 * 20))

    expect(results).toEqual([1, 1, 1, 1, 1])
    expect(afterwards).toEqual({ sent: 0, failed: 0 })
    expect(sent).toEqual([])
    const [row] = await ctx.database.db.select().from(notifications)
    expect(row).toMatchObject({ emailSent: false, emailAttempts: MAX_ATTEMPTS })
    expect(row?.emailedAt).not.toBeNull()
  })

  it('lets new notifications through while older ones keep failing', async () => {
    const fixture = await ctx.createProject()
    for (let index = 0; index < 21; index += 1) await assign(fixture, `Stuck ${index}`)
    const down = () => Promise.reject(new Error('rejected'))
    await deliver(down)
    await deliver(down)
    await assign(fixture, 'Fresh')
    const { sent, send } = outbox()

    await deliver(send)

    expect(sent.map((message) => message.text)).toEqual([expect.stringContaining('Fresh')])
  })

  it('sends again what a crashed run left claimed, once its claim has run out', async () => {
    const fixture = await ctx.createProject()
    await assign(fixture)
    const { sent, send } = outbox()
    // A run that claimed the row and then died: nothing was sent, nothing was written back.
    await deliver(send, undefined, () => true)

    const meanwhile = await deliver(send)
    const afterLease = await deliver(send, later(3))

    expect(meanwhile).toEqual({ sent: 0, failed: 0 })
    expect(afterLease).toEqual({ sent: 1, failed: 0 })
    expect(sent).toHaveLength(1)
  })

  it('does not email someone who has left the project in the meantime', async () => {
    const fixture = await ctx.createProject()
    const task = await assign(fixture)
    // Removing a member deletes their notifications; this is the row a concurrent run still has.
    await ctx.database.db.delete(notifications)
    await fixture.call(fixture.owner, 'DELETE', `/members/${fixture.member.id}`)
    await ctx.database.db.insert(notifications).values({
      userId: fixture.member.id,
      type: 'task_assigned',
      actorId: fixture.owner.id,
      projectId: fixture.project.id,
      taskId: task.id,
      excerpt: task.title,
    })
    const { sent, send } = outbox()

    const result = await deliver(send)

    expect(result).toEqual({ sent: 0, failed: 0 })
    expect(sent).toEqual([])
  })

  it('caps the emails one person gets in an hour and resumes after it', async () => {
    const fixture = await ctx.createProject()
    for (let index = 0; index < MAX_EMAILS_PER_HOUR + 5; index += 1) {
      await assign(fixture, `Task ${index}`)
    }
    const { sent, send } = outbox()

    await deliver(send)
    await deliver(send)
    await deliver(send)
    expect(sent).toHaveLength(MAX_EMAILS_PER_HOUR)
    const pending = await ctx.database.db.select().from(notifications)
    expect(pending.every((row) => row.emailedAt !== null)).toBe(true)

    await assign(fixture, 'An hour later')
    await deliver(send, later(61))

    expect(sent).toHaveLength(MAX_EMAILS_PER_HOUR + 1)
  })

  it('does not email what was already read or is older than a day', async () => {
    const fixture = await ctx.createProject()
    await assign(fixture, 'Read already')
    await ctx.request(fixture.member, 'POST', '/api/notifications/read', {})
    await assign(fixture, 'Too old')
    const { sent, send } = outbox()

    const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000)
    const result = await deliver(send, tomorrow)

    expect(result).toEqual({ sent: 0, failed: 0 })
    expect(sent).toEqual([])
    const left = await ctx.database.db.select().from(notifications)
    expect(left.every((row) => row.emailedAt !== null)).toBe(true)
  })

  it('flattens line breaks so a title cannot add mail headers', async () => {
    const fixture = await ctx.createProject()
    const task = await assign(fixture)
    await ctx.database.db
      .update(notifications)
      .set({ excerpt: 'Line one\r\nBcc: evil@example.com' })
      .where(eq(notifications.taskId, task.id))
    const { sent, send } = outbox()

    await deliver(send)

    expect(sent[0]?.subject).not.toMatch(/[\r\n]/)
  })
})

describe('startMailWorker', () => {
  it('delivers on a timer until stopped, and logs a failure without the address', async () => {
    const fixture = await ctx.createProject()
    await assign(fixture, 'Bounces')
    await assign(fixture, 'Arrives')
    const { sent, send } = outbox()
    const logged: object[] = []
    const flaky = async (message: MailMessage) => {
      if (message.text.includes('Bounces')) {
        throw Object.assign(new Error(`550 ${message.to} rejected`), {
          code: 'EENVELOPE',
          responseCode: 550,
          rejected: [message.to],
        })
      }
      await send(message)
    }

    const stop = startMailWorker({
      db: ctx.database.db,
      send: flaky,
      publicUrl: PUBLIC_URL,
      intervalMs: 20,
      log: { warn: (details) => logged.push(details), error: (details) => logged.push(details) },
    })
    await expect.poll(() => sent.length, { timeout: 10_000 }).toBe(1)
    await stop()
    await assign(fixture, 'After stop')
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(sent).toHaveLength(1)
    expect(logged).toEqual([
      { notificationId: expect.any(String), code: 'EENVELOPE', responseCode: 550 },
    ])
    expect(JSON.stringify(logged)).not.toContain(fixture.member.email)
  })

  it('reports a run that fails as a whole and keeps going', async () => {
    const logged: string[] = []
    const broken = {
      select: () => {
        throw new Error('database is gone')
      },
    }

    const stop = startMailWorker({
      db: broken as never,
      send: () => Promise.resolve(),
      publicUrl: PUBLIC_URL,
      intervalMs: 10,
      log: { warn: () => undefined, error: (_details, message) => logged.push(message) },
    })
    await expect.poll(() => logged.length, { timeout: 10_000 }).toBeGreaterThan(1)
    await stop()

    expect(logged[0]).toBe('mail worker run failed')
  })
})

describe('createMailSender', () => {
  it('sends through the transport with the configured sender', async () => {
    const delivered: unknown[] = []
    const send = createMailSender(
      { jsonTransport: true },
      'ChillaWiki <wiki@example.com>',
      (info) => void delivered.push(info),
    )

    await send({ to: 'max@example.com', subject: 'Hello', text: 'Body' })

    expect(JSON.parse(String((delivered[0] as { message: string }).message))).toMatchObject({
      from: { address: 'wiki@example.com', name: 'ChillaWiki' },
      to: [{ address: 'max@example.com' }],
      subject: 'Hello',
      text: 'Body',
    })
  })
})
