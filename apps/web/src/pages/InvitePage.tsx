import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { ApiError, errorMessage } from '../api/client'
import { acceptInvite, previewInvite } from '../api/invites'
import { Alert, Button, Card, Spinner } from '../components/ui'
import { useLinkToken } from '../hooks/useLinkToken'
import { useT } from '../i18n'

/**
 * `/invite#token=…`: where an invite link leads. Someone who is not signed in is first sent
 * to log in or sign up and comes back here afterwards.
 */
export function InvitePage() {
  const t = useT()
  const texts = t.account.invites.page
  const token = useLinkToken()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const preview = useQuery({
    queryKey: ['invite', token],
    queryFn: () => previewInvite(token),
    enabled: token !== '',
    retry: false,
  })
  const accept = useMutation({
    mutationFn: () => acceptInvite(token),
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      navigate(`/projects/${project.id}`, { replace: true })
    },
  })

  const invalid = preview.error instanceof ApiError && preview.error.code === 'NOT_FOUND'
  const invite = preview.data

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <h1 className="mb-3 text-lg font-semibold">{texts.title}</h1>
        {token === '' && <p className="text-sm">{texts.invalid}</p>}
        {token !== '' && preview.isPending && <Spinner />}
        {preview.isError && (
          <div className="space-y-3">
            {invalid ? (
              <p className="text-sm">{texts.invalid}</p>
            ) : (
              <Alert>{errorMessage(preview.error)}</Alert>
            )}
            <Link to="/" className="text-sm text-indigo-600 hover:underline dark:text-indigo-400">
              {t.shell.notFound.back}
            </Link>
          </div>
        )}
        {invite && (
          <div className="space-y-4">
            {accept.isError && <Alert>{errorMessage(accept.error)}</Alert>}
            <p className="text-sm">
              {invite.alreadyMember
                ? texts.alreadyMember(invite.project.name)
                : texts.invitation(invite.project.name, t.common.role[invite.role])}
            </p>
            {invite.alreadyMember ? (
              <Link
                to={`/projects/${invite.project.id}`}
                className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400"
              >
                {texts.open}
              </Link>
            ) : (
              <Button onClick={() => accept.mutate()} disabled={accept.isPending}>
                {texts.join}
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
