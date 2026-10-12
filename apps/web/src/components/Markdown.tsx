import type { ComponentProps } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link } from 'react-router'
import remarkGfm from 'remark-gfm'

const STYLES = [
  'text-sm leading-relaxed break-words',
  '[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5',
  '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold',
  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold',
  '[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold',
  '[&_a]:text-indigo-600 [&_a]:underline dark:[&_a]:text-indigo-400',
  '[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] dark:[&_code]:bg-slate-800',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-slate-100 [&_pre]:p-3 dark:[&_pre]:bg-slate-800',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600 dark:[&_blockquote]:border-slate-600 dark:[&_blockquote]:text-slate-400',
  '[&_table]:my-2 [&_td]:border [&_th]:border [&_td]:border-slate-300 [&_th]:border-slate-300 [&_td]:px-2 [&_th]:px-2 [&_td]:py-1 [&_th]:py-1 dark:[&_td]:border-slate-700 dark:[&_th]:border-slate-700',
  // A mention of a project member, see `MENTION_CLASS`.
  '[&_.mention]:rounded [&_.mention]:bg-indigo-50 [&_.mention]:px-1 [&_.mention]:font-medium [&_.mention]:text-indigo-700 dark:[&_.mention]:bg-indigo-950 dark:[&_.mention]:text-indigo-300',
  '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
].join(' ')

// Overrides the link colour for a page that does not exist yet.
const MISSING_LINK = '!text-red-600 decoration-dashed dark:!text-red-400'

type RemarkPlugins = NonNullable<ComponentProps<typeof ReactMarkdown>['remarkPlugins']>

interface MarkdownProps {
  children: string
  /** Extra remark plugins, run after GitHub-flavoured Markdown. */
  plugins?: RemarkPlugins
  /** Attribute a plugin sets on links to pages that do not exist yet. */
  missingLinkAttribute?: string
  /**
   * Open in-app links in a new tab as well. For previews inside a form, where following
   * a link in place would leave the form.
   */
  linksLeaveInNewTab?: boolean
}

/**
 * Renders user-written Markdown. react-markdown ignores raw HTML and unsafe URLs by default,
 * so the output is safe to show to other members. Images are left out: loading one from an
 * arbitrary address would tell that server who opened the page and when.
 *
 * Links that start with `/` stay inside the app; all others open in a new tab.
 */
export function Markdown({
  children,
  plugins = [],
  missingLinkAttribute,
  linksLeaveInNewTab = false,
}: MarkdownProps) {
  return (
    <div className={STYLES}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, ...plugins]}
        disallowedElements={['img']}
        components={{
          a: ({ node: _node, href, children: label, ...props }) => {
            const internal = href?.startsWith('/') && !href.startsWith('//')
            if (!internal || linksLeaveInNewTab) {
              return (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {label}
                </a>
              )
            }
            const missing =
              missingLinkAttribute !== undefined &&
              (props as Record<string, unknown>)[missingLinkAttribute] !== undefined
            return (
              <Link
                to={href ?? ''}
                className={missing ? MISSING_LINK : undefined}
                title={
                  missing
                    ? 'This page does not exist yet. Follow the link to create it.'
                    : undefined
                }
              >
                {label}
              </Link>
            )
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
