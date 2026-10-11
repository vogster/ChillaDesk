import { splitLinks, type LinkContext } from './wikiModel'

/** The few fields of a Markdown syntax-tree node (mdast) this plugin reads or writes. */
interface MarkdownNode {
  type: string
  value?: string
  url?: string
  children?: MarkdownNode[]
  data?: { hProperties?: Record<string, string> }
}

// Text that is already part of a link stays as it is.
const LINK_TYPES = new Set(['link', 'linkReference', 'definition'])

/** Marks a link to a wiki page that does not exist yet; read by the Markdown renderer. */
export const MISSING_PAGE_ATTRIBUTE = 'data-missing-page'

function withLinks(node: MarkdownNode, context: LinkContext): MarkdownNode {
  if (!node.children || LINK_TYPES.has(node.type)) return node

  const children = node.children.flatMap((child): MarkdownNode[] => {
    if (child.type !== 'text') return [withLinks(child, context)]
    return splitLinks(child.value ?? '', context).map((part) =>
      part.kind === 'text'
        ? { type: 'text', value: part.value }
        : {
            type: 'link',
            url: part.href,
            // A text node: the title is shown as written, never parsed as Markdown.
            children: [{ type: 'text', value: part.label }],
            ...(part.missing
              ? { data: { hProperties: { [MISSING_PAGE_ATTRIBUTE]: 'true' } } }
              : {}),
          },
    )
  })
  return { ...node, children }
}

/**
 * remark plugin: turns `[[Page title]]` and task keys into links.
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
