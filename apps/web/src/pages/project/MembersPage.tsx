import { InviteLinks } from './InviteLinks'
import { MembersPanel } from './MembersPanel'
import { useProjectContext } from './ProjectLayout'

export function MembersPage() {
  const { project, currentUser } = useProjectContext()
  return (
    <div className="max-w-3xl space-y-6">
      <MembersPanel project={project} currentUser={currentUser} />
      {project.role === 'owner' && <InviteLinks project={project} />}
    </div>
  )
}
