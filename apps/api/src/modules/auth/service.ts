import {
  API_TOKEN_PREFIX,
  type ApiTokenScope,
  type AuthResponse,
  type LoginRequest,
  type RegisterRequest,
  type User,
} from '@chilladesk/shared'
import { and, eq, gt, isNull, lt, lte, or } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { apiTokens, sessions, users } from '../../db/schema'
import { conflict, forbidden, isUniqueViolation, unauthenticated } from '../../errors'
import { hashPassword, verifyPassword } from './password'
import { generateToken, hashToken } from './tokens'

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface AuthContext {
  user: User
  /** Set for a browser or mobile session; null when a personal API token was used. */
  sessionId: string | null
  /** Set when the request was made with a personal API token. */
  apiToken: { id: string; scope: ApiTokenScope } | null
}

type UserRow = typeof users.$inferSelect

function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, name: row.name, createdAt: row.createdAt.toISOString() }
}

type Executor = Pick<Db, 'insert'>

async function startSession(db: Executor, user: UserRow, now: Date): Promise<AuthResponse> {
  const { token, tokenHash } = generateToken()
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS)
  await db.insert(sessions).values({ userId: user.id, tokenHash, expiresAt })
  return { user: toUser(user), token, expiresAt: expiresAt.toISOString() }
}

export async function register(
  db: Db,
  input: RegisterRequest,
  options: { registrationEnabled: boolean; now?: Date },
): Promise<AuthResponse> {
  if (!options.registrationEnabled) {
    throw forbidden('Registration is disabled on this server')
  }

  const passwordHash = await hashPassword(input.password)
  try {
    // One transaction, so a failed session insert cannot leave an account the client never saw.
    return await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ email: input.email.toLowerCase(), name: input.name, passwordHash })
        .returning()
      if (!user) throw new Error('Insert returned no user row')
      return startSession(tx, user, options.now ?? new Date())
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('An account with this email already exists')
    throw error
  }
}

// Verified when the email is unknown, so response time does not reveal which emails exist.
const dummyHash = hashPassword('dummy-password-for-timing')

export async function login(
  db: Db,
  input: LoginRequest,
  now: Date = new Date(),
): Promise<AuthResponse> {
  const [user] = await db.select().from(users).where(eq(users.email, input.email.toLowerCase()))
  const passwordMatches = await verifyPassword(
    input.password,
    user?.passwordHash ?? (await dummyHash),
  )
  if (!user || !passwordMatches) throw unauthenticated('Invalid email or password')

  await db.delete(sessions).where(and(eq(sessions.userId, user.id), lte(sessions.expiresAt, now)))
  return startSession(db, user, now)
}

// "Last used" is for the owner's overview, so one write a minute per token is plenty.
const LAST_USED_RESOLUTION_MS = 60_000

async function authenticateApiToken(db: Db, token: string, now: Date): Promise<AuthContext | null> {
  const [row] = await db
    .select({ user: users, id: apiTokens.id, scope: apiTokens.scope })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(token)),
        or(isNull(apiTokens.expiresAt), gt(apiTokens.expiresAt, now)),
      ),
    )
  if (!row) return null

  await db
    .update(apiTokens)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(apiTokens.id, row.id),
        or(
          isNull(apiTokens.lastUsedAt),
          lt(apiTokens.lastUsedAt, new Date(now.getTime() - LAST_USED_RESOLUTION_MS)),
        ),
      ),
    )
  return { user: toUser(row.user), sessionId: null, apiToken: { id: row.id, scope: row.scope } }
}

export interface AuthenticateOptions {
  /**
   * Whether the token came in the Authorization header. Personal API tokens are refused
   * anywhere else: as a cookie they would be sent by the browser on its own.
   */
  viaHeader: boolean
  now?: Date
}

export async function authenticate(
  db: Db,
  token: string,
  { viaHeader, now = new Date() }: AuthenticateOptions,
): Promise<AuthContext | null> {
  if (token.startsWith(API_TOKEN_PREFIX)) {
    return viaHeader ? authenticateApiToken(db, token, now) : null
  }

  const [row] = await db
    .select({ user: users, sessionId: sessions.id })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, now)))
  return row ? { user: toUser(row.user), sessionId: row.sessionId, apiToken: null } : null
}

export async function logout(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId))
}
