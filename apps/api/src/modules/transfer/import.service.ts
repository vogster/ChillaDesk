import {
  dueDateSchema,
  type ImportFormat,
  type ImportResult,
  LABELS_PER_TASK_MAX,
  type LabelColor,
  type StatusCategory,
  type TaskPriority,
} from '@chilladesk/shared'
import { and, eq, max } from 'drizzle-orm'
import type { Db, Tx } from '../../db/client'
import {
  checklistItems,
  labels,
  milestones,
  projectMembers,
  statuses,
  users,
} from '../../db/schema'
import { AppError } from '../../errors'
import { lowerName, MAX_LABELS } from '../labels/service'
import { MAX_MILESTONES } from '../milestones/service'
import { getProject } from '../projects/service'
import { MAX_CHECKLIST_ITEMS } from '../tasks/checklist.service'
import { createTask } from '../tasks/service'
import { quoted, readCsvTasks, readTrelloTasks, type TaskDraft } from './import.readers'

/** More columns than this are not added by an import; tasks go to an existing one instead. */
const MAX_IMPORTED_COLUMNS = 20
const TITLE_MAX = 200
const DESCRIPTION_MAX = 20_000
const LABEL_NAME_MAX = 40
const MILESTONE_NAME_MAX = 80
const CHECKLIST_TEXT_MAX = 300

const PRIORITIES: Record<string, TaskPriority> = {
  lowest: 'low',
  low: 'low',
  minor: 'low',
  trivial: 'low',
  низкий: 'low',
  medium: 'medium',
  normal: 'medium',
  средний: 'medium',
  high: 'high',
  major: 'high',
  высокий: 'high',
  urgent: 'urgent',
  highest: 'urgent',
  critical: 'urgent',
  blocker: 'urgent',
  срочный: 'urgent',
}

/** Column names that say what kind of column it is, in the languages people use. */
const CATEGORY_WORDS: Record<StatusCategory, RegExp> = {
  done: /^(done|closed|resolved|complete|completed|finished|готово|сделано|выполнено|закрыт[оа]?)$/,
  in_progress: /^(in progress|doing|in review|review|in work|в работе|в процессе|на проверке)$/,
  todo: /^(to do|todo|open|new|к выполнению|сделать|открыт[оа]?|новая|новые)$/,
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** `2024-05-01` (with or without a time), `01.05.2024` or Jira's `01/May/24 10:00 AM`. */
export function parseDueDate(value: string): string | null {
  const pad = (n: number | string) => String(n).padStart(2, '0')
  let date: string | null = null
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})/.exec(value)
  const jira = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2}|\d{4})\b/.exec(value)
  if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`
  else if (dotted) date = `${dotted[3]}-${pad(dotted[2] ?? '')}-${pad(dotted[1] ?? '')}`
  else if (jira) {
    const month = MONTHS.indexOf((jira[2] ?? '').toLowerCase())
    const year = (jira[3] ?? '').length === 2 ? `20${jira[3]}` : jira[3]
    if (month >= 0) date = `${year}-${pad(month + 1)}-${pad(jira[1] ?? '')}`
  }
  return date && dueDateSchema.safeParse(date).success ? date : null
}

/** Whatever a file calls things, matched to what the project has; warns once per mismatch. */
class ProjectNames {
  readonly warnings = new Set<string>()
  private statusByName = new Map<string, string>()
  private firstOfCategory = new Map<StatusCategory, string>()
  private columnCount = 0
  private memberByName = new Map<string, string>()
  private labelByName = new Map<string, string>()
  private milestoneByName = new Map<string, string>()

  constructor(
    private readonly tx: Tx,
    private readonly projectId: string,
  ) {}

  async load(): Promise<void> {
    const columns = await this.tx
      .select()
      .from(statuses)
      .where(eq(statuses.projectId, this.projectId))
      .orderBy(statuses.position)
    for (const column of columns) this.rememberStatus(column.name, column.id, column.category)
    this.columnCount = columns.length

    const members = await this.tx
      .select({ id: users.id, email: users.email, name: users.name })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, this.projectId))
    for (const member of members) {
      this.memberByName.set(member.email.toLowerCase(), member.id)
      // A name two members share says nothing about which of them is meant.
      const name = member.name.toLowerCase()
      this.memberByName.set(name, this.memberByName.has(name) ? '' : member.id)
    }

    const projectLabels = await this.tx
      .select({ id: labels.id, name: labels.name })
      .from(labels)
      .where(eq(labels.projectId, this.projectId))
    for (const label of projectLabels) this.labelByName.set(label.name.toLowerCase(), label.id)

    const projectMilestones = await this.tx
      .select({ id: milestones.id, name: milestones.name })
      .from(milestones)
      .where(eq(milestones.projectId, this.projectId))
    for (const milestone of projectMilestones) {
      this.milestoneByName.set(milestone.name.toLowerCase(), milestone.id)
    }
  }

  private rememberStatus(name: string, id: string, category: StatusCategory) {
    this.statusByName.set(name.toLowerCase(), id)
    if (!this.firstOfCategory.has(category)) this.firstOfCategory.set(category, id)
  }

  /**
   * The column of that name; else the first column of the kind its name says (Done, In
   * progress); else a new column of that name; else the first column.
   */
  async status(name: string | null): Promise<string | undefined> {
    const columnName = name?.trim().slice(0, 40)
    if (!columnName) return undefined
    const key = columnName.toLowerCase()
    const known = this.statusByName.get(key)
    if (known) return known
    const category = (Object.keys(CATEGORY_WORDS) as StatusCategory[]).find((kind) =>
      CATEGORY_WORDS[kind].test(key),
    )
    const ofCategory = category && this.firstOfCategory.get(category)
    if (ofCategory) {
      this.statusByName.set(key, ofCategory)
      return ofCategory
    }
    if (this.columnCount >= MAX_IMPORTED_COLUMNS) {
      this.warnings.add(`No column ${quoted(columnName)}; its tasks were put into the first column`)
      return undefined
    }
    const [last] = await this.tx
      .select({ position: max(statuses.position) })
      .from(statuses)
      .where(eq(statuses.projectId, this.projectId))
    const [created] = await this.tx
      .insert(statuses)
      .values({
        projectId: this.projectId,
        name: columnName,
        category: category ?? 'todo',
        position: (last?.position ?? -1) + 1,
      })
      .returning({ id: statuses.id })
    if (!created) throw new Error('Insert returned no status row')
    this.columnCount += 1
    this.rememberStatus(columnName, created.id, category ?? 'todo')
    this.statusByName.set(key, created.id)
    this.warnings.add(`Added the column ${quoted(columnName)}`)
    return created.id
  }

  priority(value: string | null): TaskPriority | undefined {
    if (!value) return undefined
    const priority = PRIORITIES[value.trim().toLowerCase()]
    if (!priority) this.warnings.add(`Unknown priority ${quoted(value)}; medium was used`)
    return priority
  }

  assignee(value: string | null): string | null {
    if (!value) return null
    const id = this.memberByName.get(value.trim().toLowerCase())
    if (!id) this.warnings.add(`${quoted(value)} is not a member of this project; left unassigned`)
    return id || null
  }

  dueDate(value: string | null): string | null {
    if (!value) return null
    const date = parseDueDate(value.trim())
    if (!date) this.warnings.add(`Could not read the date ${quoted(value)}`)
    return date
  }

  /** Labels to put on a task, made where missing; at most the per-task number of them. */
  async labels(wanted: { name: string; color?: LabelColor }[]): Promise<string[]> {
    // Cut down before anything is made, so a cell of endless names makes no endless labels.
    const unique = new Map<string, { name: string; color?: LabelColor }>()
    for (const label of wanted) {
      const name = label.name.trim().slice(0, LABEL_NAME_MAX)
      if (name && !unique.has(name.toLowerCase()))
        unique.set(name.toLowerCase(), { ...label, name })
    }
    if (unique.size > LABELS_PER_TASK_MAX) {
      this.warnings.add(
        `A task can have at most ${LABELS_PER_TASK_MAX} labels; the rest were left out`,
      )
    }
    const ids: string[] = []
    for (const [key, { name, color }] of [...unique].slice(0, LABELS_PER_TASK_MAX)) {
      const id = this.labelByName.get(key) ?? (await this.createLabel(name, color))
      if (id) ids.push(id)
    }
    return ids
  }

  private async createLabel(name: string, color: LabelColor | undefined) {
    if (this.labelByName.size >= MAX_LABELS) {
      this.warnings.add(`The project has too many labels; ${quoted(name)} was not added`)
      return undefined
    }
    // Someone may have added the same label meanwhile; then that one is used.
    await this.tx
      .insert(labels)
      .values({ projectId: this.projectId, name, color: color ?? 'gray' })
      .onConflictDoNothing()
    const [label] = await this.tx
      .select({ id: labels.id })
      .from(labels)
      .where(
        and(eq(labels.projectId, this.projectId), eq(lowerName(labels.name), name.toLowerCase())),
      )
    if (!label) throw new Error('The imported label is missing')
    this.labelByName.set(name.toLowerCase(), label.id)
    return label.id
  }

  async milestone(value: string | null): Promise<string | null> {
    const name = value?.trim().slice(0, MILESTONE_NAME_MAX)
    if (!name) return null
    const key = name.toLowerCase()
    const known = this.milestoneByName.get(key)
    if (known) return known
    if (this.milestoneByName.size >= MAX_MILESTONES) {
      this.warnings.add(`The project has too many milestones; ${quoted(name)} was not added`)
      return null
    }
    await this.tx
      .insert(milestones)
      .values({ projectId: this.projectId, name })
      .onConflictDoNothing()
    const [created] = await this.tx
      .select({ id: milestones.id })
      .from(milestones)
      .where(and(eq(milestones.projectId, this.projectId), eq(milestones.name, name)))
    if (!created) throw new Error('The imported milestone is missing')
    this.milestoneByName.set(key, created.id)
    return created.id
  }
}

function clip(text: string, limit: number, what: string, warnings: Set<string>): string {
  if (text.length <= limit) return text
  warnings.add(`${what} longer than ${limit} characters were shortened`)
  return text.slice(0, limit)
}

async function importDraft(
  tx: Tx,
  userId: string,
  projectId: string,
  draft: TaskDraft,
  names: ProjectNames,
): Promise<void> {
  const statusId = await names.status(draft.status)
  const task = await createTask(
    tx,
    userId,
    projectId,
    {
      title: clip(draft.title, TITLE_MAX, 'Titles', names.warnings),
      description: clip(draft.description, DESCRIPTION_MAX, 'Descriptions', names.warnings),
      ...(statusId ? { statusId } : {}),
      priority: names.priority(draft.priority) ?? 'medium',
      assigneeId: names.assignee(draft.assignee),
      dueDate: names.dueDate(draft.dueDate),
      milestoneId: await names.milestone(draft.milestone),
      labelIds: await names.labels(draft.labels),
    },
    { notify: false },
  )
  if (draft.checklist.length > MAX_CHECKLIST_ITEMS) {
    names.warnings.add(
      `A checklist can have at most ${MAX_CHECKLIST_ITEMS} items; the rest were left out`,
    )
  }
  const items = draft.checklist.slice(0, MAX_CHECKLIST_ITEMS)
  if (items.length > 0) {
    await tx.insert(checklistItems).values(
      items.map((item, index) => ({
        taskId: task.id,
        text: clip(item.text, CHECKLIST_TEXT_MAX, 'Checklist items', names.warnings),
        done: item.done,
        position: index + 1,
      })),
    )
  }
}

/** Text with NUL characters taken out: PostgreSQL text cannot hold them. */
function decode(body: Buffer): string {
  // eslint-disable-next-line no-control-regex -- the NUL character is exactly the target
  return body.toString('utf8').replace(/\u0000/g, '')
}

/**
 * Creates tasks from a file, all of them or none: a file that cannot be read changes
 * nothing. A row that cannot become a task is skipped and reported; names the project does
 * not know are added (labels, milestones, columns) or left out with a warning. Nobody is
 * notified about the imported tasks. Only owners import, as it may add columns.
 */
export async function importTasks(
  db: Db,
  userId: string,
  projectId: string,
  format: ImportFormat,
  body: Buffer,
): Promise<ImportResult> {
  await getProject(db, userId, projectId, 'owner')
  const text = decode(body)
  const { drafts, skipped } = format === 'trello' ? readTrelloTasks(text) : readCsvTasks(text)

  return db.transaction(async (tx) => {
    const names = new ProjectNames(tx, projectId)
    await names.load()
    let created = 0
    for (const draft of drafts) {
      try {
        // Names are settled in the import's own transaction, so a column or label made for
        // one task stays known even when that task fails; the task itself has a savepoint.
        await importDraft(tx, userId, projectId, draft, names)
        created += 1
      } catch (error) {
        if (!(error instanceof AppError)) throw error
        skipped.push({ row: draft.row, reason: error.message })
      }
    }
    skipped.sort((a, b) => a.row - b.row)
    return { created, skipped, warnings: [...names.warnings] }
  })
}
