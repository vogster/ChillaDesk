import { changeEmailRequestSchema } from '@chilladesk/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { changeEmail, deleteAccount } from '../../api/auth'
import { ApiError, errorMessage } from '../../api/client'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../../components/form'
import { Alert, Button, Card, TextField } from '../../components/ui'
import { useT } from '../../i18n'
import { currentUserKey } from '../../queryClient'

const headingClass = 'mb-3 text-base font-semibold'

/** The account's address: changed at once, or through a link to the new one. */
export function EmailForm() {
  const t = useT()
  const texts = t.account.profile
  const queryClient = useQueryClient()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const change = useMutation({
    mutationFn: changeEmail,
    onSuccess: (result) => {
      if (result !== 'pending') queryClient.setQueryData(currentUserKey, result)
    },
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const parsed = parseForm(changeEmailRequestSchema, {
      email: String(values.get('email') ?? '').trim(),
      password: String(values.get('password') ?? ''),
    })
    change.reset()
    setFieldErrors(parsed.ok ? {} : parsed.errors)
    if (!parsed.ok) {
      focusFirstInvalid(form, parsed.errors)
      return
    }
    change.mutate(parsed.data, { onSuccess: () => form.reset() })
  }

  return (
    <Card>
      <h2 className={headingClass}>{texts.emailSection}</h2>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {change.isError && <Alert>{errorMessage(change.error)}</Alert>}
        <TextField
          label={texts.newEmail}
          name="email"
          type="email"
          autoComplete="email"
          required
          error={fieldErrors.email}
        />
        <TextField
          label={texts.yourPassword}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={fieldErrors.password}
        />
        <p className="text-xs text-slate-500">{texts.changeEmailHint}</p>
        <Button type="submit" disabled={change.isPending}>
          {texts.changeEmail}
        </Button>
        {change.isSuccess && (
          <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
            {change.data === 'pending'
              ? texts.changeEmailSent(change.variables.email)
              : texts.emailChanged}
          </p>
        )}
      </form>
    </Card>
  )
}

/** The projects the server says must get another owner first. */
function blockingProjects(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.code !== 'CONFLICT') return []
  return error.details.filter((detail) => detail.path === 'projects').map((d) => d.message)
}

/** Deletes the account after the password is typed in. */
export function DeleteAccount() {
  const t = useT()
  const texts = t.account.profile
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const remove = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      queryClient.clear()
      queryClient.setQueryData(currentUserKey, null)
      void navigate('/login', { replace: true })
    },
  })
  const projects = blockingProjects(remove.error)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const password = String(new FormData(event.currentTarget).get('password') ?? '')
    if (password) remove.mutate({ password })
  }

  return (
    <Card className="border-red-200 dark:border-red-900">
      <h2 className={headingClass}>{texts.deleteSection}</h2>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{texts.deleteHint}</p>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {remove.isError && projects.length === 0 && <Alert>{errorMessage(remove.error)}</Alert>}
        {projects.length > 0 && (
          <Alert>
            {texts.handOver}
            <ul className="mt-1 list-disc pl-5">
              {projects.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </Alert>
        )}
        <TextField
          label={texts.yourPassword}
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Button type="submit" variant="danger" disabled={remove.isPending}>
          {texts.deleteAccount}
        </Button>
      </form>
    </Card>
  )
}
