import {
  inviteRoleSchema,
  type CreatedInvite,
  type InviteRole,
  type Project,
} from '@chilladesk/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { errorMessage } from '../../api/client'
import { createInvite, fetchInvites, revokeInvite } from '../../api/invites'
import { Alert, Button, Card, selectClass } from '../../components/ui'
import { intlLocale, useT } from '../../i18n'

const invitesKey = (projectId: string) => ['projects', projectId, 'invites'] as const

/**
 * The address someone opens to use the invite. The token is in the fragment, which the
 * browser keeps to itself, so it does not reach the logs of the server or a proxy.
 */
export const inviteUrl = (token: string) => `${window.location.origin}/invite#token=${token}`

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(intlLocale(), { dateStyle: 'medium' })
}

function NewLink({ invite }: { invite: CreatedInvite }) {
  const texts = useT().account.invites
  const [copied, setCopied] = useState(false)
  const url = inviteUrl(invite.token)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // No clipboard access: the address is on screen and can be selected by hand.
      setCopied(false)
    }
  }

  return (
    <div
      role="status"
      className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950"
    >
      <p>{texts.created}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          aria-label={texts.linkLabel}
          value={url}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900"
        />
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? texts.copied : texts.copy}
        </Button>
      </div>
    </div>
  )
}

/** For owners: links that let people join the project without being added by email. */
export function InviteLinks({ project }: { project: Project }) {
  const t = useT()
  const texts = t.account.invites
  const queryClient = useQueryClient()
  const invites = useQuery({
    queryKey: invitesKey(project.id),
    queryFn: () => fetchInvites(project.id),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: invitesKey(project.id) })
  const create = useMutation({
    mutationFn: (role: InviteRole) => createInvite(project.id, role),
    onSuccess: refresh,
  })
  const revoke = useMutation({
    mutationFn: (inviteId: string) => revokeInvite(project.id, inviteId),
    onSuccess: refresh,
  })
  const error = create.error ?? revoke.error ?? invites.error

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const role = inviteRoleSchema.safeParse(new FormData(event.currentTarget).get('role'))
    revoke.reset()
    if (role.success) create.mutate(role.data)
  }

  return (
    <Card className="mt-6">
      <h2 className="mb-1 text-base font-semibold">{texts.heading}</h2>
      <p className="mb-4 text-sm text-slate-500">{texts.hint}</p>
      {error && <Alert>{errorMessage(error)}</Alert>}

      <form onSubmit={handleCreate} className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="invite-role" className="mb-1 block text-sm font-medium">
            {texts.role}
          </label>
          <select id="invite-role" name="role" defaultValue="member" className={selectClass}>
            {inviteRoleSchema.options.map((role) => (
              <option key={role} value={role}>
                {t.common.role[role]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={create.isPending}>
          {texts.create}
        </Button>
      </form>

      {create.data && <NewLink key={create.data.id} invite={create.data} />}

      {invites.data && invites.data.length > 0 && (
        <ul
          aria-label={texts.listLabel}
          className="mt-4 divide-y divide-slate-200 dark:divide-slate-800"
        >
          {invites.data.map((invite) => (
            <li key={invite.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="font-medium">{t.common.role[invite.role]}</span>
              <span className="text-slate-500">
                {texts.validUntil(formatDate(invite.expiresAt))}
              </span>
              <button
                type="button"
                disabled={revoke.isPending}
                onClick={() => {
                  create.reset()
                  revoke.mutate(invite.id)
                }}
                aria-label={texts.revokeLabel(
                  t.common.role[invite.role],
                  formatDate(invite.expiresAt),
                )}
                className="ml-auto text-xs text-slate-500 hover:text-red-600 hover:underline"
              >
                {texts.revoke}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
