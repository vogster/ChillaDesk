import { and, asc, eq, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Db } from '../../db/client'
import {
  checklistItems,
  labels,
  milestones,
  projectMembers,
  statuses,
  taskLabels,
  tasks,
  users,
  wikiPages,
} from '../../db/schema'
import { conflict } from '../../errors'
import { getProject } from '../projects/service'
import { toCsv } from './csv'
import { createZip, MAX_ZIP_ENTRIES, type ZipEntry } from './zip'

/** Column names of the task export; the import reads the same names back. */
export const TASK_COLUMNS = [
  'Key',
  'Title',
  'Status',
  'Priority',
  'Assignee',
  'Reporter',
  'Due date',
  'Milestone',
  'Labels',
  'Checklist',
  'Created',
  'Updated',
  'Description',
] as const

/** A checklist in one cell, an item per line, the way the import reads it back. */
export function checklistCell(items: { text: string; done: boolean }[]): string {
  return items.map((item) => `[${item.done ? 'x' : ' '}] ${item.text}`).join('\n')
}

/** Every value of `rows` grouped by `taskId`, in order. */
function groupByTask<T extends { taskId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) grouped.set(row.taskId, [...(grouped.get(row.taskId) ?? []), row])
  return grouped
}

/**
 * A member by email, which the import matches back; someone who has left by name only,
 * as their address is no longer shown to the project.
 */
function person(user: { email: string | null; name: string | null; member: string | null }) {
  if (user.member && user.email) return user.email
  return user.name ?? ''
}

/** All tasks of a project as CSV, oldest first; anyone who can see the project may export. */
export async function exportTasksCsv(
  db: Db,
  userId: string,
  projectId: string,
): Promise<{ fileName: string; content: string }> {
  const project = await getProject(db, userId, projectId)
  const assignee = alias(users, 'assignee')
  const reporter = alias(users, 'reporter')
  const assigneeMember = alias(projectMembers, 'assignee_member')
  const reporterMember = alias(projectMembers, 'reporter_member')
  const rows = await db
    .select({
      id: tasks.id,
      number: tasks.number,
      title: tasks.title,
      description: tasks.description,
      status: statuses.name,
      priority: tasks.priority,
      assignee: { email: assignee.email, name: assignee.name, member: assigneeMember.userId },
      reporter: { email: reporter.email, name: reporter.name, member: reporterMember.userId },
      dueDate: tasks.dueDate,
      milestone: milestones.name,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
    })
    .from(tasks)
    .innerJoin(statuses, eq(statuses.id, tasks.statusId))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .leftJoin(reporter, eq(reporter.id, tasks.reporterId))
    .leftJoin(
      assigneeMember,
      and(eq(assigneeMember.userId, tasks.assigneeId), eq(assigneeMember.projectId, projectId)),
    )
    .leftJoin(
      reporterMember,
      and(eq(reporterMember.userId, tasks.reporterId), eq(reporterMember.projectId, projectId)),
    )
    .leftJoin(milestones, eq(milestones.id, tasks.milestoneId))
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(tasks.number))

  // Joined by project rather than by a list of ids: a big project would not fit in one query.
  const labelRows = await db
    .select({ taskId: taskLabels.taskId, name: labels.name })
    .from(taskLabels)
    .innerJoin(labels, eq(labels.id, taskLabels.labelId))
    .where(eq(labels.projectId, projectId))
    .orderBy(sql`lower(${labels.name})`)
  const itemRows = await db
    .select({ taskId: checklistItems.taskId, text: checklistItems.text, done: checklistItems.done })
    .from(checklistItems)
    .innerJoin(tasks, eq(tasks.id, checklistItems.taskId))
    .where(eq(tasks.projectId, projectId))
    .orderBy(asc(checklistItems.position), asc(checklistItems.id))
  const labelsOf = groupByTask(labelRows)
  const checklistOf = groupByTask(itemRows)

  const lines = rows.map((task) => [
    `${project.key}-${task.number}`,
    task.title,
    task.status,
    task.priority,
    person(task.assignee),
    person(task.reporter),
    task.dueDate ?? '',
    task.milestone ?? '',
    (labelsOf.get(task.id) ?? []).map((label) => label.name).join(', '),
    checklistCell(checklistOf.get(task.id) ?? []),
    task.createdAt.toISOString(),
    task.updatedAt.toISOString(),
    task.description,
  ])
  return {
    fileName: `${project.key}-tasks.csv`,
    content: toCsv([[...TASK_COLUMNS], ...lines]),
  }
}

/** Characters no file system takes in a name, control characters and bidi overrides. */
const UNSAFE_IN_NAME =
  // eslint-disable-next-line no-control-regex -- control characters are exactly the target
  /[\\/:*?"<>|\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g
const RESERVED_ON_WINDOWS = /^(con|prn|aux|nul|com\d|lpt\d)$/i

/** A page title made into a file or folder name that every system accepts. */
export function safeFileName(title: string): string {
  const cleaned = title
    .replace(UNSAFE_IN_NAME, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .replace(/^\.+/, '')
    .slice(0, 100)
  if (cleaned === '' || RESERVED_ON_WINDOWS.test(cleaned)) return `page-${cleaned}`.slice(0, 100)
  return cleaned
}

/** Past this, pages go into the folder of their parent instead of one of their own. */
const MAX_FOLDER_LENGTH = 1000

interface PageRow {
  id: string
  parentId: string | null
  title: string
  content: string
  updatedAt: Date
}

/**
 * Lays the page tree out as files: a page is `Title.md`, its children go into a folder
 * `Title/` next to it. Names that clash (ignoring case, as Windows and macOS do) get a
 * number. A page whose parent is missing, or whose parents loop, goes to the top.
 */
export function pageFiles(pages: PageRow[]): ZipEntry[] {
  const known = new Set(pages.map((page) => page.id))
  const childrenOf = new Map<string | null, PageRow[]>()
  for (const page of pages) {
    const parent = page.parentId && known.has(page.parentId) ? page.parentId : null
    const siblings = childrenOf.get(parent) ?? []
    siblings.push(page)
    childrenOf.set(parent, siblings)
  }

  // Names taken in each folder, lowercased: both `Name.md` files and `Name` folders.
  const takenIn = new Map<string, Set<string>>()
  const uniqueIn = (folder: string, name: string) => {
    const taken = takenIn.get(folder) ?? new Set<string>()
    takenIn.set(folder, taken)
    const isFree = (candidate: string) =>
      !taken.has(candidate.toLowerCase()) && !taken.has(`${candidate}.md`.toLowerCase())
    let candidate = name
    for (let n = 2; !isFree(candidate); n += 1) candidate = `${name} (${n})`
    taken.add(candidate.toLowerCase())
    taken.add(`${candidate}.md`.toLowerCase())
    return candidate
  }

  const entries: ZipEntry[] = []
  const placed = new Set<string>()
  const byTitle = (list: PageRow[]) => [...list].sort((a, b) => a.title.localeCompare(b.title))
  // Depth first without recursion, so however deep the tree, the stack does not overflow.
  const pending: { page: PageRow; folder: string }[] = []
  const queueChildren = (parentId: string | null, folder: string) => {
    const children = byTitle(childrenOf.get(parentId) ?? []).reverse()
    for (const page of children) pending.push({ page, folder })
  }
  const drain = () => {
    for (let next = pending.pop(); next; next = pending.pop()) {
      const { page, folder } = next
      if (placed.has(page.id)) continue
      placed.add(page.id)
      // The folder of the page's children takes the same name as its file, without `.md`.
      const name = uniqueIn(folder, safeFileName(page.title))
      const body = `# ${page.title}\n\n${page.content}`.trimEnd() + '\n'
      entries.push({
        name: `${folder}${name}.md`,
        content: Buffer.from(body, 'utf8'),
        modified: page.updatedAt,
      })
      // Very deep trees stop nesting, so no path grows past what a ZIP can hold.
      queueChildren(page.id, folder.length > MAX_FOLDER_LENGTH ? folder : `${folder}${name}/`)
    }
  }

  queueChildren(null, '')
  drain()
  // Pages in a loop of parents were never reached from the top; they go there now.
  for (const page of byTitle(pages)) {
    if (placed.has(page.id)) continue
    pending.push({ page, folder: '' })
    drain()
  }
  return entries
}

/** The wiki of a project as a ZIP of Markdown files mirroring the page tree. */
export async function exportWikiZip(
  db: Db,
  userId: string,
  projectId: string,
): Promise<{ fileName: string; content: Buffer }> {
  const project = await getProject(db, userId, projectId)
  const pages = await db
    .select({
      id: wikiPages.id,
      parentId: wikiPages.parentId,
      title: wikiPages.title,
      content: wikiPages.content,
      updatedAt: wikiPages.updatedAt,
    })
    .from(wikiPages)
    .where(eq(wikiPages.projectId, projectId))
  if (pages.length > MAX_ZIP_ENTRIES) throw conflict('The wiki has too many pages to export')
  return { fileName: `${project.key}-wiki.zip`, content: createZip(pageFiles(pages)) }
}
