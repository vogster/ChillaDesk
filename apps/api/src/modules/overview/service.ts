import {
  SEARCH_RESULTS_MAX,
  type MyTasksQuery,
  type SearchResults,
  type TaskInContext,
  type WikiSearchHit,
} from '@chilladesk/shared'
import { and, desc, eq, ilike, ne, or, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { containsPattern } from '../../db/like'
import { projectMembers, projects, statuses, tasks, wikiPages } from '../../db/schema'
import { findTasksOfUser } from '../tasks/service'

const MY_TASKS_MAX = 200

/** Tasks assigned to the user in the projects they belong to: what to work on next. */
export function listMyTasks(
  db: Db,
  userId: string,
  { includeDone }: MyTasksQuery,
): Promise<TaskInContext[]> {
  return findTasksOfUser(db, userId, {
    where: and(
      eq(tasks.assigneeId, userId),
      includeDone ? undefined : ne(statuses.category, 'done'),
    ),
    orderBy: [
      sql`${tasks.dueDate} asc nulls last`,
      // The priority enum is declared from low to urgent.
      desc(tasks.priority),
      desc(tasks.updatedAt),
    ],
    limit: MY_TASKS_MAX,
  })
}

const TASK_KEY = /^([A-Za-z][A-Za-z0-9]{1,9})-([1-9]\d{0,8})$/

function searchTasks(db: Db, userId: string, q: string): Promise<TaskInContext[]> {
  const pattern = containsPattern(q)
  const key = TASK_KEY.exec(q)
  const byKey =
    key?.[1] && key[2]
      ? and(eq(projects.key, key[1].toUpperCase()), eq(tasks.number, Number(key[2])))
      : undefined
  const inTitle = ilike(tasks.title, pattern)

  return findTasksOfUser(db, userId, {
    where: or(byKey, inTitle, ilike(tasks.description, pattern)),
    orderBy: [desc(sql`${inTitle}`), desc(tasks.updatedAt)],
    limit: SEARCH_RESULTS_MAX,
  })
}

async function searchPages(db: Db, userId: string, q: string): Promise<WikiSearchHit[]> {
  const pattern = containsPattern(q)
  const inTitle = ilike(wikiPages.title, pattern)
  const rows = await db
    .select({
      id: wikiPages.id,
      title: wikiPages.title,
      updatedAt: wikiPages.updatedAt,
      project: { id: projects.id, key: projects.key, name: projects.name },
    })
    .from(wikiPages)
    .innerJoin(projects, eq(projects.id, wikiPages.projectId))
    // The membership join is what limits results to the user's own projects.
    .innerJoin(
      projectMembers,
      and(eq(projectMembers.projectId, wikiPages.projectId), eq(projectMembers.userId, userId)),
    )
    .where(or(inTitle, ilike(wikiPages.content, pattern)))
    .orderBy(desc(sql`${inTitle}`), desc(wikiPages.updatedAt))
    .limit(SEARCH_RESULTS_MAX)
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }))
}

/** Searches tasks and wiki pages of every project the user belongs to. */
export async function search(db: Db, userId: string, q: string): Promise<SearchResults> {
  const [foundTasks, pages] = await Promise.all([
    searchTasks(db, userId, q),
    searchPages(db, userId, q),
  ])
  return { tasks: foundTasks, pages }
}
