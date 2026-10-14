import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'
import { confirmEmailChange } from '../../api/auth'
import { errorMessage } from '../../api/client'
import { Alert, Spinner } from '../../components/ui'
import { useLinkToken } from '../../hooks/useLinkToken'
import { useT } from '../../i18n'
import { currentUserKey } from '../../queryClient'
import { authLinkClass, AuthShell } from '../AuthShell'

/** `/confirm-email#token=…`: the link sent to a new address; the signed-in owner opens it. */
export function ConfirmEmailChangePage() {
  const t = useT()
  const texts = t.account.email.change
  const token = useLinkToken()
  const queryClient = useQueryClient()
  // A query, not an effect: the token works once, and a query is not run twice for one key.
  const confirmation = useQuery({
    queryKey: ['confirm-email-change', token],
    queryFn: async () => {
      const user = await confirmEmailChange(token)
      queryClient.setQueryData(currentUserKey, user)
      return user
    },
    enabled: token !== '',
    retry: false,
    staleTime: Infinity,
    gcTime: Infinity,
  })

  return (
    <AuthShell
      title={texts.title}
      footer={
        <Link to="/profile" className={authLinkClass}>
          {t.account.profile.title}
        </Link>
      }
    >
      {token === '' && <p className="text-sm">{t.account.email.badLink}</p>}
      {token !== '' && confirmation.isPending && <Spinner />}
      {confirmation.isError && <Alert>{errorMessage(confirmation.error)}</Alert>}
      {confirmation.isSuccess && (
        <p role="status" className="text-sm">
          {texts.done} {confirmation.data.email}
        </p>
      )}
    </AuthShell>
  )
}
