import { localeSchema } from '@chilladesk/shared'
import { and, eq, gt, isNull, lte } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { apiTokens, emailTokens, sessions, users } from '../../db/schema'
import { AppError, conflict } from '../../errors'
import type { SendMail } from '../notifications/mailer'
import { passwordResetEmail, verificationEmail } from './emails'
import { hashPassword } from './password'
import { generateToken, hashToken } from './tokens'

/** What the API needs to write to people; absent when the server has no SMTP settings. */
export interface AccountMail {
  send: SendMail
  /** Where people open ChillaDesk; the links in emails start with it. */
  publicUrl: string
}

type EmailTokenKind = 'verify' | 'reset'

const TTL_MS: Record<EmailTokenKind, number> = {
  verify: 48 * 60 * 60 * 1000,
  reset: 60 * 60 * 1000,
}

/**
 * A reset link is not replaced within this time of being sent. Otherwise anyone who knows
 * an address could keep invalidating the link its owner is about to click.
 */
const RESET_REISSUE_AFTER_MS = 60 * 1000

type UserRow = typeof users.$inferSelect

/** A fresh token of this kind for the user; an older one stops working. */
async function issueToken(
  db: Db,
  userId: string,
  kind: EmailTokenKind,
  now: Date,
): Promise<string> {
  const { token, tokenHash } = generateToken()
  await db.transaction(async (tx) => {
    // Expired links of anyone are swept along, so the table does not grow without bound.
    await tx.delete(emailTokens).where(lte(emailTokens.expiresAt, now))
    await tx
      .delete(emailTokens)
      .where(and(eq(emailTokens.userId, userId), eq(emailTokens.kind, kind)))
    await tx.insert(emailTokens).values({
      userId,
      kind,
      tokenHash,
      createdAt: now,
      expiresAt: new Date(now.getTime() + TTL_MS[kind]),
    })
  })
  return token
}

function accountEmail(user: UserRow, mail: AccountMail, page: string, token: string) {
  const locale = localeSchema.safeParse(user.locale)
  return {
    to: user.email,
    locale: locale.success ? locale.data : ('en' as const),
    // In the fragment, so the token is not sent to the server with the page request and
    // stays out of its logs.
    link: `${mail.publicUrl.replace(/\/+$/, '')}/${page}#token=${token}`,
  }
}

/** One answer for unknown, used and expired links, and for links of somebody else. */
const invalidLink = () =>
  new AppError('VALIDATION_ERROR', 'This link is not valid any more, ask for a new one')

/** Emails the user a link that proves the address is theirs. */
export async function sendVerification(
  db: Db,
  mail: AccountMail,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  if (!user) return
  if (user.emailVerifiedAt) throw conflict('This email address is confirmed already')
  const token = await issueToken(db, user.id, 'verify', now)
  await mail.send(verificationEmail(accountEmail(user, mail, 'verify-email', token)))
}

/**
 * Uses up a token. `ownerId` limits it to the tokens of one user.
 * Deleting is the check: of two requests with the same token only one gets the row.
 */
async function consumeToken(
  db: Pick<Db, 'delete'>,
  token: string,
  kind: EmailTokenKind,
  now: Date,
  ownerId?: string,
): Promise<string> {
  const [used] = await db
    .delete(emailTokens)
    .where(
      and(
        eq(emailTokens.tokenHash, hashToken(token)),
        eq(emailTokens.kind, kind),
        gt(emailTokens.expiresAt, now),
        ownerId ? eq(emailTokens.userId, ownerId) : undefined,
      ),
    )
    .returning({ userId: emailTokens.userId })
  if (!used) throw invalidLink()
  return used.userId
}

/**
 * Confirms the address of the signed-in user. The link alone is not enough: someone who
 * registered another person's address must not get "their" account confirmed just because
 * that person clicked a link in an email they did not expect.
 */
export async function verifyEmail(
  db: Db,
  userId: string,
  token: string,
  now: Date = new Date(),
): Promise<void> {
  await consumeToken(db, token, 'verify', now, userId)
  await db
    .update(users)
    .set({ emailVerifiedAt: now })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)))
}

/**
 * Emails a link for choosing a new password, if the address belongs to an account.
 * Says nothing either way, so it cannot be used to find out who has an account.
 */
export async function requestPasswordReset(
  db: Db,
  mail: AccountMail,
  email: string,
  now: Date = new Date(),
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase()))
  if (!user) return
  const [recent] = await db
    .select({ id: emailTokens.id })
    .from(emailTokens)
    .where(
      and(
        eq(emailTokens.userId, user.id),
        eq(emailTokens.kind, 'reset'),
        gt(emailTokens.createdAt, new Date(now.getTime() - RESET_REISSUE_AFTER_MS)),
      ),
    )
  if (recent) return
  const token = await issueToken(db, user.id, 'reset', now)
  await mail.send(passwordResetEmail(accountEmail(user, mail, 'reset-password', token)))
}

/**
 * Sets a new password with a link from the email and cuts off every other way into the
 * account: sessions, personal API tokens and pending links. Whoever had access with the
 * old password, or made a token while they had it, loses it.
 */
export async function resetPassword(
  db: Db,
  token: string,
  newPassword: string,
  now: Date = new Date(),
): Promise<void> {
  const passwordHash = await hashPassword(newPassword)
  await db.transaction(async (tx) => {
    const userId = await consumeToken(tx, token, 'reset', now)
    const [user] = await tx.select().from(users).where(eq(users.id, userId))
    await tx
      .update(users)
      // The link arrived at this address, which also proves that it is theirs.
      .set({ passwordHash, emailVerifiedAt: user?.emailVerifiedAt ?? now })
      .where(eq(users.id, userId))
    await tx.delete(sessions).where(eq(sessions.userId, userId))
    await tx.delete(apiTokens).where(eq(apiTokens.userId, userId))
    await tx.delete(emailTokens).where(eq(emailTokens.userId, userId))
  })
}
