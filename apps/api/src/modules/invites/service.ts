import {
  localeSchema,
  type AddMemberRequest,
  type CreatedInvite,
  type CreateInviteRequest,
  type InvitePreview,
  type InviteRole,
  type Project,
  type ProjectInvite,
} from '@chilladesk/shared'
import { and, asc, count, eq, gt, lte } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { projectInvites, projectMembers, projects, users } from '../../db/schema'
import { AppError, conflict, invalid, notFound } from '../../errors'
import type { AccountMail } from '../auth/email-flows'
import { projectInviteEmail } from '../auth/emails'
import { generateToken, hashToken } from '../auth/tokens'
import { getProject } from '../projects/service'

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** Links one project can have open at a time; more than a handful means they are forgotten. */
export const MAX_INVITES_PER_PROJECT = 20

type InviteRow = typeof projectInvites.$inferSelect

function toInvite(row: InviteRow): ProjectInvite {
  return {
    id: row.id,
    // The column shares the role enum with members; an invite is never created as owner.
    role: row.role as InviteRole,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }
}

const active = (projectId: string, now: Date) =>
  and(eq(projectInvites.projectId, projectId), gt(projectInvites.expiresAt, now))

/** The invite links of a project that still work. Owners only. */
export async function listInvites(
  db: Db,
  userId: string,
  projectId: string,
  now: Date = new Date(),
): Promise<ProjectInvite[]> {
  await getProject(db, userId, projectId, 'owner')
  const rows = await db
    .select()
    .from(projectInvites)
    .where(active(projectId, now))
    .orderBy(asc(projectInvites.createdAt))
  return rows.map(toInvite)
}

export async function createInvite(
  db: Db,
  userId: string,
  projectId: string,
  input: CreateInviteRequest,
  now: Date = new Date(),
): Promise<CreatedInvite> {
  await getProject(db, userId, projectId, 'owner')
  const { token, tokenHash } = generateToken()

  return db.transaction(async (tx) => {
    // Serialises invite creation per project, so the limit below cannot be raced past.
    await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('no key update')
    await tx
      .delete(projectInvites)
      .where(and(eq(projectInvites.projectId, projectId), lte(projectInvites.expiresAt, now)))
    const [open] = await tx
      .select({ total: count() })
      .from(projectInvites)
      .where(eq(projectInvites.projectId, projectId))
    if ((open?.total ?? 0) >= MAX_INVITES_PER_PROJECT) {
      throw conflict('This project has too many invite links, revoke some first')
    }

    const [created] = await tx
      .insert(projectInvites)
      .values({
        projectId,
        role: input.role,
        tokenHash,
        createdBy: userId,
        expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
      })
      .returning()
    if (!created) throw new Error('Insert returned no invite row')
    return { ...toInvite(created), token }
  })
}

export async function revokeInvite(
  db: Db,
  userId: string,
  projectId: string,
  inviteId: string,
): Promise<void> {
  await getProject(db, userId, projectId, 'owner')
  const removed = await db
    .delete(projectInvites)
    .where(and(eq(projectInvites.id, inviteId), eq(projectInvites.projectId, projectId)))
    .returning({ id: projectInvites.id })
  if (removed.length === 0) throw notFound('Invite')
}

/** One answer for unknown, revoked and expired links: none of them says which it was. */
const invalidInvite = () => new AppError('NOT_FOUND', 'This invite link is not valid any more')

async function findInvite(db: Db, token: string, now: Date) {
  const [found] = await db
    .select({ invite: projectInvites, project: projects })
    .from(projectInvites)
    .innerJoin(projects, eq(projects.id, projectInvites.projectId))
    .where(and(eq(projectInvites.tokenHash, hashToken(token)), gt(projectInvites.expiresAt, now)))
  if (!found) throw invalidInvite()
  return found
}

async function roleOf(db: Db, projectId: string, userId: string) {
  const [membership] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
  return membership?.role ?? null
}

/** What the holder of a link is about to join. The name of the project is all it reveals. */
export async function previewInvite(
  db: Db,
  userId: string,
  token: string,
  now: Date = new Date(),
): Promise<InvitePreview> {
  const { invite, project } = await findInvite(db, token, now)
  return {
    project: { id: project.id, key: project.key, name: project.name },
    role: invite.role as InviteRole,
    alreadyMember: (await roleOf(db, project.id, userId)) !== null,
  }
}

export interface AcceptedInvite {
  project: Project
  /** False when the user was a member already and nothing changed. */
  joined: boolean
}

/**
 * Makes the user a member with the role of the link. Someone who is a member already
 * keeps the role they have: a link must not demote an owner or promote a viewer.
 */
export async function acceptInvite(
  db: Db,
  userId: string,
  token: string,
  now: Date = new Date(),
): Promise<AcceptedInvite> {
  const { projectId, joined } = await db.transaction(async (tx) => {
    // Locked until the member row is written, so revoking the link at the same moment
    // either comes first and wins, or waits and finds the person already inside.
    const [invite] = await tx
      .select({ projectId: projectInvites.projectId, role: projectInvites.role })
      .from(projectInvites)
      .where(and(eq(projectInvites.tokenHash, hashToken(token)), gt(projectInvites.expiresAt, now)))
      .for('share')
    if (!invite) throw invalidInvite()
    const inserted = await tx
      .insert(projectMembers)
      .values({ projectId: invite.projectId, userId, role: invite.role })
      .onConflictDoNothing()
      .returning({ role: projectMembers.role })
    return { projectId: invite.projectId, joined: inserted.length > 0 }
  })

  return { project: await getProject(db, userId, projectId), joined }
}

/**
 * Adds someone by email on a server that sends email: an invite link goes to the address,
 * whether or not it has an account, so the answer does not tell who is registered. The
 * email is sent in the background; `onError` hears if it fails. Someone already in the
 * project is refused, which the owner can see in the member list anyway.
 */
export async function inviteByEmail(
  db: Db,
  mail: AccountMail,
  userId: string,
  projectId: string,
  input: AddMemberRequest,
  {
    now = new Date(),
    allowEmail,
    onError,
  }: {
    now?: Date
    /** Whether this address may get another email now. */
    allowEmail?: (email: string) => Promise<boolean>
    onError?: (error: unknown) => void
  } = {},
): Promise<void> {
  await getProject(db, userId, projectId, 'owner')
  const { role } = input
  if (role === 'owner') {
    throw invalid('Invite as a member or viewer, then make them an owner once they joined')
  }
  const email = input.email.toLowerCase()
  const [member] = await db
    .select({ id: users.id })
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(and(eq(projectMembers.projectId, projectId), eq(users.email, email)))
  if (member) throw conflict('This user is already a member of the project')
  const invite = await createInvite(db, userId, projectId, { role }, now)

  void (async () => {
    if (allowEmail && !(await allowEmail(email))) return
    // In the language of the account at that address, if there is one, else the inviter's.
    const [recipient] = await db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.email, email))
    const [inviter] = await db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, userId))
    const locale = localeSchema.safeParse(recipient?.locale ?? inviter?.locale)
    await mail.send(
      projectInviteEmail({
        to: email,
        locale: locale.success ? locale.data : 'en',
        link: `${mail.publicUrl.replace(/\/+$/, '')}/invite#token=${invite.token}`,
      }),
    )
  })().catch((error: unknown) => onError?.(error))
}
