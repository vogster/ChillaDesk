import type { CreatedApiToken } from '@chilladesk/shared'
import { expect } from 'vitest'
import type { TestContext, TestUser } from './harness'

export interface RpcResponse {
  result?: Record<string, unknown>
  error?: { code: number; message: string }
}

export type ToolCallResult<T> = { ok: true; data: T } | { ok: false; message: string }

/**
 * Talks to the MCP endpoint of a test app the way a client would. `context` is read on each
 * call, so the helpers can be made before the test context exists.
 */
export function mcpClient(context: () => TestContext) {
  async function tokenFor(user: TestUser, scope: 'read' | 'write' = 'write'): Promise<string> {
    const response = await context().request(user, 'POST', '/api/tokens', {
      name: `MCP ${scope}`,
      scope,
    })
    expect(response.statusCode, response.body).toBe(201)
    return response.json<CreatedApiToken>().token
  }

  async function rpc(token: string | null, method: string, params: Record<string, unknown> = {}) {
    const response = await context().app.inject({
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
  ): Promise<ToolCallResult<T>> {
    const { status, body } = await rpc(token, 'tools/call', { name, arguments: args })
    expect(status, JSON.stringify(body)).toBe(200)
    const result = body.result as { isError?: boolean; content: { text: string }[] }
    const text = result.content[0]?.text ?? ''
    return result.isError ? { ok: false, message: text } : { ok: true, data: JSON.parse(text) as T }
  }

  async function expectData<T>(promise: Promise<ToolCallResult<T>>): Promise<T> {
    const result = await promise
    if (!result.ok) throw new Error(`Tool failed: ${result.message}`)
    return result.data
  }

  async function expectError(promise: Promise<ToolCallResult<unknown>>): Promise<string> {
    const result = await promise
    if (result.ok) throw new Error(`Tool unexpectedly succeeded: ${JSON.stringify(result.data)}`)
    return result.message
  }

  return { tokenFor, rpc, call, expectData, expectError }
}
