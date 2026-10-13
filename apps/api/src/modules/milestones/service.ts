import type { CreateMilestoneRequest, Milestone, UpdateMilestoneRequest } from '@chilladesk/shared'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import type { Db, Executor } from '../../db/client'
import { milestones, statuses, tasks } from '../../db/schema'
import { conflict, invalid, isUniqueViolation, notFound } from '../../errors'
import { getProject } from '../projects/service'

/** Milestones one project can have, open and closed together. */
export const MAX_MILESTONES = 100

const nameTaken = (name: string) => conflict(`A milestone named "${name}" already exists`)

const inProject = (projectId: string, milestoneId: string) =>
  and(eq(milestones.projectId, projectId), eq(milestones.id, milestoneId))

/** For tasks: confirms that the milestone belongs to the project. */
export async function assertMilestoneOfProject(
  db: Executor,
  projectId: string,
  milestoneId: string | null | undefined,
): Promise<void> {
  if (!milestoneId) return
  const [found] = await db
    .select({ id: milestones.id })
    .from(milestones)
    .where(inProject(projectId, milestoneId))
  if (!found) throw invalid('milestoneId must be a milestone of this project')
}

/**
 * Milestones with how far each is: open ones first, the nearest date on top, undated last;
 * then the closed ones.
 */
async function loadMilestones(
  db: Executor,
  projectId: string,
  milestoneId?: string,
): Promise<Milestone[]> {
  const rows = await db
    .select({
      milestone: milestones,
      total: count(tasks.id),
      done: sql<number>`count(${tasks.id}) filter (where ${statuses.category} = 'done')`.mapWith(
        Number,
      ),
    })
    .from(milestones)
    .leftJoin(tasks, eq(tasks.milestoneId, milestones.id))
    .leftJoin(statuses, eq(statuses.id, tasks.statusId))
    .where(milestoneId ? inProject(projectId, milestoneId) : eq(milestones.projectId, projectId))
    .groupBy(milestones.id)
    .orderBy(
      sql`${milestones.closedAt} is not null`,
      sql`${milestones.dueDate} asc nulls last`,
      asc(milestones.name),
    )
  return rows.map(({ milestone, done, total }) => ({
    id: milestone.id,
    name: milestone.name,
    dueDate: milestone.dueDate,
    closed: milestone.closedAt !== null,
    progress: { done, total },
  }))
}

export async function listMilestones(
  db: Db,
  userId: string,
  projectId: string,
): Promise<Milestone[]> {
  await getProject(db, userId, projectId)
  return loadMilestones(db, projectId)
}

async function loadMilestone(db: Executor, projectId: string, id: string): Promise<Milestone> {
  const [milestone] = await loadMilestones(db, projectId, id)
  if (!milestone) throw notFound('Milestone')
  return milestone
}

export async function createMilestone(
  db: Db,
  userId: string,
  projectId: string,
  input: CreateMilestoneRequest,
): Promise<Milestone> {
  await getProject(db, userId, projectId, 'member')
  const [existing] = await db
    .select({ total: count() })
    .from(milestones)
    .where(eq(milestones.projectId, projectId))
  if ((existing?.total ?? 0) >= MAX_MILESTONES) {
    throw conflict('This project has too many milestones, delete some first')
  }
  try {
    const [created] = await db
      .insert(milestones)
      .values({ projectId, name: input.name, dueDate: input.dueDate })
      .returning({ id: milestones.id })
    if (!created) throw new Error('Insert returned no milestone row')
    return await loadMilestone(db, projectId, created.id)
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken(input.name)
    throw error
  }
}

export async function updateMilestone(
  db: Db,
  userId: string,
  projectId: string,
  milestoneId: string,
  { closed, ...fields }: UpdateMilestoneRequest,
  now: Date = new Date(),
): Promise<Milestone> {
  await getProject(db, userId, projectId, 'member')
  try {
    const [updated] = await db
      .update(milestones)
      .set({
        ...fields,
        ...(closed === undefined ? {} : { closedAt: closed ? now : null }),
      })
      .where(inProject(projectId, milestoneId))
      .returning({ id: milestones.id })
    if (!updated) throw notFound('Milestone')
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken(fields.name ?? '')
    throw error
  }
  return loadMilestone(db, projectId, milestoneId)
}

/** Deletes a milestone; its tasks stay and simply have none any more. */
export async function deleteMilestone(
  db: Db,
  userId: string,
  projectId: string,
  milestoneId: string,
): Promise<void> {
  await getProject(db, userId, projectId, 'member')
  const removed = await db
    .delete(milestones)
    .where(inProject(projectId, milestoneId))
    .returning({ id: milestones.id })
  if (removed.length === 0) throw notFound('Milestone')
}
