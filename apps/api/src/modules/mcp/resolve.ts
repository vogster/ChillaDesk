import type { Label, Project, ProjectMember, Status, Task, WikiPage } from '@chilladesk/shared'
import type { Db } from '../../db/client'
import { invalid, notFound } from '../../errors'
import { listLabels } from '../labels/service'
import { listMembers, listProjects } from '../projects/service'
import { getTaskByNumber } from '../tasks/service'
import { listStatuses } from '../tasks/statuses.service'
import { getPage, listPages } from '../wiki/service'

/**
 * Tools address things the way people do (project key, task key, status name, email, page
 * title) rather than by id. These helpers turn such a name into the record, with access
 * checked for the calling user by the underlying services.
 */

const sameText = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

export async function projectByKey(db: Db, userId: string, key: string): Promise<Project> {
  const project = (await listProjects(db, userId)).find((item) => sameText(item.key, key.trim()))
  if (!project) throw notFound(`Project "${key}"`)
  return project
}

export async function statusByName(
  db: Db,
  userId: string,
  projectId: string,
  name: string,
): Promise<Status> {
  const statuses = await listStatuses(db, userId, projectId)
  const status = statuses.find((item) => sameText(item.name, name.trim()))
  if (!status) {
    const available = statuses.map((item) => `"${item.name}"`).join(', ')
    throw invalid(`Unknown status "${name}". This project has: ${available}`)
  }
  return status
}

export async function memberByEmail(
  db: Db,
  userId: string,
  projectId: string,
  email: string,
): Promise<ProjectMember> {
  const member = (await listMembers(db, userId, projectId)).find((item) =>
    sameText(item.email, email.trim()),
  )
  if (!member) throw invalid(`"${email}" is not a member of this project`)
  return member
}

/** Resolves label names to labels; every name must exist in the project. */
export async function labelsByName(
  db: Db,
  userId: string,
  projectId: string,
  names: string[],
): Promise<Label[]> {
  const labels = await listLabels(db, userId, projectId)
  return names.map((name) => {
    const label = labels.find((item) => sameText(item.name, name.trim()))
    if (!label) {
      const available = labels.map((item) => `"${item.name}"`).join(', ') || 'none yet'
      throw invalid(`Unknown label "${name}". This project has: ${available}`)
    }
    return label
  })
}

const TASK_KEY = /^([A-Za-z][A-Za-z0-9]{1,9})-([1-9]\d{0,8})$/

export async function taskByKey(
  db: Db,
  userId: string,
  key: string,
): Promise<{ project: Project; task: Task }> {
  const match = TASK_KEY.exec(key.trim())
  if (!match?.[1] || !match[2]) {
    throw invalid(`"${key}" is not a task key. Expected something like CHL-12`)
  }
  const project = await projectByKey(db, userId, match[1])
  return { project, task: await getTaskByNumber(db, userId, project.id, Number(match[2])) }
}

export async function wikiPageByTitle(
  db: Db,
  userId: string,
  projectId: string,
  title: string,
): Promise<WikiPage> {
  const summary = (await listPages(db, userId, projectId, {})).find((item) =>
    sameText(item.title, title.trim()),
  )
  if (!summary) throw notFound(`Wiki page "${title}"`)
  return getPage(db, userId, projectId, summary.id)
}
