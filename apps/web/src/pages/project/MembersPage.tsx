import { MembersPanel } from './MembersPanel'
import { useProjectContext } from './ProjectLayout'

export function MembersPage() {
  const { project, currentUser } = useProjectContext()
  return <MembersPanel project={project} currentUser={currentUser} />
}
