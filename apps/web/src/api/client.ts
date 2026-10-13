import { errorResponseSchema, type ErrorCode, type ErrorResponse } from '@chilladesk/shared'
import type { z } from 'zod'
import { currentMessages } from '../i18n/messages'

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
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
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
  const { errors } = currentMessages().common
  if (!(error instanceof ApiError)) return errors.generic
  // The server answers in English: its text is translated where a translation is known,
  // else replaced by a general one for that kind of error, else shown as it came.
  const general = errors.byCode[error.code as keyof typeof errors.byCode] as string | undefined
  return errors.serverText(error.message) ?? (general || error.message)
}
