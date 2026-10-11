import type { ErrorCode, ErrorResponse } from '@chillawiki/shared'

const STATUS_BY_CODE = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ErrorCode, number>

/** An expected failure whose message is safe to show to the client. */
export class AppError extends Error {
  readonly statusCode: number

  constructor(
    readonly code: ErrorCode,
    message: string,
    /** Which part of the request the error is about, for clients that react to it. */
    readonly details?: NonNullable<ErrorResponse['error']['details']>,
  ) {
    super(message)
    this.name = 'AppError'
    this.statusCode = STATUS_BY_CODE[code]
  }
}

/** A request that is well-formed but refers to something it may not, e.g. a foreign id. */
export const invalid = (message: string) => new AppError('VALIDATION_ERROR', message)
export const unauthenticated = (message = 'Authentication required') =>
  new AppError('UNAUTHENTICATED', message)
export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError('FORBIDDEN', message)
export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`)
export const conflict = (message: string, details?: AppError['details']) =>
  new AppError('CONFLICT', message, details)

// Drivers wrap the PostgreSQL error, so the SQLSTATE can sit anywhere in the cause chain.
function hasSqlState(error: unknown, sqlState: string): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ('code' in current && current.code === sqlState) return true
  }
  return false
}

/** PostgreSQL unique_violation, as reported by both postgres-js and PGlite. */
export const isUniqueViolation = (error: unknown) => hasSqlState(error, '23505')

/** PostgreSQL foreign_key_violation. */
export const isForeignKeyViolation = (error: unknown) => hasSqlState(error, '23503')
