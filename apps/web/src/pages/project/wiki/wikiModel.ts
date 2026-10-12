import {
  MENTION_EMAIL_SOURCE,
  MENTION_PREFIX_CLASS,
  type ProjectMember,
  type WikiPageSummary,
} from '@chillawiki/shared'

export interface TreeNode {
  page: WikiPageSummary
  children: TreeNode[]
}

const byTitle = (left: WikiPageSummary, right: WikiPageSummary) =>
  left.title.localeCompare(right.title, undefined, { sensitivity: 'base' })

/**
 * Arranges the flat page list into a tree, siblings sorted by title. Every page appears
 * exactly once: one whose parent is missing, or that sits in a parent loop, is shown at
 * the top level rather than dropped.
 */
export function buildTree(pages: WikiPageSummary[]): TreeNode[] {
  const known = new Set(pages.map((page) => page.id))
  const childrenOf = new Map<string | null, WikiPageSummary[]>()
  for (const page of pages) {
    const parent = page.parentId && known.has(page.parentId) ? page.parentId : null
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), page])
  }

  const placed = new Set<string>()
  const toNode = (page: WikiPageSummary): TreeNode => {
    placed.add(page.id)
    const children = [...(childrenOf.get(page.id) ?? [])]
      .sort(byTitle)
      .filter((child) => !placed.has(child.id))
      .map(toNode)
    return { page, children }
  }

  const roots = [...(childrenOf.get(null) ?? [])].sort(byTitle).map(toNode)
  // Whatever is left is unreachable from a root, which only a parent loop can cause.
  const stranded = [...pages]
    .sort(byTitle)
    .flatMap((page) => (placed.has(page.id) ? [] : [toNode(page)]))
  return [...roots, ...stranded]
}

/** Ids of every page below `pageId`: the places it cannot be moved to. */
export function descendantIds(pages: WikiPageSummary[], pageId: string): Set<string> {
  const found = new Set<string>()
  const queue = [pageId]
  for (let current = queue.shift(); current !== undefined; current = queue.shift()) {
    for (const page of pages) {
      if (page.parentId === current && !found.has(page.id)) {
        found.add(page.id)
        queue.push(page.id)
      }
    }
  }
  return found
}

export const wikiPagePath = (projectId: string, pageId: string) =>
  `/projects/${projectId}/wiki/${pageId}`

export const newWikiPagePath = (projectId: string, title?: string) =>
  `/projects/${projectId}/wiki/new${title ? `?title=${encodeURIComponent(title)}` : ''}`

export const taskNumberPath = (projectId: string, number: number | string) =>
  `/projects/${projectId}/tasks/${number}`

export interface LinkContext {
  projectId: string
  projectKey: string
  /** Undefined while the page list is loading: `[[titles]]` are then left as plain text. */
  pages: WikiPageSummary[] | undefined
  /** Whether a title without a page becomes a link to the form that creates it. */
  linkMissingPages: boolean
  /** Who can be mentioned. Undefined while loading: `@email` is then left as plain text. */
  members?: ProjectMember[] | undefined
}

export type LinkPart =
  | { kind: 'text'; value: string }
  | { kind: 'link'; label: string; href: string; missing: boolean }
  | { kind: 'mention'; label: string; email: string }

type Link = Omit<Extract<LinkPart, { kind: 'link' }>, 'kind'>

/**
 * Splits a run of plain text into text, links and mentions: `[[Page title]]` links to the
 * wiki page of that name, a task key such as `CHL-12` to the task, and `@email` of a member
 * is a mention.
 *
 * The pattern is a single alternation applied once, so a link is never scanned again (a
 * title may itself contain a task key), and neither branch can backtrack across the input.
 */
export function splitLinks(text: string, context: LinkContext): LinkPart[] {
  const { projectId, projectKey, pages, linkMissingPages } = context
  const byLowerTitle = new Map((pages ?? []).map((page) => [page.title.toLowerCase(), page]))
  // Up to nine digits: every such number fits the integer column behind it.
  const byEmail = new Map(
    (context.members ?? []).map((member) => [member.email.toLowerCase(), member]),
  )
  const pattern = new RegExp(
    [
      '\\[\\[([^[\\]\\n]+)\\]\\]',
      `(?<![\\w-])${projectKey}-([1-9]\\d{0,8})(?![\\w-])`,
      `(?<![^${MENTION_PREFIX_CLASS}])@(${MENTION_EMAIL_SOURCE})`,
    ].join('|'),
    'g',
  )

  const partFor = (match: RegExpExecArray): LinkPart | null => {
    const email = match[3]
    if (email === undefined) {
      const link = linkFor(match)
      return link && { kind: 'link', ...link }
    }
    // Only a member is shown as a mention; any other address stays as it was written.
    const member = byEmail.get(email.toLowerCase())
    return member ? { kind: 'mention', label: `@${member.name}`, email: member.email } : null
  }

  const linkFor = ([whole, rawTitle, taskNumber]: RegExpExecArray): Link | null => {
    if (taskNumber !== undefined) {
      return { label: whole, href: taskNumberPath(projectId, taskNumber), missing: false }
    }
    const title = rawTitle?.trim()
    if (!title || !pages) return null
    const page = byLowerTitle.get(title.toLowerCase())
    if (page) return { label: page.title, href: wikiPagePath(projectId, page.id), missing: false }
    return linkMissingPages
      ? { label: title, href: newWikiPagePath(projectId, title), missing: true }
      : null
  }

  const parts: LinkPart[] = []
  let textStart = 0
  for (const match of text.matchAll(pattern)) {
    const part = partFor(match)
    if (!part) continue
    if (match.index > textStart) {
      parts.push({ kind: 'text', value: text.slice(textStart, match.index) })
    }
    parts.push(part)
    textStart = match.index + match[0].length
  }
  if (textStart < text.length) parts.push({ kind: 'text', value: text.slice(textStart) })
  return parts
}
