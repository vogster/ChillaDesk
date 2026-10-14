import type { ChangeEmailRequest, User } from '@chilladesk/shared'
import { and, asc, eq, gt, inArray, isNotNull, isNull, ne } from 'drizzle-orm'
import type { Db } from '../../db/client'
import {
  emailTokens,
  projectInvites,
  projectMembers,
  projects,
  sessions,
  users,
} from '../../db/schema'
import { AppError, conflict, invalid, isUniqueViolation, unauthenticated } from '../../errors'
import {
  accountEmail,
  invalidLink,
  issueToken,
  type AccountMail,
  type UserRow,
} from './email-flows'
import {
  addressTakenEmail,
  emailChangedEmail,
  emailChangeEmail,
  emailChangeRequestedEmail,
} from './emails'
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
function plainEmail(user: UserRow, mail: AccountMail, page = 'login') {
  const { to, locale } = accountEmail(user, mail, page, '')
  return { to, locale, link: `${mail.publicUrl.replace(/\/+$/, '')}/${page}` }
}

const sameAddress = () => invalid('This is the address of your account already')

/** Limits on the emails a change of address causes; checked only once the password is right. */
export interface ChangeEmailLimits {
  /** Emails this account may still cause. */
  account(): Promise<boolean>
  /** Emails that may still go to this address, whoever causes them. */
  address(email: string): Promise<boolean>
}

/**
 * Moves the account to another address. With email the new address must prove it is the
 * owner's: a link goes there, and the answer is the same whether or not the address is
 * taken (its owner is told instead). The current address hears of the request at once, so
 * someone who learned the password cannot move the account away unnoticed. Without email
 * it changes at once, unconfirmed.
 */
export async function changeEmail(
  db: Db,
  mail: AccountMail | undefined,
  userId: string,
  input: ChangeEmailRequest,
  {
    now = new Date(),
    onError,
    limits,
  }: { now?: Date; onError?: (error: unknown) => void; limits?: ChangeEmailLimits } = {},
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

  if (limits && !(await limits.account())) {
    throw new AppError('RATE_LIMITED', 'Too many emails requested, try again later')
  }
  // Not awaited: neither the answer nor its timing may tell whether the address is taken.
  void (async () => {
    await mail.send(emailChangeRequestedEmail(plainEmail(user, mail, 'profile')))
    if (limits && !(await limits.address(email))) return
    // An unfinished sign-up is nobody's account: the address counts as free.
    const [taken] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), isNull(users.pendingSince)))
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
 * account, like confirming an address. Other sessions end, and the old address is told.
 */
export async function confirmEmailChange(
  db: Db,
  mail: AccountMail,
  userId: string,
  currentSessionId: string,
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
    // The link proves the address is this person's; an unfinished sign-up of it goes.
    await tx.delete(users).where(and(eq(users.email, used.newEmail), isNotNull(users.pendingSince)))
    try {
      const [user] = await tx
        .update(users)
        .set({ email: used.newEmail, emailVerifiedAt: now })
        .where(eq(users.id, userId))
        .returning()
      if (!user) throw unauthenticated()
      // Links sent to the old address must not work any more, nor sessions elsewhere.
      await tx.delete(emailTokens).where(eq(emailTokens.userId, userId))
      await tx
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), ne(sessions.id, currentSessionId)))
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

/**
 * Deletes the account. Projects only this person was in go with it; in the others their
 * tasks, pages and comments stay, under "deleted user". A project with other people but no
 * other owner must be handed over first. Returns the projects that are left with others in
 * them, whose member lists have changed.
 */
export async function deleteAccount(db: Db, userId: string, password: string): Promise<string[]> {
  await checkedUser(db, userId, password)
  return db.transaction(async (tx) => {
    // The projects are locked before anything is decided: nobody joins them (a new member
    // row needs the project row) and no owner leaves meanwhile. Locked again for projects
    // joined while locking, until the set holds still.
    const locked = new Set<string>()
    for (let round = 0; round < 5; round += 1) {
      const memberships = await tx
        .select({ projectId: projectMembers.projectId })
        .from(projectMembers)
        .where(eq(projectMembers.userId, userId))
      const missing = memberships.map((row) => row.projectId).filter((id) => !locked.has(id))
      if (missing.length === 0) break
      await tx
        .select({ id: projects.id })
        .from(projects)
        .where(inArray(projects.id, missing))
        .orderBy(asc(projects.id))
        .for('update')
      for (const id of missing) locked.add(id)
    }
    const ids = [...locked]
    // The same lock that keeps the last owner from leaving, so two owners leaving at once
    // (one of them by deleting the account) see each other.
    const everyone =
      ids.length === 0
        ? []
        : await tx
            .select({
              projectId: projectMembers.projectId,
              userId: projectMembers.userId,
              role: projectMembers.role,
            })
            .from(projectMembers)
            .where(inArray(projectMembers.projectId, ids))
            .orderBy(asc(projectMembers.projectId), asc(projectMembers.userId))
            .for('update')

    const others = (projectId: string) =>
      everyone.filter((row) => row.projectId === projectId && row.userId !== userId)
    const ownedByMe = (projectId: string) =>
      everyone.some(
        (row) => row.projectId === projectId && row.userId === userId && row.role === 'owner',
      )
    const blocking = ids.filter(
      (id) =>
        ownedByMe(id) && others(id).length > 0 && !others(id).some((row) => row.role === 'owner'),
    )
    if (blocking.length > 0) {
      const names = await tx
        .select({ name: projects.name })
        .from(projects)
        .where(inArray(projects.id, blocking))
      throw conflict(
        'Make someone else an owner of your projects with other members first',
        names.map(({ name }) => ({ path: 'projects', message: name })),
      )
    }

    const own = ids.filter((id) => others(id).length === 0)
    if (own.length > 0) await tx.delete(projects).where(inArray(projects.id, own))
    // Invite links they made would otherwise go on letting people in.
    await tx.delete(projectInvites).where(eq(projectInvites.createdBy, userId))
    await tx.delete(sessions).where(eq(sessions.userId, userId))
    await tx.delete(users).where(eq(users.id, userId))
    return ids.filter((id) => !own.includes(id))
  })
}
