import { lazy, Suspense } from 'react'
import type { ProjectMarkdownProps } from './ProjectMarkdownBody'

// The Markdown libraries are a large part of the app; they load with the first text shown.
const ProjectMarkdownBody = lazy(async () => ({
  default: (await import('./ProjectMarkdownBody')).ProjectMarkdownBody,
}))

/**
 * Markdown written inside a project: `[[Page title]]` links to the wiki page of that name,
 * task keys such as `CHL-12` link to the task, and `@email` of a member reads as `@Name`.
 * Until the renderer has loaded, the text is shown as it was written.
 */
export function ProjectMarkdown(props: ProjectMarkdownProps) {
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap break-words">{props.children}</div>}>
      <ProjectMarkdownBody {...props} />
    </Suspense>
  )
}
