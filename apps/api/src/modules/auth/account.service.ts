import type { ChangeEmailRequest, User } from '@chilladesk/shared'
import { and, count, eq, gt, inArray, ne } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { emailTokens, projectMembers, projects, sessions, users } from '../../db/schema'
import { AppError, conflict, invalid, isUniqueViolation, unauthenticated } from '../../errors'
import {
  accountEmail,
  invalidLink,
  issueToken,
  type AccountMail,
  type UserRow,
} from './email-flows'
import { addressTakenEmail, emailChangedEmail, emailChangeEmail } from './emails'
import { verifyPassword } from './password'
import { hashToken } from './tokens'
import { toUser } from './service'

const wrongPassword = () => {
  const message = 'The password is wrong'
  return new AppError('VALIDATION_ERROR', message, [{ path: 'password', message }])
}

async function checkedUser(db: Db, userId: string, password: string): Promise<UserRow> {
  const [user] = await db.select().from(users).where(eq(users.id, userId))
  if (!user) throw unauthenticated()
  if (!(await verifyPassword(password, user.passwordHash))) throw wrongPassword()
  return user
}

/** An email to the account's address that links to the login page. */
function plainEmail(user: UserRow, mail: AccountMail) {
  const { to, locale } = accountEmail(user, mail, 'login', '')
  return { to, locale, link: `${mail.publicUrl.replace(/\/+$/, '')}/login` }
}

const sameAddress = () => invalid('This is the address of your account already')

/**
 * Moves the account to another address. With email the new address must prove it is the
 * owner's: a link goes there, and the answer is the same whether or not the address is
 * taken (its owner is told instead). Without email it changes at once, unconfirmed.
 */
export async function changeEmail(
  db: Db,
  mail: AccountMail | undefined,
  userId: string,
  input: ChangeEmailRequest,
  { now = new Date(), onError }: { now?: Date; onError?: (error: unknown) => void } = {},
): Promise<{ user: User } | { confirmationSent: true }> {
  const user = await checkedUser(db, userId, input.password)
  const email = input.email.toLowerCase()
  if (email === user.email) throw sameAddress()

  if (!mail) {
    try {
      const [updated] = await db
        .update(users)
        .set({ email, emailVerifiedAt: null })
        .where(eq(users.id, userId))
        .returning()
      if (!updated) throw unauthenticated()
      return { user: toUser(updated) }
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('An account with this email already exists')
      throw error
    }
  }

  // Not awaited: neither the answer nor its timing may tell whether the address is taken.
  void (async () => {
    const [taken] = await db.select().from(users).where(eq(users.email, email))
    if (taken) {
      await mail.send(addressTakenEmail(plainEmail(taken, mail)))
      return
    }
    const token = await issueToken(db, userId, 'change', now, email)
    await mail.send(
      emailChangeEmail({ ...accountEmail(user, mail, 'confirm-email', token), to: email }),
    )
  })().catch((error: unknown) => onError?.(error))
  return { confirmationSent: true }
}

/**
 * Makes the address from a change link the account's. Only for the signed-in owner of the
 * account, like confirming an address. The old address is told, so a change made by
 * someone who learned the password does not go unnoticed.
 */
export async function confirmEmailChange(
  db: Db,
  mail: AccountMail,
  userId: string,
  token: string,
  now: Date = new Date(),
): Promise<User> {
  const [before] = await db.select().from(users).where(eq(users.id, userId))
  if (!before) throw unauthenticated()
  const updated = await db.transaction(async (tx) => {
    const [used] = await tx
      .delete(emailTokens)
      .where(
        and(
          eq(emailTokens.tokenHash, hashToken(token)),
          eq(emailTokens.kind, 'change'),
          eq(emailTokens.userId, userId),
          gt(emailTokens.expiresAt, now),
        ),
      )
      .returning({ newEmail: emailTokens.newEmail })
    if (!used?.newEmail) throw invalidLink()
    try {
      const [user] = await tx
        .update(users)
        .set({ email: used.newEmail, emailVerifiedAt: now })
        .where(eq(users.id, userId))
        .returning()
      if (!user) throw unauthenticated()
      // Links sent to the old address must not work any more.
      await tx.delete(emailTokens).where(eq(emailTokens.userId, userId))
      return user
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('An account with this email already exists')
      throw error
    }
  })
  // Not awaited: the change is made whether or not the old address can be reached.
  void mail.send(emailChangedEmail(plainEmail(before, mail))).catch(() => undefined)
  return toUser(updated)
}

/** Projects that would be left without an owner, though other people are in them. */
async function projectsNeedingAnOwner(db: Db, userId: string): Promise<string[]> {
  const owned = await db
    .select({ id: projects.id, name: projects.name })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.userId, userId), eq(projectMembers.role, 'owner')))
  if (owned.length === 0) return []
  const ids = owned.map((project) => project.id)
  const others = await db
    .select({ projectId: projectMembers.projectId, role: projectMembers.role, total: count() })
    .from(projectMembers)
    .where(and(inArray(projectMembers.projectId, ids), ne(projectMembers.userId, userId)))
    .groupBy(projectMembers.projectId, projectMembers.role)
  return owned
    .filter((project) => {
      const rows = others.filter((row) => row.projectId === project.id)
      return rows.length > 0 && !rows.some((row) => row.role === 'owner')
    })
    .map((project) => project.name)
}

/**
 * Deletes the account. Projects only this person was in go with it; in the others their
 * tasks, pages and comments stay, under "deleted user". A project with other people but no
 * other owner must be handed over first.
 */
export async function deleteAccount(db: Db, userId: string, password: string): Promise<void> {
  await checkedUser(db, userId, password)
  await db.transaction(async (tx) => {
    // Locked, so nobody joins or is made owner between the check and the delete.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update')
    const blocking = await projectsNeedingAnOwner(tx, userId)
    if (blocking.length > 0) {
      throw conflict(
        'Make someone else an owner of your projects with other members first',
        blocking.map((name) => ({ path: 'projects', message: name })),
      )
    }
    const alone = await tx
      .select({ id: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, userId))
    const ids = alone.map((row) => row.id)
    if (ids.length > 0) {
      const shared = await tx
        .select({ projectId: projectMembers.projectId })
        .from(projectMembers)
        .where(and(inArray(projectMembers.projectId, ids), ne(projectMembers.userId, userId)))
      const sharedIds = new Set(shared.map((row) => row.projectId))
      const own = ids.filter((id) => !sharedIds.has(id))
      if (own.length > 0) await tx.delete(projects).where(inArray(projects.id, own))
    }
    await tx.delete(sessions).where(eq(sessions.userId, userId))
    await tx.delete(users).where(eq(users.id, userId))
  })
}
