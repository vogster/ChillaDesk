import { IMPORT_MAX_TASKS, type LabelColor } from '@chilladesk/shared'
import { z } from 'zod'
import { invalid } from '../../errors'
import { parseCsv } from './csv'

/** A task as a file describes it, before names are matched to the project. */
export interface TaskDraft {
  /** Row of the file (the header is row 1) or number of the card, for messages. */
  row: number
  title: string
  description: string
  status: string | null
  priority: string | null
  assignee: string | null
  dueDate: string | null
  milestone: string | null
  labels: { name: string; color?: LabelColor }[]
  checklist: { text: string; done: boolean }[]
}

export interface ReadResult {
  drafts: TaskDraft[]
  skipped: { row: number; reason: string }[]
}

type Field =
  | 'title'
  | 'description'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'dueDate'
  | 'milestone'
  | 'labels'
  | 'checklist'

/**
 * Header names each field is found under, lowercased: ours, Jira's and Russian ones.
 * Jira repeats a column (Labels, Fix Version/s) once per value; all of them are read.
 */
const HEADERS: Record<Field, string[]> = {
  title: ['title', 'summary', 'name', 'название', 'заголовок'],
  description: ['description', 'описание'],
  status: ['status', 'статус', 'list'],
  priority: ['priority', 'приоритет'],
  assignee: ['assignee', 'исполнитель'],
  dueDate: ['due date', 'due', 'duedate', 'срок'],
  milestone: ['milestone', 'fix version/s', 'fix versions', 'fix version', 'этап'],
  labels: ['labels', 'label', 'метки'],
  checklist: ['checklist', 'чек-лист', 'чеклист'],
}

function columnsOf(header: string[]): Map<Field, number[]> {
  const columns = new Map<Field, number[]>()
  header.forEach((name, index) => {
    const normalized = name.trim().toLowerCase()
    const field = (Object.keys(HEADERS) as Field[]).find((key) => HEADERS[key].includes(normalized))
    if (field) columns.set(field, [...(columns.get(field) ?? []), index])
  })
  return columns
}

/**
 * `- [x] text`. No two parts can match the same characters, and `s` lets the rest match
 * anything to the end, so a long line cannot make the match backtrack.
 */
const ITEM_LINE = /^[ \t]*(?:[-*][ \t]*)?\[([ xX])\](.*)$/s
/** Longer lines are cut before matching; an item keeps far fewer characters anyway. */
const LINE_MAX = 1000

/** A name from the file as messages show it: quoted, and not endless. */
export function quoted(value: string): string {
  return `"${value.length > 80 ? `${value.slice(0, 80)}…` : value}"`
}

/** `[x] Done thing` per line, as the export writes it; a plain line is an open item. */
function parseChecklist(cell: string): { text: string; done: boolean }[] {
  return cell
    .split(/\r\n|\r|\n/)
    .map((whole) => {
      const line = whole.slice(0, LINE_MAX)
      const match = ITEM_LINE.exec(line)
      return match
        ? { text: (match[2] ?? '').trim(), done: match[1] !== ' ' }
        : { text: line.trim(), done: false }
    })
    .filter((item) => item.text !== '')
}

function tooManyTasks(): never {
  throw invalid(`A file can bring in at most ${IMPORT_MAX_TASKS} tasks at once`)
}

/** Tasks from a CSV file: our export, a Jira export or a sheet with similar column names. */
export function readCsvTasks(text: string): ReadResult {
  const [header, ...rows] = parseCsv(text)
  if (!header) throw invalid('The file is empty')
  const columns = columnsOf(header)
  if (!columns.has('title')) {
    throw invalid('The file has no Title (or Summary) column')
  }
  if (rows.length > IMPORT_MAX_TASKS) tooManyTasks()

  const drafts: TaskDraft[] = []
  const skipped: ReadResult['skipped'] = []
  rows.forEach((cells, index) => {
    const row = index + 2
    const values = (field: Field) =>
      (columns.get(field) ?? [])
        .map((column) => (cells[column] ?? '').trim())
        .filter((value) => value !== '')
    const first = (field: Field) => values(field)[0] ?? null

    const title = first('title')
    if (!title) {
      skipped.push({ row, reason: 'No title' })
      return
    }
    // Ours are listed in one cell with commas; Jira puts each in a column of its own.
    const labelNames = values('labels').flatMap((cell) => cell.split(','))
    drafts.push({
      row,
      title,
      description: (columns.get('description') ?? [])
        .map((column) => cells[column] ?? '')
        .join('\n\n')
        .trim(),
      status: first('status'),
      priority: first('priority'),
      assignee: first('assignee'),
      dueDate: first('dueDate'),
      milestone: first('milestone'),
      labels: labelNames.map((name) => ({ name: name.trim() })).filter((label) => label.name),
      checklist: values('checklist').flatMap(parseChecklist),
    })
  })
  return { drafts, skipped }
}

/** Trello's colours by our palette; theirs have shades (`green_dark`) that map the same. */
const TRELLO_COLORS: Record<string, LabelColor> = {
  green: 'green',
  yellow: 'yellow',
  orange: 'orange',
  red: 'red',
  purple: 'purple',
  blue: 'blue',
  sky: 'teal',
  lime: 'green',
  pink: 'pink',
  black: 'gray',
}

const trelloBoardSchema = z.object({
  lists: z.array(z.object({ id: z.string(), name: z.string(), closed: z.boolean().optional() })),
  cards: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      desc: z.string().optional(),
      idList: z.string(),
      closed: z.boolean().optional(),
      due: z.string().nullable().optional(),
      idLabels: z.array(z.string()).optional(),
      idMembers: z.array(z.string()).optional(),
    }),
  ),
  labels: z
    .array(z.object({ id: z.string(), name: z.string().nullable(), color: z.string().nullable() }))
    .optional(),
  members: z
    .array(z.object({ id: z.string(), fullName: z.string().optional(), username: z.string() }))
    .optional(),
  checklists: z
    .array(
      z.object({
        idCard: z.string(),
        checkItems: z.array(
          z.object({ name: z.string(), state: z.string(), pos: z.number().optional() }),
        ),
      }),
    )
    .optional(),
})

/** Tasks from a Trello board exported as JSON (Menu → Print, export and share → JSON). */
export function readTrelloTasks(text: string): ReadResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw invalid('The file is not JSON; export the Trello board as JSON')
  }
  const parsed = trelloBoardSchema.safeParse(json)
  if (!parsed.success) throw invalid('The file is not a Trello board export')
  const board = parsed.data
  if (board.cards.length > IMPORT_MAX_TASKS) tooManyTasks()

  const lists = new Map(board.lists.map((list) => [list.id, list]))
  const labels = new Map((board.labels ?? []).map((label) => [label.id, label]))
  const members = new Map((board.members ?? []).map((member) => [member.id, member]))
  const checklistsOf = new Map<string, { text: string; done: boolean }[]>()
  for (const checklist of board.checklists ?? []) {
    const items = [...checklist.checkItems]
      .sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0))
      .map((item) => ({ text: item.name.trim(), done: item.state === 'complete' }))
    checklistsOf.set(checklist.idCard, [...(checklistsOf.get(checklist.idCard) ?? []), ...items])
  }

  const drafts: TaskDraft[] = []
  const skipped: ReadResult['skipped'] = []
  board.cards.forEach((card, index) => {
    const row = index + 1
    const list = lists.get(card.idList)
    if (card.closed || list?.closed) {
      skipped.push({ row, reason: `Archived card ${quoted(card.name)}` })
      return
    }
    if (!card.name.trim()) {
      skipped.push({ row, reason: 'No title' })
      return
    }
    const member = card.idMembers?.map((id) => members.get(id)).find(Boolean)
    drafts.push({
      row,
      title: card.name.trim(),
      description: card.desc ?? '',
      status: list?.name ?? null,
      priority: null,
      assignee: member ? (member.fullName ?? member.username) : null,
      dueDate: card.due ? card.due.slice(0, 10) : null,
      milestone: null,
      labels: (card.idLabels ?? []).flatMap((id) => {
        const label = labels.get(id)
        // Trello labels may have only a colour; such a label is named after it.
        const name = label?.name?.trim() || label?.color
        if (!label || !name) return []
        const color = TRELLO_COLORS[(label.color ?? '').replace(/_(light|dark)$/, '')]
        return [color ? { name, color } : { name }]
      }),
      checklist: (checklistsOf.get(card.id) ?? []).filter((item) => item.text !== ''),
    })
  })
  return { drafts, skipped }
}
