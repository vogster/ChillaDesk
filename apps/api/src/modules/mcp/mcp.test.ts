import type { CreatedApiToken } from '@chilladesk/shared'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SESSION_COOKIE } from '../auth/plugin'
import {
  createTestContext,
  type ProjectFixture,
  type TestContext,
  type TestUser,
} from '../../test/harness'
import { runTool, runToolForClient, TOOLS, type ToolContext, type ToolDefinition } from './tools'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

async function tokenFor(user: TestUser, scope: 'read' | 'write' = 'write'): Promise<string> {
  const response = await ctx.request(user, 'POST', '/api/tokens', { name: `MCP ${scope}`, scope })
  expect(response.statusCode, response.body).toBe(201)
  return response.json<CreatedApiToken>().token
}

interface RpcResponse {
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

async function rpc(token: string | null, method: string, params: Record<string, unknown> = {}) {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/api/mcp',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    payload: { jsonrpc: '2.0', id: 1, method, params },
  })
  return {
    status: response.statusCode,
    headers: response.headers,
    body: response.json<RpcResponse>(),
  }
}

/** Calls a tool and returns its parsed JSON result, or its error text. */
async function call<T = unknown>(
  token: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  const { status, body } = await rpc(token, 'tools/call', { name, arguments: args })
  expect(status, JSON.stringify(body)).toBe(200)
  const result = body.result as { isError?: boolean; content: { text: string }[] }
  const text = result.content[0]?.text ?? ''
  return result.isError ? { ok: false, message: text } : { ok: true, data: JSON.parse(text) as T }
}

async function expectData<T>(promise: ReturnType<typeof call<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new Error(`Tool failed: ${result.message}`)
  return result.data
}

async function expectError(promise: ReturnType<typeof call>): Promise<string> {
  const result = await promise
  if (result.ok) throw new Error(`Tool unexpectedly succeeded: ${JSON.stringify(result.data)}`)
  return result.message
}

interface TaskView {
  key: string
  title: string
  status: string
  priority: string
  assignee: string | null
  dueDate: string | null
  description?: string
  comments?: { author: string; body: string }[]
}

async function setup(scope: 'read' | 'write' = 'write') {
  const fixture: ProjectFixture = await ctx.createProject()
  return { fixture, key: fixture.project.key, token: await tokenFor(fixture.member, scope) }
}

describe('protocol', () => {
  it('answers initialize with the server info and usage instructions', async () => {
    const { token } = await setup()

    const { status, body } = await rpc(token, 'initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    })

    expect(status).toBe(200)
    expect(body.result).toMatchObject({
      serverInfo: { name: 'chilladesk' },
      capabilities: { tools: {} },
    })
    expect(body.result?.instructions).toContain('list_projects')
  })

  it('lists the tools with input schemas and read-only hints', async () => {
    const { token } = await setup()

    const { body } = await rpc(token, 'tools/list')

    const tools = body.result?.tools as {
      name: string
      inputSchema: { properties?: Record<string, unknown> }
      annotations: { readOnlyHint: boolean }
    }[]
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'add_comment',
      'create_task',
      'create_wiki_page',
      'get_project',
      'get_task',
      'get_wiki_page',
      'list_projects',
      'list_tasks',
      'list_wiki_pages',
      'my_tasks',
      'search',
      'update_task',
      'update_wiki_page',
    ])
    const byName = new Map(tools.map((tool) => [tool.name, tool]))
    expect(byName.get('get_task')?.annotations.readOnlyHint).toBe(true)
    expect(byName.get('create_task')?.annotations.readOnlyHint).toBe(false)
    expect(Object.keys(byName.get('create_task')?.inputSchema.properties ?? {})).toContain('title')
  })

  it('requires a token and says how to send one', async () => {
    const { status, headers, body } = await rpc(null, 'tools/list')

    expect(status).toBe(401)
    expect(headers['www-authenticate']).toBe('Bearer')
    expect(body.error?.message).toContain('Authorization: Bearer')
  })

  it('rejects a revoked token', async () => {
    const { status } = await rpc('cw_pat_revoked-or-made-up', 'tools/list')

    expect(status).toBe(401)
  })

  it('accepts only API tokens, not a browser session', async () => {
    const user = await ctx.signUp()
    const request = (extra: Record<string, unknown>) =>
      ctx.app.inject({
        method: 'POST',
        url: '/api/mcp',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
        },
        payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        ...extra,
      })

    const viaCookie = await request({ cookies: { [SESSION_COOKIE]: user.token } })
    const viaSessionBearer = await request({
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        ...user.headers,
      },
    })

    expect([viaCookie.statusCode, viaSessionBearer.statusCode]).toEqual([401, 401])
  })

  it('refuses batches, which would run many calls for one rate-limited request', async () => {
    const { token } = await setup()

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/api/mcp',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      payload: [
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ],
    })

    expect(response.statusCode).toBe(400)
    expect(response.json<RpcResponse>().error?.message).toContain('Batch')
  })

  it('does not offer an event stream', async () => {
    const { token } = await setup()

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/api/mcp',
      headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
    })

    expect(response.statusCode).toBe(405)
    expect(response.headers.allow).toBe('POST')
  })
})

describe('reading', () => {
  it('lists only the projects of the token owner', async () => {
    const { fixture, token } = await setup()
    await ctx.createProject()

    const projects = await expectData(call<{ key: string; role: string }[]>(token, 'list_projects'))

    expect(projects).toEqual([
      expect.objectContaining({ key: fixture.project.key, role: 'member' }),
    ])
  })

  it('describes a project with its statuses and members', async () => {
    const { fixture, key, token } = await setup()

    const project = await expectData(
      call<{ statuses: { name: string }[]; members: { email: string }[]; yourRole: string }>(
        token,
        'get_project',
        { project: key.toLowerCase() },
      ),
    )

    expect(project.yourRole).toBe('member')
    expect(project.statuses.map((status) => status.name)).toEqual(['To Do', 'In Progress', 'Done'])
    expect(project.members.map((member) => member.email)).toContain(fixture.owner.email)
  })

  it('hides projects the owner does not belong to', async () => {
    const { token } = await setup()
    const other = await ctx.createProject()

    const message = await expectError(call(token, 'get_project', { project: other.project.key }))

    expect(message).toContain('not found')
  })

  it('lists and filters tasks by status name, assignee email, priority and text', async () => {
    const { fixture, key, token } = await setup()
    await expectData(call(token, 'create_task', { project: key, title: 'Write docs' }))
    await expectData(
      call(token, 'create_task', {
        project: key,
        title: 'Fix login',
        status: 'in progress',
        priority: 'urgent',
        assignee: fixture.owner.email,
      }),
    )
    const titles = async (args: Record<string, unknown>) =>
      (
        await expectData(
          call<{ total: number; tasks: TaskView[] }>(token, 'list_tasks', {
            project: key,
            ...args,
          }),
        )
      ).tasks.map((task) => task.title)

    expect(await titles({})).toEqual(['Write docs', 'Fix login'])
    expect(await titles({ status: 'In Progress' })).toEqual(['Fix login'])
    expect(await titles({ assignee: fixture.owner.email })).toEqual(['Fix login'])
    expect(await titles({ assignee: 'none' })).toEqual(['Write docs'])
    expect(await titles({ priority: 'urgent' })).toEqual(['Fix login'])
    expect(await titles({ query: 'DOCS' })).toEqual(['Write docs'])
    expect(await titles({ limit: 1 })).toEqual(['Write docs'])
  })

  it('names the valid statuses when asked for an unknown one', async () => {
    const { key, token } = await setup()

    const message = await expectError(call(token, 'list_tasks', { project: key, status: 'Review' }))

    expect(message).toContain('"To Do", "In Progress", "Done"')
  })

  it('returns a task in full with its comments, by key in any case', async () => {
    const { key, token } = await setup()
    await expectData(
      call(token, 'create_task', { project: key, title: 'Readable', description: '# Details' }),
    )
    await expectData(call(token, 'add_comment', { key: `${key}-1`, body: 'First!' }))

    const task = await expectData(
      call<TaskView>(token, 'get_task', { key: `${key.toLowerCase()}-1` }),
    )

    expect(task).toMatchObject({
      key: `${key}-1`,
      title: 'Readable',
      status: 'To Do',
      description: '# Details',
    })
    expect(task.comments?.map((comment) => comment.body)).toEqual(['First!'])
  })

  it.each([
    ['a malformed key', 'not a key', 'not a task key'],
    ['an unknown number', null, 'not found'],
  ])('explains %s', async (_label, badKey, expected) => {
    const { key, token } = await setup()

    const message = await expectError(call(token, 'get_task', { key: badKey ?? `${key}-999` }))

    expect(message).toContain(expected)
  })
})

describe('writing tasks', () => {
  it('creates a task with every field resolved from names', async () => {
    const { fixture, key, token } = await setup()

    const task = await expectData(
      call<TaskView>(token, 'create_task', {
        project: key,
        title: '  Plan release ',
        description: 'Steps',
        status: 'Done',
        priority: 'high',
        assignee: fixture.viewer.email.toUpperCase(),
        dueDate: '2030-01-31',
      }),
    )

    expect(task).toMatchObject({
      key: `${key}-1`,
      title: 'Plan release',
      status: 'Done',
      priority: 'high',
      assignee: fixture.viewer.email,
      dueDate: '2030-01-31',
    })
  })

  it('updates fields, moves between statuses and clears values', async () => {
    const { fixture, key, token } = await setup()
    await expectData(
      call(token, 'create_task', {
        project: key,
        title: 'Old',
        assignee: fixture.owner.email,
        dueDate: '2030-01-31',
      }),
    )

    const updated = await expectData(
      call<TaskView>(token, 'update_task', {
        key: `${key}-1`,
        title: 'New',
        status: 'In Progress',
        assignee: null,
        dueDate: null,
      }),
    )
    const unchanged = await expectData(call<TaskView>(token, 'update_task', { key: `${key}-1` }))

    expect(updated).toMatchObject({
      title: 'New',
      status: 'In Progress',
      assignee: null,
      dueDate: null,
      priority: 'medium',
    })
    expect(unchanged).toMatchObject({ title: 'New', status: 'In Progress' })
  })

  it('changes nothing when the requested status does not exist', async () => {
    const { key, token } = await setup()
    await expectData(call(token, 'create_task', { project: key, title: 'Untouched' }))

    const message = await expectError(
      call(token, 'update_task', { key: `${key}-1`, title: 'Changed', status: 'Nowhere' }),
    )

    expect(message).toContain('Unknown status')
    const task = await expectData(call<TaskView>(token, 'get_task', { key: `${key}-1` }))
    expect(task.title).toBe('Untouched')
  })

  it('rejects input the REST API would reject, with a readable reason', async () => {
    const { fixture, key, token } = await setup()

    const outsider = await expectError(
      call(token, 'create_task', { project: key, title: 'T', assignee: fixture.outsider.email }),
    )
    const blank = await expectError(call(token, 'create_task', { project: key, title: '   ' }))
    const nul = await expectError(
      call(token, 'create_task', { project: key, title: 'Bad\u0000title' }),
    )

    expect(outsider).toContain('is not a member')
    expect(blank).toContain('Invalid input')
    expect(nul).toContain('Invalid input')
  })

  it('applies the project role of the token owner', async () => {
    const fixture = await ctx.createProject()
    const viewerToken = await tokenFor(fixture.viewer, 'write')

    const message = await expectError(
      call(viewerToken, 'create_task', { project: fixture.project.key, title: 'Nope' }),
    )

    expect(message).toContain('member role')
  })
})

describe('across projects', () => {
  it('lists the open tasks assigned to the token owner in every project', async () => {
    const { fixture, key, token } = await setup()
    const mine = fixture.member.email
    await expectData(call(token, 'create_task', { project: key, title: 'Mine', assignee: mine }))
    await expectData(
      call(token, 'create_task', { project: key, title: 'Done', assignee: mine, status: 'Done' }),
    )
    await expectData(call(token, 'create_task', { project: key, title: 'Not mine' }))
    type Mine = { project: string; title: string; status: string; description?: string }

    const open = await expectData(call<Mine[]>(token, 'my_tasks'))
    const all = await expectData(call<Mine[]>(token, 'my_tasks', { includeDone: true }))

    expect(open).toEqual([
      expect.objectContaining({ project: key, title: 'Mine', status: 'To Do' }),
    ])
    expect(open[0]).not.toHaveProperty('description')
    expect(all.map((task) => task.title).sort()).toEqual(['Done', 'Mine'])
  })

  it('searches tasks and wiki pages, and explains a query that is too short', async () => {
    const { key, token } = await setup()
    await setup()
    await expectData(call(token, 'create_task', { project: key, title: 'Rotate the API keys' }))
    await expectData(
      call(token, 'create_wiki_page', { project: key, title: 'Security', content: 'Rotate keys' }),
    )
    type Found = { tasks: { project: string; title: string }[]; wikiPages: { title: string }[] }

    const found = await expectData(call<Found>(token, 'search', { query: 'rotate' }))
    const byKey = await expectData(call<Found>(token, 'search', { query: `${key}-1` }))
    const tooShort = await expectError(call(token, 'search', { query: 'r' }))

    expect(found.tasks).toEqual([
      expect.objectContaining({ project: key, title: 'Rotate the API keys' }),
    ])
    expect(found.wikiPages.map((page) => page.title)).toEqual(['Security'])
    expect(byKey.tasks.map((task) => task.title)).toEqual(['Rotate the API keys'])
    expect(tooShort).toContain('Invalid input')
  })
})

describe('labels', () => {
  it('lists label names with the project and sets them on tasks by name', async () => {
    const { fixture, key, token } = await setup()
    for (const name of ['Bug', 'Feature']) {
      await fixture.call(fixture.member, 'POST', '/labels', { name })
    }

    const project = await expectData(
      call<{ labels: string[] }>(token, 'get_project', { project: key }),
    )
    const created = await expectData(
      call<TaskView & { labels: string[] }>(token, 'create_task', {
        project: key,
        title: 'Crash',
        labels: ['bug', 'Feature'],
      }),
    )
    const relabelled = await expectData(
      call<TaskView & { labels: string[] }>(token, 'update_task', {
        key: `${key}-1`,
        labels: ['Feature'],
      }),
    )
    const cleared = await expectData(
      call<TaskView & { labels: string[] }>(token, 'update_task', { key: `${key}-1`, labels: [] }),
    )

    expect(project.labels).toEqual(['Bug', 'Feature'])
    expect(created.labels).toEqual(['Bug', 'Feature'])
    expect(relabelled.labels).toEqual(['Feature'])
    expect(cleared.labels).toEqual([])
  })

  it('filters tasks by label and names the labels that exist when one is unknown', async () => {
    const { fixture, key, token } = await setup()
    await fixture.call(fixture.member, 'POST', '/labels', { name: 'Bug' })
    await expectData(
      call(token, 'create_task', { project: key, title: 'Labelled', labels: ['Bug'] }),
    )
    await expectData(call(token, 'create_task', { project: key, title: 'Plain' }))

    const bugs = await expectData(
      call<{ tasks: TaskView[] }>(token, 'list_tasks', { project: key, label: 'BUG' }),
    )
    const unknown = await expectError(call(token, 'list_tasks', { project: key, label: 'Nope' }))
    const unknownOnCreate = await expectError(
      call(token, 'create_task', { project: key, title: 'T', labels: ['Nope'] }),
    )

    expect(bugs.tasks.map((task) => task.title)).toEqual(['Labelled'])
    expect(unknown).toContain('This project has: "Bug"')
    expect(unknownOnCreate).toContain('Unknown label "Nope"')
  })
})

describe('read-only tokens', () => {
  it('can use read tools but none of the write tools', async () => {
    const { fixture, key } = await setup()
    const writer = await tokenFor(fixture.member, 'write')
    const reader = await tokenFor(fixture.member, 'read')
    await expectData(call(writer, 'create_task', { project: key, title: 'Existing' }))
    await expectData(call(writer, 'create_wiki_page', { project: key, title: 'Home' }))

    const read = await expectData(call<{ total: number }>(reader, 'list_tasks', { project: key }))
    const refused = await Promise.all([
      expectError(call(reader, 'create_task', { project: key, title: 'Nope' })),
      expectError(call(reader, 'update_task', { key: `${key}-1`, title: 'Nope' })),
      expectError(call(reader, 'add_comment', { key: `${key}-1`, body: 'Nope' })),
      expectError(call(reader, 'create_wiki_page', { project: key, title: 'Nope' })),
      expectError(call(reader, 'update_wiki_page', { project: key, title: 'Home', content: 'X' })),
    ])

    expect(read.total).toBe(1)
    for (const message of refused) expect(message).toContain('read-only')
    const task = await expectData(call<TaskView>(reader, 'get_task', { key: `${key}-1` }))
    expect(task).toMatchObject({ title: 'Existing', comments: [] })
  })
})

describe('tool safety net', () => {
  const context = (scope: 'read' | 'write'): ToolContext => ({
    db: ctx.database.db,
    auth: {
      user: {
        id: '00000000-0000-4000-8000-000000000000',
        email: 'x@example.com',
        name: 'X',
        locale: null,
        emailNotifications: true,
        emailVerified: false,
        createdAt: '',
      },
      sessionId: null,
      apiToken: { id: 'token', scope },
    },
  })

  it('refuses every tool that is not marked read-only to a read token', () => {
    const writeTools = TOOLS.filter((tool) => !tool.readOnly)

    expect(writeTools.length).toBeGreaterThan(0)
    for (const tool of writeTools) {
      expect(() => runTool(tool, {}, context('read')), tool.name).toThrow(/read-only/)
    }
  })

  it('marks as read-only only tools whose names say they read', () => {
    const readTools = TOOLS.filter((tool) => tool.readOnly).map((tool) => tool.name)

    // A new read-only tool has to be added here on purpose, not by a mislabelled flag.
    const readingNames = /^(list_|get_|my_tasks$|search$)/
    expect(readTools.filter((name) => !readingNames.test(name))).toEqual([])
  })

  it('hides the details of an unexpected failure from the client and logs them', async () => {
    const log = { error: vi.fn() }
    const broken: ToolDefinition = {
      name: 'broken',
      title: 'Broken',
      description: '',
      readOnly: true,
      inputSchema: {},
      run: async () => {
        throw Object.assign(new Error('Failed query: select secret params: hunter2'), {
          query: 'select secret',
          params: ['hunter2'],
          cause: new Error('connection lost'),
        })
      },
    }

    const result = await runToolForClient(broken, {}, context('write'), log)

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'Internal server error' }],
    })
    expect(JSON.stringify(result)).not.toContain('hunter2')
    expect(log.error).toHaveBeenCalledOnce()
    expect(JSON.stringify(log.error.mock.calls[0])).not.toContain('hunter2')
  })
})

describe('wiki', () => {
  interface PageView {
    title: string
    version: number
    content: string
  }

  it('creates nested pages, lists them with parents and searches content', async () => {
    const { key, token } = await setup()
    await expectData(call(token, 'create_wiki_page', { project: key, title: 'Guides' }))
    await expectData(
      call(token, 'create_wiki_page', {
        project: key,
        title: 'Deploy',
        content: 'Run docker compose up',
        parent: 'guides',
      }),
    )

    const all = await expectData(
      call<{ title: string; parent: string | null }[]>(token, 'list_wiki_pages', { project: key }),
    )
    const found = await expectData(
      call<{ title: string; parent: string | null }[]>(token, 'list_wiki_pages', {
        project: key,
        query: 'DOCKER',
      }),
    )

    expect(all.map(({ title, parent }) => ({ title, parent }))).toEqual([
      { title: 'Deploy', parent: 'Guides' },
      { title: 'Guides', parent: null },
    ])
    expect(found).toEqual([expect.objectContaining({ title: 'Deploy', parent: 'Guides' })])
  })

  it('reads a page by title in any case and reports a missing one', async () => {
    const { key, token } = await setup()
    await expectData(
      call(token, 'create_wiki_page', { project: key, title: 'Roadmap', content: 'Q1: ship' }),
    )

    const page = await expectData(
      call<PageView>(token, 'get_wiki_page', { project: key, title: 'ROADMAP' }),
    )
    const missing = await expectError(call(token, 'get_wiki_page', { project: key, title: 'Nope' }))

    expect(page).toMatchObject({ title: 'Roadmap', version: 1, content: 'Q1: ship' })
    expect(missing).toContain('not found')
  })

  it('updates a page, keeping history, and refuses a stale base version', async () => {
    const { key, token } = await setup()
    await expectData(
      call(token, 'create_wiki_page', { project: key, title: 'Notes', content: 'v1' }),
    )

    const second = await expectData(
      call<PageView>(token, 'update_wiki_page', {
        project: key,
        title: 'Notes',
        content: 'v2',
        baseVersion: 1,
      }),
    )
    const stale = await expectError(
      call(token, 'update_wiki_page', {
        project: key,
        title: 'Notes',
        content: 'late',
        baseVersion: 1,
      }),
    )
    const renamed = await expectData(
      call<PageView>(token, 'update_wiki_page', { project: key, title: 'Notes', newTitle: 'Log' }),
    )

    expect(second).toMatchObject({ version: 2, content: 'v2' })
    expect(stale).toContain('changed by someone else')
    expect(renamed).toMatchObject({ title: 'Log', version: 3, content: 'v2' })
  })

  it('rejects a title the wiki does not allow and a duplicate title', async () => {
    const { key, token } = await setup()
    await expectData(call(token, 'create_wiki_page', { project: key, title: 'Home' }))

    const brackets = await expectError(
      call(token, 'create_wiki_page', { project: key, title: 'Bad [title]' }),
    )
    const duplicate = await expectError(
      call(token, 'create_wiki_page', { project: key, title: 'home' }),
    )

    expect(brackets).toContain('Invalid input')
    expect(duplicate).toContain('already exists')
  })
})

describe('unexpected failures', () => {
  it('reports an unknown tool as a protocol error', async () => {
    const { token } = await setup()

    const { body } = await rpc(token, 'tools/call', { name: 'drop_database', arguments: {} })

    const failed =
      body.error !== undefined || (body.result as { isError?: boolean } | undefined)?.isError
    expect(failed).toBe(true)
    expect(JSON.stringify(body)).toContain('drop_database')
  })

  it('rejects arguments of the wrong type before running the tool', async () => {
    const { key, token } = await setup()

    const { body } = await rpc(token, 'tools/call', {
      name: 'list_tasks',
      arguments: { project: key, limit: 'many' },
    })

    const failed =
      body.error !== undefined || (body.result as { isError?: boolean } | undefined)?.isError
    expect(failed).toBe(true)
  })
})

describe('live updates', () => {
  it('announces what a write tool changed, and nothing for a read', async () => {
    const { fixture, key, token } = await setup()
    const received: unknown[] = []
    const stop = ctx.app.events.subscribe({
      userId: fixture.owner.id,
      send: (event) => void received.push(event),
      close: () => undefined,
    })
    const title = 'Made by an assistant'

    await expectData(call(token, 'list_tasks', { project: key }))
    await expectData(call(token, 'create_task', { project: key, title }))
    await expectData(call(token, 'update_task', { key: `${key}-1` }))
    await expectData(call(token, 'update_task', { key: `${key}-1`, priority: 'high' }))
    await expectData(call(token, 'add_comment', { key: `${key}-1`, body: 'Done' }))
    await expectData(call(token, 'create_wiki_page', { project: key, title: 'Notes' }))
    await expectData(
      call(token, 'update_wiki_page', { project: key, title: 'Notes', content: 'x' }),
    )

    await expect
      .poll(() => (received as { resource: string }[]).map((event) => event.resource))
      .toEqual(['tasks', 'tasks', 'tasks', 'wiki', 'wiki'])
    stop()
  })
})
