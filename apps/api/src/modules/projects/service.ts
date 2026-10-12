import type {
  AddMemberRequest,
  CreateProjectRequest,
  Project,
  ProjectMember,
  ProjectRole,
  UpdateProjectRequest,
} from '@chillawiki/shared'
import { and, asc, eq } from 'drizzle-orm'
import type { Db, Tx } from '../../db/client'
import { notifications, projectMembers, projects, tasks, users } from '../../db/schema'
import { conflict, forbidden, isUniqueViolation, notFound } from '../../errors'
import { createDefaultStatuses } from '../tasks/statuses.service'

const ROLE_RANK: Record<ProjectRole, number> = { viewer: 0, member: 1, owner: 2 }

type ProjectRow = typeof projects.$inferSelect

function toProject(row: ProjectRow, role: ProjectRole): Project {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    role,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

const memberColumns = {
  userId: users.id,
  email: users.email,
  name: users.name,
  role: projectMembers.role,
  joinedAt: projectMembers.createdAt,
}

function toMember(row: {
  userId: string
  email: string
  name: string
  role: ProjectRole
  joinedAt: Date
}): ProjectMember {
  return { ...row, joinedAt: row.joinedAt.toISOString() }
}

export async function listProjects(db: Db, userId: string): Promise<Project[]> {
  const rows = await db
    .select({ project: projects, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(eq(projectMembers.userId, userId))
    .orderBy(asc(projects.name))
  return rows.map((row) => toProject(row.project, row.role))
}

export async function createProject(
  db: Db,
  userId: string,
  input: CreateProjectRequest,
): Promise<Project> {
  try {
    return await db.transaction(async (tx) => {
      const [project] = await tx.insert(projects).values(input).returning()
      if (!project) throw new Error('Insert returned no project row')
      await tx.insert(projectMembers).values({ projectId: project.id, userId, role: 'owner' })
      await createDefaultStatuses(tx, project.id)
      return toProject(project, 'owner')
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict(`Project key "${input.key}" is already taken`)
    throw error
  }
}

/**
 * Loads a project the user belongs to and checks their role.
 * Non-members get NOT_FOUND rather than FORBIDDEN so project ids cannot be probed.
 */
export async function getProject(
  db: Db,
  userId: string,
  projectId: string,
  minimumRole: ProjectRole = 'viewer',
): Promise<Project> {
  const [row] = await db
    .select({ project: projects, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
  if (!row) throw notFound('Project')
  if (ROLE_RANK[row.role] < ROLE_RANK[minimumRole]) {
    throw forbidden(`This action requires the ${minimumRole} role`)
  }
  return toProject(row.project, row.role)
}

export async function updateProject(
  db: Db,
  userId: string,
  projectId: string,
  patch: UpdateProjectRequest,
): Promise<Project> {
  await getProject(db, userId, projectId, 'owner')
  const [updated] = await db
    .update(projects)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(projects.id, projectId))
    .returning()
  if (!updated) throw notFound('Project')
  return toProject(updated, 'owner')
}

export async function deleteProject(db: Db, userId: string, projectId: string): Promise<void> {
  await getProject(db, userId, projectId, 'owner')
  await db.delete(projects).where(eq(projects.id, projectId))
}

export async function listMembers(
  db: Db,
  userId: string,
  projectId: string,
): Promise<ProjectMember[]> {
  await getProject(db, userId, projectId)
  const rows = await db
    .select(memberColumns)
    .from(projectMembers)
    .innerJoin(users, eq(users.id, projectMembers.userId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(projectMembers.createdAt), asc(users.email))
  return rows.map(toMember)
}

export async function addMember(
  db: Db,
  userId: string,
  projectId: string,
  input: AddMemberRequest,
): Promise<ProjectMember> {
  await getProject(db, userId, projectId, 'owner')
  const [invitee] = await db.select().from(users).where(eq(users.email, input.email.toLowerCase()))
  if (!invitee) throw notFound('User with this email')

  try {
    const [membership] = await db
      .insert(projectMembers)
      .values({ projectId, userId: invitee.id, role: input.role })
      .returning()
    if (!membership) throw new Error('Insert returned no membership row')
    return toMember({
      userId: invitee.id,
      email: invitee.email,
      name: invitee.name,
      role: membership.role,
      joinedAt: membership.createdAt,
    })
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('This user is already a member of the project')
    throw error
  }
}

// Locks the project's owner rows so two concurrent demotions cannot both pass the check.
async function assertNotLastOwner(tx: Tx, projectId: string, targetId: string): Promise<void> {
  const owners = await tx
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.role, 'owner')))
    .for('update')
  if (owners.length === 1 && owners[0]?.userId === targetId) {
    throw conflict('A project must keep at least one owner')
  }
}

const membershipOf = (projectId: string, memberId: string) =>
  and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, memberId))

export async function updateMemberRole(
  db: Db,
  userId: string,
  projectId: string,
  memberId: string,
  role: ProjectRole,
): Promise<ProjectMember> {
  await getProject(db, userId, projectId, 'owner')
  return db.transaction(async (tx) => {
    if (role !== 'owner') await assertNotLastOwner(tx, projectId, memberId)
    const [updated] = await tx
      .update(projectMembers)
      .set({ role })
      .where(membershipOf(projectId, memberId))
      .returning()
    if (!updated) throw notFound('Member')

    const [row] = await tx
      .select(memberColumns)
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(membershipOf(projectId, memberId))
    if (!row) throw notFound('Member')
    return toMember(row)
  })
}

/** Owners can remove anyone; any member can remove themselves (leave the project). */
export async function removeMember(
  db: Db,
  userId: string,
  projectId: string,
  memberId: string,
): Promise<void> {
  await getProject(db, userId, projectId, memberId === userId ? 'viewer' : 'owner')
  await db.transaction(async (tx) => {
    await assertNotLastOwner(tx, projectId, memberId)
    const removed = await tx
      .delete(projectMembers)
      .where(membershipOf(projectId, memberId))
      .returning()
    if (removed.length === 0) throw notFound('Member')
    // Someone outside the project cannot be responsible for its tasks.
    await tx
      .update(tasks)
      .set({ assigneeId: null })
      .where(and(eq(tasks.projectId, projectId), eq(tasks.assigneeId, memberId)))
    // Their notifications quote the project's tasks and pages, which are no longer theirs to read.
    await tx
      .delete(notifications)
      .where(and(eq(notifications.projectId, projectId), eq(notifications.userId, memberId)))
  })
}
