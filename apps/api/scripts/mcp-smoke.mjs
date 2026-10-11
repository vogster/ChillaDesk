// Connects to a running ChillaWiki as a real MCP client and exercises a few tools.
// Usage: CHILLAWIKI_TOKEN=cw_pat_... node scripts/mcp-smoke.mjs [http://localhost:3000/api/mcp]
import process from 'node:process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const url = new URL(process.argv[2] ?? 'http://localhost:3000/api/mcp')
const token = process.env.CHILLAWIKI_TOKEN
if (!token) {
  process.stderr.write('Set CHILLAWIKI_TOKEN to a ChillaWiki API token.\n')
  process.exit(2)
}

const client = new Client({ name: 'chillawiki-smoke', version: '1.0.0' })
await client.connect(
  new StreamableHTTPClientTransport(url, {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }),
)

const text = (result) => result.content.map((part) => part.text).join('\n')
const report = (label, value) => process.stdout.write(`${label}: ${value}\n`)

report('server', JSON.stringify(client.getServerVersion()))
const { tools } = await client.listTools()
report('tools', tools.map((tool) => tool.name).join(', '))

const projects = await client.callTool({ name: 'list_projects', arguments: {} })
report('list_projects', text(projects).replace(/\s+/g, ' '))

await client.close()
