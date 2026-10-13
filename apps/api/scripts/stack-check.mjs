// End-to-end check of a running ChillaDesk stack (e.g. `docker compose up`), including the
// concurrent operations that the unit tests cannot exercise on their single-connection database.
// Usage: node scripts/stack-check.mjs [http://localhost:8080]   (or: pnpm --filter @chilladesk/api stack-check)
// It registers throwaway accounts, so run it against a disposable instance.
import { randomBytes } from 'node:crypto'
import process from 'node:process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const base = (process.argv[2] ?? 'http://localhost:8080').replace(/\/$/, '')
const run = randomBytes(4).toString('hex')
const failures = []

function check(name, ok, detail = '') {
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`)
  if (!ok) failures.push(name)
}

/** A signed-in browser-like client: keeps the session cookie between requests. */
function createClient() {
  let cookie = ''
  return async function call(method, path, body, headers = {}) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.status === 429) {
      throw new Error(
        'Rate limited (HTTP 429). This check makes about 150 requests; wait a minute or raise RATE_LIMIT_MAX.',
      )
    }
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) cookie = setCookie.split(';')[0] ?? ''
    const text = await response.text()
    return {
      status: response.status,
      headers: response.headers,
      data: text ? JSON.parse(text) : null,
    }
  }
}

async function signUp(label) {
  const call = createClient()
  const email = `${label}-${run}@example.test`
  const password = randomBytes(12).toString('hex')
  const response = await call('POST', '/auth/register', {
    email,
    name: `${label} ${run}`,
    password,
  })
  if (response.status !== 201) throw new Error(`register failed: ${response.status}`)
  return { call, email, id: response.data.user.id, setCookie: response.headers.get('set-cookie') }
}

const statuses = (results) =>
  results
    .map((result) => result.status)
    .sort()
    .join(',')

// ---- the proxy and the basics ----
const page = await fetch(`${base}/`)
check('web UI is served', page.status === 200 && (await page.text()).includes('<div id="root">'))
check(
  'security headers on the UI',
  page.headers.get('x-content-type-options') === 'nosniff' &&
    page.headers.get('x-frame-options') === 'DENY',
)
const spa = await fetch(`${base}/projects/some/deep/link`)
check('deep links fall back to the app', spa.status === 200)
const health = await fetch(`${base}/api/health`)
check(
  'API health through the proxy',
  health.status === 200 && (await health.json()).database === 'up',
)
check('API responses are not cached', health.headers.get('cache-control') === 'no-store')
check('API docs are served', (await fetch(`${base}/api/docs/json`)).status === 200)

const owner = await signUp('owner')
const member = await signUp('member')
check(
  'session cookie is HttpOnly and SameSite=Lax',
  /HttpOnly/i.test(owner.setCookie) && /SameSite=Lax/i.test(owner.setCookie),
)

const key = `S${run.slice(0, 5).toUpperCase()}`
const project = (await owner.call('POST', '/projects', { name: `Stack check ${run}`, key })).data
const p = `/projects/${project.id}`
await owner.call('POST', `${p}/members`, { email: member.email, role: 'member' })
const columns = (await owner.call('GET', `${p}/statuses`)).data
check('new project has three columns', columns.length === 3)
const [, doing, done] = columns.map((column) => column.id)

// ---- concurrency on a real multi-connection database ----
const created = await Promise.all(
  Array.from({ length: 20 }, (_unused, index) =>
    (index % 2 ? owner : member).call('POST', `${p}/tasks`, { title: `Task ${index}` }),
  ),
)
const numbers = created.map((result) => result.data?.number).sort((a, b) => a - b)
check(
  '20 tasks created at once get numbers 1..20',
  created.every((result) => result.status === 201) &&
    numbers.every((number, index) => number === index + 1),
  statuses(created),
)

const tasks = created.map((result) => result.data)
const moves = await Promise.all(
  tasks.map((task, index) =>
    (index % 2 ? owner : member).call('POST', `${p}/tasks/${task.id}/move`, { statusId: doing }),
  ),
)
const afterMoves = (await owner.call('GET', `${p}/tasks?statusId=${doing}`)).data.items
const positions = afterMoves.map((task) => task.position)
check(
  '20 concurrent moves to one column leave 20 distinct positions',
  moves.every((result) => result.status === 200) && new Set(positions).size === 20,
  `${new Set(positions).size} distinct`,
)

const target = afterMoves[10]
const squeeze = await Promise.all(
  afterMoves
    .filter((task) => task.id !== target.id)
    .slice(0, 12)
    .map((task) =>
      owner.call('POST', `${p}/tasks/${task.id}/move`, {
        statusId: doing,
        beforeTaskId: target.id,
      }),
    ),
)
const afterSqueeze = (await owner.call('GET', `${p}/tasks?statusId=${doing}`)).data.items
check(
  '12 concurrent moves before the same task keep positions distinct',
  squeeze.every((result) => result.status === 200) &&
    new Set(afterSqueeze.map((task) => task.position)).size === 20,
  statuses(squeeze),
)

const mixed = await Promise.all([
  owner.call('DELETE', `${p}/statuses/${done}`),
  ...tasks
    .slice(0, 6)
    .map((task) => member.call('POST', `${p}/tasks/${task.id}/move`, { statusId: done })),
])
const columnsAfter = (await owner.call('GET', `${p}/statuses`)).data
const inDone = columnsAfter.some((column) => column.id === done)
  ? (await owner.call('GET', `${p}/tasks?statusId=${done}`)).data.total
  : 0
check(
  'deleting a column while tasks move into it never errors with 500 or loses tasks',
  mixed.every((result) => [200, 204, 400, 409].includes(result.status)) &&
    (await owner.call('GET', `${p}/tasks`)).data.total === 20 &&
    inDone > 0 === columnsAfter.some((column) => column.id === done),
  statuses(mixed),
)

// Empty every column, then race deleting all of them: the board must keep exactly one.
for (const task of tasks) await owner.call('DELETE', `${p}/tasks/${task.id}`)
const everyColumn = (await owner.call('GET', `${p}/statuses`)).data.map((column) => column.id)
const deletions = await Promise.all(
  everyColumn.map((id) => owner.call('DELETE', `${p}/statuses/${id}`)),
)
const remaining = (await owner.call('GET', `${p}/statuses`)).data
check(
  'deleting every column at once leaves exactly one',
  remaining.length === 1 && deletions.every((result) => [204, 409].includes(result.status)),
  `${remaining.length} left, ${statuses(deletions)}`,
)

const [a, b] = (
  await Promise.all(
    ['A', 'B'].map((title) => owner.call('POST', `${p}/wiki`, { title: `Page ${title}` })),
  )
).map((result) => result.data)
const cycle = await Promise.all([
  owner.call('PATCH', `${p}/wiki/${a.id}`, { parentId: b.id, baseVersion: 1 }),
  member.call('PATCH', `${p}/wiki/${b.id}`, { parentId: a.id, baseVersion: 1 }),
])
const pages = (await owner.call('GET', `${p}/wiki`)).data
const parentOf = new Map(pages.map((item) => [item.id, item.parentId]))
check(
  'two opposite wiki moves at once cannot make a parent loop',
  statuses(cycle) === '200,400' && !(parentOf.get(a.id) === b.id && parentOf.get(b.id) === a.id),
  statuses(cycle),
)

const edits = await Promise.all(
  [owner, member].map((user, index) =>
    user.call('PATCH', `${p}/wiki/${a.id}`, { content: `Edit ${index}`, baseVersion: 1 }),
  ),
)
check(
  'two simultaneous edits of a page: one wins, one is told',
  statuses(edits) === '200,409',
  statuses(edits),
)

// ---- API tokens and MCP, as an assistant would use them ----
const writer = (await owner.call('POST', '/tokens', { name: 'stack-check', scope: 'write' })).data
const reader = (await owner.call('POST', '/tokens', { name: 'stack-check ro', scope: 'read' })).data
const bearer = (token) => ({ Authorization: `Bearer ${token}` })
const anonymous = createClient()
check(
  'read token cannot write over REST',
  (await anonymous('POST', `${p}/tasks`, { title: 'Nope' }, bearer(reader.token))).status === 403,
)
check(
  'no token can delete the project',
  (await anonymous('DELETE', p, undefined, bearer(writer.token))).status === 403,
)

const mcp = new Client({ name: 'stack-check', version: '1.0.0' })
await mcp.connect(
  new StreamableHTTPClientTransport(new URL(`${base}/api/mcp`), {
    requestInit: { headers: bearer(writer.token) },
  }),
)
const { tools } = await mcp.listTools()
check('MCP lists its tools', tools.length === 13, `${tools.length} tools`)
const viaMcp = await mcp.callTool({
  name: 'create_task',
  arguments: { project: key, title: 'Created by the stack check', priority: 'high' },
})
const createdTask = JSON.parse(viaMcp.content[0].text)
check('MCP creates a task', !viaMcp.isError && createdTask.key === `${key}-21`, createdTask.key)
const got = await mcp.callTool({ name: 'get_task', arguments: { key: createdTask.key } })
check('MCP reads it back', JSON.parse(got.content[0].text).priority === 'high')
await mcp.close()

// ---- clean up what can be cleaned up ----
await owner.call('DELETE', `/tokens/${writer.id}`)
await owner.call('DELETE', `/tokens/${reader.id}`)
check('project can be deleted', (await owner.call('DELETE', p)).status === 204)

process.stdout.write(
  failures.length ? `\n${failures.length} check(s) failed\n` : '\nAll checks passed\n',
)
process.exit(failures.length ? 1 : 0)
