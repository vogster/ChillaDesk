import type { RegistrationMode } from '@chilladesk/shared'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { Executor } from '../../db/client'
import { projectInvites, projectMembers, users } from '../../db/schema'
import { forbidden } from '../../errors'
import { hashToken } from './tokens'

/** Whether anyone has an account yet; until then a server for invited people is open. */
export async function anyAccount(db: Executor): Promise<boolean> {
  const [account] = await db
    .select({ id: users.id })
    .from(users)
    .where(isNull(users.pendingSince))
    .limit(1)
  return account !== undefined
}

/** The invite a link stands for, if the link is still good. */
async function validInviteId(db: Executor, token: string, now: Date): Promise<string | null> {
  const [invite] = await db
    .select({ id: projectInvites.id })
    .from(projectInvites)
    .where(and(eq(projectInvites.tokenHash, hashToken(token)), gt(projectInvites.expiresAt, now)))
  return invite?.id ?? null
}

/**
 * Whether this sign-up may go ahead on a server with these rules, and the invite it came
 * with, if any: a server open to everyone takes anyone, one that signs people up by
 * invitation only wants a link that still works (except for the first account of all), a
 * closed one takes nobody.
 */
export async function mayRegister(
  db: Executor,
  mode: RegistrationMode,
  inviteToken: string | undefined,
  now: Date = new Date(),
): Promise<{ inviteId: string | null }> {
  if (mode === 'closed') throw forbidden('Registration is disabled on this server')
  const inviteId = inviteToken ? await validInviteId(db, inviteToken, now) : null
  // The very first account needs no invite: on a new server there is nobody to send one.
  if (mode === 'invite' && !inviteId && (await anyAccount(db))) {
    throw forbidden('Registration is by invitation only; open the invite link you were sent')
  }
  return { inviteId }
}

/**
 * Makes the user a member of the project the invite is for, in its role, if the invite
 * still works. Someone who is in the project already keeps their role.
 */
export async function joinByInvite(
  db: Executor,
  userId: string,
  inviteId: string,
  now: Date = new Date(),
): Promise<void> {
  const [invite] = await db
    .select({ projectId: projectInvites.projectId, role: projectInvites.role })
    .from(projectInvites)
    .where(and(eq(projectInvites.id, inviteId), gt(projectInvites.expiresAt, now)))
  if (!invite) return
  await db
    .insert(projectMembers)
    .values({ projectId: invite.projectId, userId, role: invite.role })
    .onConflictDoNothing()
}
