import { createHmac } from 'node:crypto'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type {
  CreatedWebhook,
  Task,
  Webhook,
  WebhookDelivery,
  WebhookEvent,
  WikiPage,
} from '@chilladesk/shared'
import { WEBHOOKS_PER_PROJECT_MAX } from '@chilladesk/shared'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { projectMembers, webhookDeliveries, webhooks } from '../../db/schema'
import { createTestContext, type ProjectFixture, type TestContext } from '../../test/harness'
import { BlockedAddressError, isPublicAddress, postWebhook } from './address'
import { deliverWebhooks, MAX_ATTEMPTS, type PostFn } from './delivery'
import { MAX_WAITING, type WebhookPayload } from './events'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

const ALL_EVENTS: WebhookEvent[] = [
  'task.created',
  'task.updated',
  'task.deleted',
  'comment.created',
  'page.created',
  'page.updated',
  'page.deleted',
]

let hookCounter = 0

async function addWebhook(
  fixture: ProjectFixture,
  body: Record<string, unknown> = {},
): Promise<CreatedWebhook> {
  const sent = {
    // Each its own address: the worker sends what other tests left waiting too.
    url: `https://hooks.example.com/${(hookCounter += 1)}`,
    events: ALL_EVENTS,
    ...body,
  }
  const response = await fixture.call(fixture.owner, 'POST', '/webhooks', sent)
  expect(response.statusCode, response.body).toBe(201)
  // The API shows the address masked; tests match deliveries by the full one.
  return { ...response.json<CreatedWebhook>(), url: sent.url as string }
}

async function queued(webhookId: string) {
  return ctx.database.db
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookId, webhookId))
    .orderBy(asc(webhookDeliveries.createdAt))
}

const payloads = async (webhookId: string) =>
  (await queued(webhookId)).map((row) => row.payload as WebhookPayload)

async function addTask(fixture: ProjectFixture, title = 'Ship it'): Promise<Task> {
  const response = await fixture.call(fixture.member, 'POST', '/tasks', { title })
  expect(response.statusCode, response.body).toBe(201)
  return response.json<Task>()
}

/** Runs the worker with a stand-in for the network; returns what it was asked to send. */
async function runWorker(answer: (url: string) => number | Error = () => 200, now?: Date) {
  const sent: { url: string; body: string; headers: Record<string, string> }[] = []
  const post: PostFn = async (url, body, headers) => {
    sent.push({ url, body, headers })
    const result = answer(url)
    if (result instanceof Error) throw result
    return { status: result }
  }
  const result = await deliverWebhooks(ctx.database.db, post, {
    publicUrl: 'https://desk.example.com',
    ...(now ? { now } : {}),
  })
  return { sent, result }
}

describe('managing webhooks', () => {
  it('lets an owner add one, shows its secret once and lists it without', async () => {
    const fixture = await ctx.createProject()
    const created = await addWebhook(fixture, { format: 'slack', events: ['task.created'] })

    expect(created).toMatchObject({
      format: 'slack',
      events: ['task.created'],
      active: true,
      lastDelivery: null,
    })
    expect(created.secret.length).toBeGreaterThanOrEqual(40)

    const list = await fixture.call(fixture.owner, 'GET', '/webhooks')
    expect(list.json<Webhook[]>()).toEqual([
      expect.objectContaining({ id: created.id, format: 'slack' }),
    ])
    expect(list.body).not.toContain(created.secret)
    expect(list.json<Webhook[]>()[0]?.url).toMatch(/^https:\/\/hooks\.example\.com\/…/)
    expect(list.body).not.toContain(created.url)
  })

  it('is for owners only', async () => {
    const fixture = await ctx.createProject()
    const webhook = await addWebhook(fixture)
    const attempts = [
      ['GET', '/webhooks'],
      ['POST', '/webhooks'],
      ['PATCH', `/webhooks/${webhook.id}`],
      ['DELETE', `/webhooks/${webhook.id}`],
      ['POST', `/webhooks/${webhook.id}/test`],
      ['GET', `/webhooks/${webhook.id}/deliveries`],
    ] as const
    for (const [method, path] of attempts) {
      const body =
        method === 'GET' || method === 'DELETE'
          ? undefined
          : path === '/webhooks'
            ? { url: 'https://hooks.example.com/x', events: ['task.created'] }
            : { active: false }
      for (const [user, status] of [
        [fixture.member, 403],
        [fixture.viewer, 403],
        [fixture.outsider, 404],
      ] as const) {
        const response = await fixture.call(user, method, path, body)
        expect(response.statusCode, `${method} ${path}`).toBe(status)
      }
    }
  })

  it('refuses private addresses and other schemes', async () => {
    const fixture = await ctx.createProject()
    for (const url of [
      'http://127.0.0.1:9000/hook',
      'http://localhost:9000/hook',
      'http://[::1]/hook',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/hook',
      'http://0x7f.1/hook',
      'ftp://example.com/hook',
      'http://example.com:22/hook',
    ]) {
      const response = await fixture.call(fixture.owner, 'POST', '/webhooks', {
        url,
        events: ['task.created'],
      })
      expect(response.statusCode, url).toBe(400)
    }
  })

  it('changes, turns off and deletes a webhook', async () => {
    const fixture = await ctx.createProject()
    const webhook = await addWebhook(fixture)

    const changed = await fixture.call(fixture.owner, 'PATCH', `/webhooks/${webhook.id}`, {
      events: ['comment.created'],
      active: false,
    })
    expect(changed.json<Webhook>()).toMatchObject({ events: ['comment.created'], active: false })

    const removed = await fixture.call(fixture.owner, 'DELETE', `/webhooks/${webhook.id}`)
    expect(removed.statusCode).toBe(204)
    expect((await fixture.call(fixture.owner, 'GET', '/webhooks')).json()).toEqual([])
  })

  it('keeps to the limit of webhooks per project', async () => {
    const fixture = await ctx.createProject()
    for (let index = 0; index < WEBHOOKS_PER_PROJECT_MAX; index += 1) await addWebhook(fixture)
    const response = await fixture.call(fixture.owner, 'POST', '/webhooks', {
      url: 'https://hooks.example.com/one-more',
      events: ['task.created'],
    })
    expect(response.statusCode).toBe(409)
  })
})

describe('what webhooks are told', () => {
  it('queues task, comment and page events with what they are about', async () => {
    const fixture = await ctx.createProject()
    const webhook = await addWebhook(fixture)

    const task = await addTask(fixture)
    await fixture.call(fixture.member, 'PATCH', `/tasks/${task.id}`, { priority: 'urgent' })
    await fixture.call(fixture.member, 'POST', `/tasks/${task.id}/move`, {
      statusId: fixture.statuses[2]?.id,
      beforeTaskId: null,
    })
    await fixture.call(fixture.member, 'POST', `/tasks/${task.id}/comments`, { body: 'Done!' })
    await fixture.call(fixture.member, 'DELETE', `/tasks/${task.id}`)
    const page = (
      await fixture.call(fixture.member, 'POST', '/wiki', { title: 'Guide', content: 'v1' })
    ).json<WikiPage>()
    await fixture.call(fixture.member, 'PATCH', `/wiki/${page.id}`, {
      content: 'v2',
      baseVersion: 1,
    })
    await fixture.call(fixture.member, 'DELETE', `/wiki/${page.id}`)

    const events = await payloads(webhook.id)
    expect(events.map((event) => event.event)).toEqual([
      'task.created',
      'task.updated',
      'task.updated',
      'comment.created',
      'task.deleted',
      'page.created',
      'page.updated',
      'page.deleted',
    ])
    const [created, edited, moved, commented, deleted] = events
    expect(created).toMatchObject({
      project: { id: fixture.project.id, key: fixture.project.key },
      actor: { id: fixture.member.id, name: 'Max Member' },
      task: { id: task.id, key: task.key, title: 'Ship it', priority: 'medium' },
    })
    expect(edited?.changes).toEqual([{ field: 'priority', from: 'medium', to: 'urgent' }])
    expect(moved?.changes).toEqual([
      { field: 'status', from: fixture.statuses[0]?.name, to: fixture.statuses[2]?.name },
    ])
    expect(commented?.comment?.body).toBe('Done!')
    expect(deleted?.task).toMatchObject({ key: task.key, title: 'Ship it' })
    expect(events[5]?.page).toEqual({ id: page.id, title: 'Guide' })
  })

  it('tells only active webhooks about the events they chose', async () => {
    const fixture = await ctx.createProject()
    const comments = await addWebhook(fixture, { events: ['comment.created'] })
    const off = await addWebhook(fixture)
    await fixture.call(fixture.owner, 'PATCH', `/webhooks/${off.id}`, { active: false })

    await addTask(fixture)

    expect(await queued(comments.id)).toEqual([])
    expect(await queued(off.id)).toEqual([])
  })

  it('says nothing about tasks brought in by an import, or changes that changed nothing', async () => {
    const fixture = await ctx.createProject()
    const webhook = await addWebhook(fixture)
    const imported = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${fixture.project.id}/import/tasks`,
      headers: { ...fixture.owner.headers, 'content-type': 'text/csv' },
      payload: 'Title\nOne\nTwo',
    })
    expect(imported.statusCode, imported.body).toBe(200)
    const [task] = (await fixture.call(fixture.owner, 'GET', '/tasks')).json<{ items: Task[] }>()
      .items
    await fixture.call(fixture.member, 'PATCH', `/tasks/${task?.id}`, { title: task?.title })

    expect(await queued(webhook.id)).toEqual([])
  })
})

describe('sending deliveries', () => {
  it('sends JSON signed with the secret, and marks it delivered', async () => {
    const fixture = await ctx.createProject()
    const webhook = await addWebhook(fixture, { events: ['task.created'] })
    const task = await addTask(fixture)

    const { sent } = await runWorker()

    const delivery = sent.find((item) => item.url === webhook.url)
    expect(delivery).toBeDefined()
    const { body, headers } = delivery!
    const expected = createHmac('sha256', webhook.secret)
      .update(`${headers['x-chilladesk-timestamp']}.${body}`)
      .digest('hex')
    expect(headers['x-chilladesk-signature']).toBe(`sha256=${expected}`)
    expect(headers['x-chilladesk-event']).toBe('task.created')
    expect(JSON.parse(body)).toMatchObject({
      event: 'task.created',
      task: { key: task.key },
      url: `https://desk.example.com/projects/${fixture.project.id}/tasks/${task.number}`,
    })
    const [row] = await queued(webhook.id)
    expect(row).toMatchObject({ status: 'delivered', responseStatus: 200, attempts: 1 })
  })

  it('writes a line of text for Slack and Telegram, escaped for Slack', async () => {
    const fixture = await ctx.createProject()
    const slack = await addWebhook(fixture, {
      url: 'https://hooks.slack.example.com/x',
      format: 'slack',
      events: ['task.created'],
    })
    const telegram = await addWebhook(fixture, {
      url: 'https://api.telegram.example.com/botX/sendMessage?chat_id=1',
      format: 'telegram',
      events: ['task.created'],
    })
    await addTask(fixture, '<!channel> & co')

    const { sent } = await runWorker()

    const text = (url: string) =>
      (JSON.parse(sent.find((item) => item.url === url)?.body ?? '{}') as { text: string }).text
    expect(text(slack.url)).toContain('created')
    expect(text(slack.url)).toContain('&lt;!channel&gt; &amp; co')
    expect(text(telegram.url)).toContain(`[${fixture.project.key}] Max Member created`)
    expect(text(telegram.url)).toContain('<!channel> & co')
  })

  it('retries a failed delivery later and gives up after the last attempt', async () => {
    const fixture = await ctx.createProject()
    const webhook = await addWebhook(fixture, {
      url: 'https://down.example.com/hook',
      events: ['task.created'],
    })
    await addTask(fixture)
    const failing = (url: string) => (url === webhook.url ? 503 : 200)

    let now = new Date()
    await runWorker(failing, now)
    let [row] = await queued(webhook.id)
    expect(row).toMatchObject({
      status: 'pending',
      attempts: 1,
      responseStatus: 503,
      error: 'The receiver answered HTTP 503',
    })
    expect(row!.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime())

    // Too early: nothing is sent again.
    const { sent } = await runWorker(failing, now)
    expect(sent.filter((item) => item.url === webhook.url)).toEqual([])

    for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt += 1) {
      now = new Date(row!.nextAttemptAt.getTime() + 1000)
      await runWorker(() => new Error('connect ECONNREFUSED'), now)
      ;[row] = await queued(webhook.id)
    }
    expect(row).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS })
    expect(row?.error).toBe('The delivery could not be sent')
  })

  it('sends a test message on request and lists the deliveries', async () => {
    const fixture = await ctx.createProject()
    const webhook = await addWebhook(fixture)

    const test = await fixture.call(fixture.owner, 'POST', `/webhooks/${webhook.id}/test`)
    expect(test.statusCode, test.body).toBe(202)
    expect(test.json<WebhookDelivery>()).toMatchObject({ event: 'ping', status: 'pending' })
    await runWorker()

    const deliveries = await fixture.call(
      fixture.owner,
      'GET',
      `/webhooks/${webhook.id}/deliveries`,
    )
    expect(deliveries.json<WebhookDelivery[]>()).toEqual([
      expect.objectContaining({ event: 'ping', status: 'delivered', responseStatus: 200 }),
    ])
    const [listed] = (await fixture.call(fixture.owner, 'GET', '/webhooks')).json<Webhook[]>()
    expect(listed?.lastDelivery).toMatchObject({ event: 'ping', status: 'delivered' })
  })

  it('drops what waits for a webhook that was turned off', async () => {
    const fixture = await ctx.createProject()
    const webhook = await addWebhook(fixture, { events: ['task.created'] })
    await addTask(fixture)
    await fixture.call(fixture.owner, 'PATCH', `/webhooks/${webhook.id}`, { active: false })

    const { sent } = await runWorker()

    expect(sent.filter((item) => item.url === webhook.url)).toEqual([])
    const [row] = await queued(webhook.id)
    expect(row).toMatchObject({ status: 'failed', error: 'The webhook was turned off' })
  })
})

describe('keeping webhooks in bounds', () => {
  it('keeps no more than a backlog for a webhook that is down', async () => {
    const fixture = await ctx.createProject()
    const webhook = await addWebhook(fixture, { events: ['task.created'] })
    await ctx.database.db.insert(webhookDeliveries).values(
      Array.from({ length: MAX_WAITING }, () => ({
        webhookId: webhook.id,
        event: 'task.created',
        payload: {},
        nextAttemptAt: new Date(Date.now() + 3_600_000),
      })),
    )
    await addTask(fixture)
    expect(await queued(webhook.id)).toHaveLength(MAX_WAITING)
  })

  it('stops a webhook whose owner no longer owns the project', async () => {
    const fixture = await ctx.createProject()
    const webhook = await addWebhook(fixture, { events: ['task.created'] })
    await addTask(fixture)
    await ctx.database.db
      .update(projectMembers)
      .set({ role: 'member' })
      .where(eq(projectMembers.userId, fixture.owner.id))

    const { sent } = await runWorker()

    expect(sent.filter((item) => item.url === webhook.url)).toEqual([])
    const [row] = await queued(webhook.id)
    expect(row?.error).toBe('Whoever added this webhook no longer owns the project')
    const [stored] = await ctx.database.db
      .select()
      .from(webhooks)
      .where(eq(webhooks.id, webhook.id))
    expect(stored?.active).toBe(false)
  })

  it('sends nothing queued for an old address to a new one', async () => {
    const fixture = await ctx.createProject()
    const webhook = await addWebhook(fixture, { events: ['task.created'] })
    await addTask(fixture)
    await fixture.call(fixture.owner, 'PATCH', `/webhooks/${webhook.id}`, {
      url: 'https://elsewhere.example.com/hook',
    })
    const [row] = await queued(webhook.id)
    expect(row).toMatchObject({ status: 'failed', error: 'The address was changed' })
  })

  it('takes only a few deliveries of one webhook per batch', async () => {
    const fixture = await ctx.createProject()
    const busy = await addWebhook(fixture, { events: ['task.created'] })
    const other = await addWebhook(fixture, { events: ['comment.created'] })
    for (let index = 0; index < 5; index += 1) await addTask(fixture, `Task ${index}`)
    const task = await addTask(fixture, 'Talked about')
    await fixture.call(fixture.member, 'POST', `/tasks/${task.id}/comments`, { body: 'Hi' })

    const { sent } = await runWorker()

    expect(sent.filter((item) => item.url === busy.url).length).toBeLessThanOrEqual(2)
    expect(sent.filter((item) => item.url === other.url)).toHaveLength(1)
  })

  it('keeps Discord from pinging everyone through the Slack format', async () => {
    const fixture = await ctx.createProject()
    const slack = await addWebhook(fixture, { format: 'slack', events: ['task.created'] })
    await addTask(fixture, 'Hey @everyone and @here')

    const { sent } = await runWorker()

    const text = (
      JSON.parse(sent.find((item) => item.url === slack.url)?.body ?? '{}') as {
        text: string
      }
    ).text
    expect(text).not.toMatch(/@everyone|@here/)
    expect(text).toContain('everyone')
  })
})

describe('isPublicAddress', () => {
  it.each([
    ['8.8.8.8', true],
    ['2001:4860:4860::8888', true],
    ['::ffff:8.8.8.8', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.20.0.1', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['::1', false],
    ['::7f00:1', false],
    ['2002:7f00:1::', false],
    ['64:ff9b:1::1', false],
    ['fec0::1', false],
    ['::ffff:a00:1', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['not an address', false],
  ])('%s → %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected)
  })
})

describe('postWebhook', () => {
  let server: Server
  let url: string
  const received: { body: string; request: IncomingMessage }[] = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = ''
      request.on('data', (chunk: Buffer) => (body += chunk.toString()))
      request.on('end', () => {
        received.push({ body, request })
        if (request.url === '/redirect') {
          response.writeHead(302, { location: 'http://example.com/' }).end()
        } else if (request.url === '/slow') {
          setTimeout(() => response.writeHead(200).end(), 2000)
        } else {
          response.writeHead(204).end()
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  it('posts the body when private addresses are allowed', async () => {
    const result = await postWebhook(
      `${url}/hook`,
      '{"a":1}',
      { 'x-test': 'yes' },
      {
        allowPrivate: true,
      },
    )
    expect(result.status).toBe(204)
    expect(received.at(-1)?.body).toBe('{"a":1}')
    expect(received.at(-1)?.request.headers['x-test']).toBe('yes')
  })

  it('refuses private addresses by IP and by name', async () => {
    await expect(
      postWebhook(`${url}/hook`, '{}', {}, { allowPrivate: false }),
    ).rejects.toBeInstanceOf(BlockedAddressError)
    const byName = url.replace('127.0.0.1', 'localhost')
    await expect(postWebhook(`${byName}/hook`, '{}', {}, { allowPrivate: false })).rejects.toThrow(
      /not a public address/,
    )
  })

  it('does not follow redirects and gives up on a slow receiver', async () => {
    expect((await postWebhook(`${url}/redirect`, '{}', {}, { allowPrivate: true })).status).toBe(
      302,
    )
    await expect(
      postWebhook(`${url}/slow`, '{}', {}, { allowPrivate: true, timeoutMs: 200 }),
    ).rejects.toThrow(/No answer within/)
  })
})
