import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { Db } from '../../db/client'
import { forbidden, unauthenticated } from '../../errors'
import { authenticate, type AuthContext } from './service'

export const SESSION_COOKIE = 'cw_session'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

declare module 'fastify' {
  interface FastifyRequest {
    /** Set when the request carries a valid session token. */
    auth: AuthContext | null
  }
}

function bearerToken(request: FastifyRequest): string | undefined {
  const [scheme, token] = request.headers.authorization?.split(' ') ?? []
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined
}

// Browsers attach cookies to cross-site requests, so a cookie-authenticated write must come from
// our own origin. Bearer tokens are never sent automatically and need no such check.
function isCrossSiteWrite(request: FastifyRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return false

  // Set by the browser itself, so unlike Origin-vs-Host it survives proxies that rewrite Host.
  // `none` is a user-initiated navigation; `same-site` is another subdomain and is not trusted.
  const fetchSite = request.headers['sec-fetch-site']
  if (typeof fetchSite === 'string') return fetchSite !== 'same-origin' && fetchSite !== 'none'

  // Fallback for browsers without Fetch Metadata.
  const origin = request.headers.origin
  if (!origin) return false
  try {
    return new URL(origin).host !== request.host
  } catch {
    return true
  }
}

/** Resolves the session for every request; routes opt in to enforcement with `requireAuth`. */
export function registerAuth(app: FastifyInstance, db: Db): void {
  app.decorateRequest('auth', null)

  app.addHook('onRequest', async (request) => {
    const bearer = bearerToken(request)
    const token = bearer ?? request.cookies[SESSION_COOKIE]
    if (!token) return
    if (!bearer && isCrossSiteWrite(request)) throw forbidden('Cross-site request blocked')

    request.auth = await authenticate(db, token, { viaHeader: bearer !== undefined })

    // MCP is exempt: it reads and writes through POST, and checks the scope per tool.
    const readOnly = request.auth?.apiToken?.scope === 'read'
    if (readOnly && !SAFE_METHODS.has(request.method) && !isMcpRequest(request)) {
      throw forbidden('This API token is read-only')
    }
  })
}

export const MCP_PATH = '/api/mcp'

function isMcpRequest(request: FastifyRequest): boolean {
  const path = request.url.split('?')[0] ?? ''
  return path === MCP_PATH || path === `${MCP_PATH}/`
}

/** For actions on the account itself, which a personal API token must not be able to do. */
export function requireSession(request: FastifyRequest): AuthContext {
  const auth = requireAuth(request)
  if (auth.sessionId === null)
    throw forbidden('This action needs a signed-in session, not an API token')
  return auth
}

export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthenticated()
  return request.auth
}
