import type { Project } from '@chilladesk/shared'
import { useMemo } from 'react'
import { Markdown } from '../../components/Markdown'
import { useMembers } from './projectQueries'
import { MISSING_PAGE_ATTRIBUTE, remarkProjectLinks } from './wiki/projectLinks'
import { useWikiPages } from './wiki/wikiQueries'

export interface ProjectMarkdownProps {
  project: Pick<Project, 'id' | 'key' | 'role'>
  children: string
  /** Open links in a new tab, for previews inside a form. */
  linksLeaveInNewTab?: boolean
}

/**
 * Markdown written inside a project: `[[Page title]]` links to the wiki page of that name
 * task keys such as `CHL-12` link to the task, and `@email` of a member reads as `@Name`.
 */
export function ProjectMarkdownBody({
  project,
  children,
  linksLeaveInNewTab,
}: ProjectMarkdownProps) {
  // The page list is only needed to resolve titles, so plain text does not fetch it.
  const pages = useWikiPages(project.id, '', { enabled: children.includes('[[') })
  const members = useMembers(project.id, { enabled: children.includes('@') })
  const plugins = useMemo(
    () => [
      remarkProjectLinks({
        projectId: project.id,
        projectKey: project.key,
        pages: pages.data,
        // Viewers cannot create pages, so a title without a page stays plain text for them.
        linkMissingPages: project.role !== 'viewer',
        members: members.data,
      }),
    ],
    [project.id, project.key, project.role, pages.data, members.data],
  )
  return (
    <Markdown
      plugins={plugins}
      missingLinkAttribute={MISSING_PAGE_ATTRIBUTE}
      linksLeaveInNewTab={linksLeaveInNewTab ?? false}
    >
      {children}
    </Markdown>
  )
}
