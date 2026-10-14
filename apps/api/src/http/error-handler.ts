import { isAppPath } from './web-app'
import type { ErrorCode, ErrorResponse } from '@chilladesk/shared'
import type { FastifyError, FastifyInstance } from 'fastify'
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod'
import { AppError } from '../errors'

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
}

function body(code: ErrorCode, message: string, details?: ErrorResponse['error']['details']) {
  return { error: { code, message, ...(details ? { details } : {}) } } satisfies ErrorResponse
}

/**
 * Drizzle puts the bound parameters (emails, password hashes) into the error message,
 * so query failures are logged as the driver's own error plus the SQL text.
 */
export function loggableError(error: Error): { err: unknown; query?: string } {
  if ('params' in error && 'query' in error && typeof error.query === 'string') {
    return { err: error.cause ?? new Error('Database query failed'), query: error.query }
  }
  return { err: error }
}

/** Gives every failure the shared `{ error: { code, message } }` shape. */
export function registerErrorHandlers(
  app: FastifyInstance,
  { serveApp = false }: { serveApp?: boolean } = {},
): void {
  app.setNotFoundHandler((request, reply) => {
    // With the web app served from here, its pages are routes of the browser, not of the API.
    if (serveApp && isAppPath(request.method, request.url)) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html')
    }
    return reply
      .code(404)
      .send(body('NOT_FOUND', `Route ${request.method} ${request.url} not found`))
  })

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.statusCode).send(body(error.code, error.message, error.details))
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      const details = error.validation.map((issue) => ({
        path: issue.instancePath.replace(/^\//, '').replaceAll('/', '.'),
        message: issue.message ?? 'Invalid value',
      }))
      return reply.code(400).send(body('VALIDATION_ERROR', 'Request validation failed', details))
    }

    // Fastify's own client errors (malformed JSON, payload too large, ...) carry a 4xx status.
    const status = error.statusCode ?? 500
    if (status >= 400 && status < 500) {
      return reply
        .code(status)
        .send(body(CODE_BY_STATUS[status] ?? 'VALIDATION_ERROR', error.message))
    }

    request.log.error(loggableError(error), 'unhandled error')
    return reply.code(500).send(body('INTERNAL_ERROR', 'Internal server error'))
  })
}
