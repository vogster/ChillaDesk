import { MENTION_PREFIX_CLASS } from '@chilladesk/shared'
import { splitLinks, type LinkContext, type LinkPart } from './wikiModel'

/** The few fields of a Markdown syntax-tree node (mdast) this plugin reads or writes. */
interface MarkdownNode {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
  data?: { hName?: string; hProperties?: Record<string, string> }
}

// Text that is already part of a link stays as it is.
const LINK_TYPES = new Set(['link', 'linkReference', 'definition'])

/** Marks a link to a wiki page that does not exist yet; read by the Markdown renderer. */
export const MISSING_PAGE_ATTRIBUTE = 'data-missing-page'

/** Class of the element a mention is rendered as; styled by the Markdown renderer. */
export const MENTION_CLASS = 'mention'

const MENTION_START = new RegExp(`(^|[${MENTION_PREFIX_CLASS}])@$`)

/** The address of a link Markdown made out of a bare email, or null for any other node. */
function autolinkedEmail(node: MarkdownNode): string | null {
  if (node.type !== 'link' || !node.url?.startsWith('mailto:')) return null
  const [label, ...others] = node.children ?? []
  const email = node.url.slice('mailto:'.length)
  return others.length === 0 && label?.type === 'text' && label.value === email ? email : null
}

/**
 * Markdown turns the email of `@ann@example.com` into a mail link and leaves the `@` behind.
 * For a member's address this puts the two back together as text, so the mention is seen
 * as written; any other address keeps its link.
 */
function rejoinMentions(children: MarkdownNode[], memberEmails: Set<string>): MarkdownNode[] {
  return children.reduce<MarkdownNode[]>((joined, child) => {
    const previous = joined.at(-1)
    if (previous?.type !== 'text') return [...joined, child]

    const before = previous.value ?? ''
    const email = autolinkedEmail(child)
    const addition =
      email !== null && memberEmails.has(email.toLowerCase()) && MENTION_START.test(before)
        ? email
        : child.type === 'text'
          ? (child.value ?? '')
          : null
    return addition === null
      ? [...joined, child]
      : [...joined.slice(0, -1), { type: 'text', value: `${before}${addition}` }]
  }, [])
}

function toNode(part: LinkPart): MarkdownNode {
  if (part.kind === 'text') return { type: 'text', value: part.value }
  if (part.kind === 'mention') {
    return {
      // Not a Markdown node type: rendered as the element named in `data`.
      type: 'mention',
      data: { hName: 'span', hProperties: { className: MENTION_CLASS, title: part.email } },
      children: [{ type: 'text', value: part.label }],
    }
  }
  return {
    type: 'link',
    url: part.href,
    // A text node: the title is shown as written, never parsed as Markdown.
    children: [{ type: 'text', value: part.label }],
    ...(part.missing ? { data: { hProperties: { [MISSING_PAGE_ATTRIBUTE]: 'true' } } } : {}),
  }
}

function withLinks(node: MarkdownNode, context: LinkContext): MarkdownNode {
  if (!node.children || LINK_TYPES.has(node.type)) return node

  const memberEmails = new Set((context.members ?? []).map((member) => member.email.toLowerCase()))
  const children = rejoinMentions(node.children, memberEmails).flatMap((child): MarkdownNode[] =>
    child.type === 'text'
      ? splitLinks(child.value ?? '', context).map(toNode)
      : [withLinks(child, context)],
  )
  return { ...node, children }
}

/**
 * remark plugin: turns `[[Page title]]` and task keys into links and `@email` of a project
 * member into a mention.
 *
 * It works on the parsed document rather than the raw text, so code spans, code blocks,
 * existing links and bare URLs are untouched by construction: none of them are text nodes.
 */
export function remarkProjectLinks(context: LinkContext) {
  return () => (tree: MarkdownNode) => {
    // unified transformers replace the tree in place; only the root's child list is assigned.
    tree.children = withLinks(tree, context).children ?? []
  }
}
