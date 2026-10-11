import type { ErrorCode } from '@chillawiki/shared'

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
export const conflict = (message: string) => new AppError('CONFLICT', message)

/** PostgreSQL unique_violation, as reported by both postgres-js and PGlite. */
export function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ('code' in current && current.code === '23505') return true
  }
  return false
}
