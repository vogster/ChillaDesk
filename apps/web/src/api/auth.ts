import {
  authResponseSchema,
  userSchema,
  type LoginRequest,
  type RegisterRequest,
  type User,
} from '@chillawiki/shared'
import { ApiError, apiRequest } from './client'

/** Resolves to null when nobody is signed in. */
export async function fetchCurrentUser(): Promise<User | null> {
  try {
    return await apiRequest('/auth/me', { schema: userSchema })
  } catch (error) {
    if (error instanceof ApiError && error.code === 'UNAUTHENTICATED') return null
    throw error
  }
}

// The session itself travels in an HTTP-only cookie, so the token in the body is not kept.
export async function login(input: LoginRequest): Promise<User> {
  const session = await apiRequest('/auth/login', {
    method: 'POST',
    body: input,
    schema: authResponseSchema,
  })
  return session.user
}

export async function register(input: RegisterRequest): Promise<User> {
  const session = await apiRequest('/auth/register', {
    method: 'POST',
    body: input,
    schema: authResponseSchema,
  })
  return session.user
}

export function logout(): Promise<void> {
  return apiRequest('/auth/logout', { method: 'POST' })
}
