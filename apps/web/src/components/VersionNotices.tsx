import { Link } from 'react-router'
import { useDismissedUpdate, useVersionInfo } from '../pages/about/versionQueries'
import { useProjects } from '../pages/project/projectQueries'
import { useT } from '../i18n'

/**
 * In the header: a new version is out. Shown to people who own a project, who are the ones
 * likely to run the server, until they put away the reminder for that version.
 */
export function UpdateNotice() {
  const t = useT()
  const version = useVersionInfo()
  const projects = useProjects()
  const [dismissed] = useDismissedUpdate()
  const info = version.data
  const ownsAProject = projects.data?.some((project) => project.role === 'owner') ?? false
  if (!info?.updateAvailable || !info.latest || !ownsAProject || dismissed === info.latest) {
    return null
  }
  return (
    <Link
      to="/about"
      className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:hover:bg-emerald-900"
    >
      {t.shell.about.newVersion(info.latest)}
    </Link>
  )
}

/** At the bottom of every page: which version runs, leading to what is new. */
export function VersionFooter() {
  const t = useT()
  const version = useVersionInfo()
  if (!version.data) return null
  return (
    <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-slate-500">
      <Link to="/about" className="hover:underline">
        {t.shell.about.footer(version.data.current)}
        {version.data.updateAvailable && version.data.latest
          ? ` · ${t.shell.about.newVersion(version.data.latest)}`
          : ''}
      </Link>
    </footer>
  )
}
