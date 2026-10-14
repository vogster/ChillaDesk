import type { LiveEvent, Task } from '@chilladesk/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, type TestContext, type TestUser } from '../../test/harness'
import type { Relay } from '../../db/client'
import { createEventBus, type Subscriber } from './bus'
import { resourceOfRoute } from './routes'

const PROJECT = '33333333-3333-4333-8333-333333333333'

function subscriber(userId: string) {
  const received: LiveEvent[] = []
  const state = { closed: false }
  const self: Subscriber = {
    userId,
    send: (event) => void received.push(event),
    close: () => {
      state.closed = true
    },
  }
  return { self, received, state }
}

describe('event bus', () => {
  const everyone = (_projectId: string, userIds: string[]) => Promise.resolve(userIds)

  it('delivers a project change to its connected members only, on all their streams', async () => {
    const asked: string[][] = []
    const bus = createEventBus({
      membersAmong: async (_projectId, userIds) => {
        asked.push(userIds)
        return userIds.filter((userId) => userId !== 'outsider')
      },
    })
    const [first, second, outsider] = [subscriber('ann'), subscriber('ann'), subscriber('outsider')]
    for (const item of [first, second, outsider]) bus.subscribe(item.self)

    await bus.publishProject(PROJECT, 'tasks')

    const event = { type: 'project_changed', projectId: PROJECT, resource: 'tasks' }
    expect([first.received, second.received, outsider.received]).toEqual([[event], [event], []])
    expect(asked).toEqual([['ann', 'outsider']])
  })

  it('asks nobody when no one is connected and stops after unsubscribing', async () => {
    let lookups = 0
    const bus = createEventBus({
      membersAmong: (projectId, userIds) => {
        lookups += 1
        return everyone(projectId, userIds)
      },
    })
    const ann = subscriber('ann')

    const unsubscribe = bus.subscribe(ann.self)
    unsubscribe()
    await bus.publishProject(PROJECT, 'tasks')

    expect(bus.size).toBe(0)
    expect(lookups).toBe(0)
    expect(ann.received).toEqual([])
  })

  it('tells chosen users that their access changed', () => {
    const bus = createEventBus({ membersAmong: everyone })
    const [ann, bob] = [subscriber('ann'), subscriber('bob')]
    bus.subscribe(ann.self)
    bus.subscribe(bob.self)

    bus.publishAccessChange(['bob', 'nobody-connected'])

    expect([ann.received, bob.received]).toEqual([[], [{ type: 'access_changed' }]])
  })

  it('counts the streams of each user', () => {
    const bus = createEventBus({ membersAmong: everyone })
    const stop = bus.subscribe(subscriber('ann').self)
    bus.subscribe(subscriber('ann').self)
    bus.subscribe(subscriber('bob').self)

    expect([bus.countOf('ann'), bus.countOf('bob'), bus.countOf('cy')]).toEqual([2, 1, 0])
    stop()
    expect(bus.countOf('ann')).toBe(1)
  })

  it('closes every stream on shutdown', () => {
    const bus = createEventBus({ membersAmong: everyone })
    const [ann, bob] = [subscriber('ann'), subscriber('bob')]
    bus.subscribe(ann.self)
    bus.subscribe(bob.self)

    bus.closeAll()

    expect(bus.size).toBe(0)
    expect([ann.state.closed, bob.state.closed]).toEqual([true, true])
  })

  it('reports a failed delivery instead of throwing', async () => {
    const errors: unknown[] = []
    const failure = new Error('database is gone')
    const bus = createEventBus({
      membersAmong: () => Promise.reject(failure),
      onError: (error) => errors.push(error),
    })
    bus.subscribe(subscriber('ann').self)

    await expect(bus.publishProject(PROJECT, 'wiki')).resolves.toBeUndefined()

    expect(errors).toEqual([failure])
  })
})

describe('event bus across replicas', () => {
  const everyone = (_projectId: string, userIds: string[]) => Promise.resolve(userIds)
  const ANN = '11111111-1111-4111-8111-111111111111'
  const BOB = '22222222-2222-4222-8222-222222222222'

  /** A stand-in for LISTEN/NOTIFY: every listener hears every message, in order. */
  function memoryRelay() {
    const listeners = new Set<(payload: string) => void>()
    const sent: string[] = []
    let failing = false
    const relay: Relay = {
      publish: async (payload) => {
        if (failing) throw new Error('database gone')
        sent.push(payload)
        for (const listener of listeners) listener(payload)
      },
      subscribe: async (handler) => {
        listeners.add(handler)
        return async () => void listeners.delete(handler)
      },
    }
    return {
      relay,
      sent,
      fail: () => (failing = true),
      heard: (payload: string) => listeners.forEach((l) => l(payload)),
    }
  }

  const settle = () => new Promise((resolve) => setTimeout(resolve, 10))

  it('delivers a change made through one replica to streams open on another', async () => {
    const shared = memoryRelay()
    const first = createEventBus({ membersAmong: everyone, relay: shared.relay })
    const second = createEventBus({ membersAmong: everyone, relay: shared.relay })
    await first.connect()
    await second.connect()
    const [onFirst, onSecond] = [subscriber(ANN), subscriber(BOB)]
    first.subscribe(onFirst.self)
    second.subscribe(onSecond.self)

    await first.publishProject(PROJECT, 'wiki')
    second.publishAccessChange([ANN])
    await settle()

    const changed = { type: 'project_changed', projectId: PROJECT, resource: 'wiki' }
    expect(onFirst.received).toEqual([changed, { type: 'access_changed' }])
    expect(onSecond.received).toEqual([changed])
  })

  it('splits a long list of people into notifications PostgreSQL accepts', async () => {
    const shared = memoryRelay()
    const bus = createEventBus({ membersAmong: everyone, relay: shared.relay })
    await bus.connect()
    const many = Array.from(
      { length: 500 },
      (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    )
    const last = subscriber(many.at(-1) ?? '')
    bus.subscribe(last.self)

    bus.publishAccessChange(many)
    await settle()

    expect(shared.sent.length).toBeGreaterThan(1)
    expect(shared.sent.every((payload) => Buffer.byteLength(payload) <= 7900)).toBe(true)
    expect(last.received).toEqual([{ type: 'access_changed' }])
  })

  it('tells its own streams when the relay fails, and ignores messages it cannot read', async () => {
    const shared = memoryRelay()
    const errors: unknown[] = []
    const bus = createEventBus({
      membersAmong: everyone,
      relay: shared.relay,
      onError: (error) => errors.push(error),
    })
    const ann = subscriber(ANN)
    bus.subscribe(ann.self)

    // Not listening yet: delivered here directly.
    await bus.publishProject(PROJECT, 'tasks')
    expect(shared.sent).toEqual([])
    await bus.connect()
    shared.heard('not json')
    shared.heard(JSON.stringify({ p: 'not-an-id', r: 'tasks' }))
    shared.fail()
    await bus.publishProject(PROJECT, 'labels')

    expect(ann.received.map((event) => 'resource' in event && event.resource)).toEqual([
      'tasks',
      'labels',
    ])
    expect(errors).toHaveLength(3)
  })
})

describe('events of the API', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await createTestContext({ eventStreamLifetimeMs: 400 })
  })

  afterAll(async () => {
    await ctx.close()
  })

  function listen(user: TestUser) {
    const { self, received } = subscriber(user.id)
    const stop = ctx.app.events.subscribe(self)
    return { received, stop }
  }

  it('announces a change to the members of the project and to nobody else', async () => {
    const fixture = await ctx.createProject()
    const [member, viewer, outsider] = [fixture.member, fixture.viewer, fixture.outsider].map(
      listen,
    )

    await fixture.call(fixture.owner, 'POST', '/tasks', { title: 'New' })

    const event = { type: 'project_changed', projectId: fixture.project.id, resource: 'tasks' }
    await expect.poll(() => member?.received).toEqual([event])
    expect(viewer?.received).toEqual([event])
    expect(outsider?.received).toEqual([])
    for (const listener of [member, viewer, outsider]) listener?.stop()
  })

  it('announces changes to tasks, comments, columns, labels, wiki, members and settings', async () => {
    const fixture = await ctx.createProject()
    const task = (
      await fixture.call(fixture.owner, 'POST', '/tasks', { title: 'Subject' })
    ).json<Task>()
    const member = listen(fixture.member)
    const steps: [Parameters<typeof fixture.call>[1], string, Record<string, unknown>?][] = [
      ['PATCH', `/tasks/${task.id}`, { title: 'Renamed' }],
      ['POST', `/tasks/${task.id}/comments`, { body: 'Hello' }],
      ['POST', '/statuses', { name: 'Review', category: 'in_progress' }],
      ['POST', '/labels', { name: 'bug', color: 'red' }],
      ['POST', '/wiki', { title: 'Home', content: '' }],
      ['PATCH', `/members/${fixture.viewer.id}`, { role: 'member' }],
      ['PATCH', '', { name: 'Renamed project', description: '' }],
    ]

    for (const [method, path, payload] of steps) {
      const response = await fixture.call(fixture.owner, method, path, payload)
      expect(response.statusCode, `${method} ${path}: ${response.body}`).toBeLessThan(300)
    }

    await expect.poll(() => member.received.length).toBe(steps.length)
    expect(
      member.received.map((event) => ('resource' in event ? event.resource : event.type)),
    ).toEqual(['tasks', 'tasks', 'statuses', 'labels', 'wiki', 'members', 'project'])
    member.stop()
  })

  it('tells everyone who was in a deleted project, and nobody else', async () => {
    const fixture = await ctx.createProject()
    const [owner, member, outsider] = [fixture.owner, fixture.member, fixture.outsider].map(listen)

    await fixture.call(fixture.owner, 'DELETE', '')

    const lost = [{ type: 'access_changed' }]
    await expect.poll(() => member?.received).toEqual(lost)
    expect(owner?.received).toEqual(lost)
    expect(outsider?.received).toEqual([])
    for (const listener of [owner, member, outsider]) listener?.stop()
  })

  it('tells someone who is added to a project or removed from it', async () => {
    const fixture = await ctx.createProject()
    const [member, outsider] = [fixture.member, fixture.outsider].map(listen)
    const access = (events: { type: string }[] = []) =>
      events.filter((event) => event.type === 'access_changed').length

    await fixture.call(fixture.owner, 'POST', '/members', {
      email: fixture.outsider.email,
      role: 'viewer',
    })
    await expect.poll(() => access(outsider?.received)).toBe(1)

    await fixture.call(fixture.owner, 'DELETE', `/members/${fixture.member.id}`)
    await expect.poll(() => access(member?.received)).toBe(1)
    // The one who stays only hears that the member list changed.
    expect(access(outsider?.received)).toBe(1)

    await fixture.call(fixture.viewer, 'DELETE', `/members/${fixture.owner.id}`)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(access(member?.received)).toBe(1)
    for (const listener of [member, outsider]) listener?.stop()
  })

  it('stays silent about reads and about requests that failed', async () => {
    const fixture = await ctx.createProject()
    const member = listen(fixture.member)

    await fixture.call(fixture.owner, 'GET', '/tasks')
    await fixture.call(fixture.owner, 'POST', '/tasks', { title: '' })
    await fixture.call(fixture.viewer, 'POST', '/tasks', { title: 'Not allowed' })
    await fixture.call(fixture.outsider, 'POST', '/tasks', { title: 'Not a member' })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(member.received).toEqual([])
    member.stop()
  })

  it('streams the events to a signed-in client until the stream is ended', async () => {
    const fixture = await ctx.createProject()
    const before = ctx.app.events.size

    const stream = ctx.request(fixture.member, 'GET', '/api/events')
    await expect.poll(() => ctx.app.events.size).toBe(before + 1)
    await fixture.call(fixture.owner, 'POST', '/tasks', { title: 'Pushed' })
    const response = await stream

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/event-stream; charset=utf-8')
    expect(response.body).toContain('retry: 3000\n\n')
    expect(response.body).toContain(
      `data: {"type":"project_changed","projectId":"${fixture.project.id}","resource":"tasks"}\n\n`,
    )
    expect(ctx.app.events.size).toBe(before)
  })

  it('refuses one more stream to a user who already has too many open', async () => {
    const user = await ctx.signUp()
    const held = Array.from({ length: 10 }, () =>
      ctx.app.events.subscribe({ userId: user.id, send: () => undefined, close: () => undefined }),
    )

    const refused = await ctx.request(user, 'GET', '/api/events')
    held.forEach((stop) => stop())

    expect(refused.statusCode).toBe(429)
    expect(refused.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })
  })

  it('refuses a client that is not signed in', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/api/events' })

    expect(response.statusCode).toBe(401)
    expect(response.json()).toMatchObject({ error: { code: 'UNAUTHENTICATED' } })
  })
})

describe('resourceOfRoute', () => {
  it('names the part of the project a route changes', () => {
    const base = '/api/projects/:projectId'

    expect(resourceOfRoute(`${base}/tasks/:taskId/move`)).toBe('tasks')
    expect(resourceOfRoute(`${base}/wiki/:pageId`)).toBe('wiki')
    expect(resourceOfRoute(`${base}/members/:userId`)).toBe('members')
    expect(resourceOfRoute(base)).toBe('project')
    expect(resourceOfRoute(`${base}/something-new`)).toBe('project')
    expect(resourceOfRoute('')).toBe('project')
  })
})

describe('shutdown', () => {
  it('ends open streams so the server can close', async () => {
    const ctx = await createTestContext()
    const user = await ctx.signUp()
    const stream = ctx.request(user, 'GET', '/api/events')
    await expect.poll(() => ctx.app.events.size).toBe(1)

    await ctx.close()

    expect((await stream).statusCode).toBe(200)
    expect(ctx.app.events.size).toBe(0)
  })

  it('sends a heartbeat on a quiet stream', async () => {
    const { eventRoutes } = await import('./routes')
    const { default: Fastify } = await import('fastify')
    const app = Fastify()
    app.decorateRequest('auth', null)
    app.addHook('onRequest', async (request) => {
      request.auth = { user: { id: 'ann' } } as never
    })
    const events = createEventBus({ membersAmong: (_id, userIds) => Promise.resolve(userIds) })
    await app.register(eventRoutes, { events, heartbeatMs: 20, maxLifetimeMs: 120 })

    const response = await app.inject({ method: 'GET', url: '/' })
    await app.close()

    expect(response.body).toContain(': ping\n\n')
  })
})
