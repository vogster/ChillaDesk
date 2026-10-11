import { errorResponseSchema, type ErrorCode, type ErrorResponse } from '@chillawiki/shared'
import type { z } from 'zod'

export type ApiErrorCode = ErrorCode | 'NETWORK_ERROR' | 'UNEXPECTED_RESPONSE'

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details: NonNullable<ErrorResponse['error']['details']> = [],
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Validates the response body; omit for endpoints that answer 204. */
  schema?: z.ZodType<T>
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

/** Calls the API with the session cookie and turns every failure into an `ApiError`. */
export async function apiRequest<T = void>(
  path: string,
  { method = 'GET', body, schema }: RequestOptions<T> = {},
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Cannot reach the server. Check your connection.', 0)
  }

  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(await readJson(response))
    if (parsed.success) {
      const { code, message, details } = parsed.data.error
      throw new ApiError(code, message, response.status, details)
    }
    throw new ApiError(
      'UNEXPECTED_RESPONSE',
      `Server error (HTTP ${response.status})`,
      response.status,
    )
  }

  if (!schema) return undefined as T
  const parsed = schema.safeParse(await readJson(response))
  if (!parsed.success) {
    throw new ApiError(
      'UNEXPECTED_RESPONSE',
      'The server sent an unexpected response',
      response.status,
    )
  }
  return parsed.data
}

/** Message suitable for showing to the user, whatever was thrown. */
export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.'
}
