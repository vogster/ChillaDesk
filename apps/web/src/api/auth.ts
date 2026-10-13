import {
  authOptionsSchema,
  authResponseSchema,
  userSchema,
  type AuthOptions,
  type ChangePasswordRequest,
  type LoginRequest,
  type PasswordResetConfirm,
  type RegisterRequest,
  type UpdateProfileRequest,
  type User,
} from '@chilladesk/shared'
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

export const updateProfile = (patch: UpdateProfileRequest): Promise<User> =>
  apiRequest('/auth/me', { method: 'PATCH', body: patch, schema: userSchema })

export const changePassword = (input: ChangePasswordRequest): Promise<void> =>
  apiRequest('/auth/password', { method: 'POST', body: input })

export const fetchAuthOptions = (): Promise<AuthOptions> =>
  apiRequest('/auth/options', { schema: authOptionsSchema })

export const verifyEmail = (token: string): Promise<void> =>
  apiRequest('/auth/verify-email', { method: 'POST', body: { token } })

export const resendVerification = (): Promise<void> =>
  apiRequest('/auth/verify-email/resend', { method: 'POST' })

export const requestPasswordReset = (email: string): Promise<void> =>
  apiRequest('/auth/password-reset', { method: 'POST', body: { email } })

export const confirmPasswordReset = (input: PasswordResetConfirm): Promise<void> =>
  apiRequest('/auth/password-reset/confirm', { method: 'POST', body: input })
