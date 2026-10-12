import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { FastifyBaseLogger, FastifyPluginAsync, FastifyReply } from 'fastify'
import packageJson from '../../../package.json' with { type: 'json' }
import type { Db } from '../../db/client'
import type { LiveResource } from '@chillawiki/shared'
import type { AuthContext } from '../auth/service'
import type { EventBus } from '../events/bus'
import { runToolForClient, TOOLS } from './tools'

function createServer(
  db: Db,
  auth: AuthContext,
  events: EventBus,
  log: FastifyBaseLogger,
): McpServer {
  const changed = (projectId: string, resource: LiveResource) =>
    void events.publishProject(projectId, resource)
  const server = new McpServer(
    { name: 'chillawiki', version: packageJson.version },
    {
      instructions:
        'ChillaWiki holds projects with tasks on a kanban board and a Markdown wiki. ' +
        'Projects are addressed by key (e.g. CHL), tasks by key (e.g. CHL-12), statuses by name, ' +
        'people by email and wiki pages by title. Start with list_projects and get_project.',
    },
  )

  for (const definition of TOOLS) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: { readOnlyHint: definition.readOnly, openWorldHint: false },
      },
      (input: unknown) => runToolForClient(definition, input, { db, auth, changed }, log),
    )
  }
  return server
}

function jsonRpcError(reply: FastifyReply, status: number, message: string) {
  return reply.code(status).send({ jsonrpc: '2.0', error: { code: -32000, message }, id: null })
}

/**
 * Model Context Protocol endpoint (Streamable HTTP), mounted at `/api/mcp`.
 *
 * Stateless: every POST gets its own server and is answered with plain JSON, so there are
 * no sessions to keep, any API replica can answer, and a revoked token stops working at once.
 */
export const mcpRoutes: FastifyPluginAsync<{ db: Db; events: EventBus }> = async (
  app,
  { db, events },
) => {
  app.post('/', { schema: { hide: true } }, async (request, reply) => {
    // Only personal API tokens: they carry a scope and can be revoked one by one. A browser
    // session has neither, and nothing in the web app needs this endpoint.
    if (!request.auth?.apiToken) {
      void reply.header('WWW-Authenticate', 'Bearer')
      return jsonRpcError(
        reply,
        401,
        'Send a ChillaWiki API token as "Authorization: Bearer <token>"',
      )
    }

    // Batches would run up to a hundred tool calls for one rate-limited request.
    if (Array.isArray(request.body)) {
      return jsonRpcError(reply, 400, 'Batch requests are not supported')
    }

    const server = createServer(db, request.auth, events, request.log)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })
    reply.raw.on('close', () => {
      void transport.close()
      void server.close()
    })

    // The transport writes the response itself, so Fastify must not send one too.
    reply.hijack()
    try {
      await server.connect(transport)
      await transport.handleRequest(request.raw, reply.raw, request.body)
    } catch (error) {
      request.log.error({ err: error }, 'MCP request failed')
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' })
        reply.raw.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          }),
        )
      }
    }
  })

  // Without sessions there is no event stream to open and nothing to delete.
  const notSupported = async (_request: unknown, reply: FastifyReply) => {
    void reply.header('Allow', 'POST')
    return jsonRpcError(reply, 405, 'This MCP endpoint is stateless; use POST')
  }
  app.get('/', { schema: { hide: true } }, notSupported)
  app.delete('/', { schema: { hide: true } }, notSupported)
}
