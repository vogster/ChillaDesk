import { NotFoundPage } from '../NotFoundPage'
import { LabelSettings } from './labels/LabelSettings'
import { useProjectContext } from './ProjectLayout'
import { ProjectSettings } from './ProjectSettings'
import { StatusSettings } from './StatusSettings'
import { TransferSettings } from './TransferSettings'
import { WebhookSettings } from './webhooks/WebhookSettings'

export function SettingsPage() {
  const { project } = useProjectContext()
  // The tab is hidden for other roles; this covers a typed-in address.
  if (project.role !== 'owner') return <NotFoundPage />

  return (
    // Forms read better at a width of their own than across the whole page.
    <div className="max-w-3xl space-y-6">
      <StatusSettings projectId={project.id} />
      <LabelSettings projectId={project.id} />
      <WebhookSettings projectId={project.id} />
      <TransferSettings projectId={project.id} />
      <ProjectSettings key={project.id} project={project} />
    </div>
  )
}
