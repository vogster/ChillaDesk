import {
  PASSWORD_MIN_LENGTH,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
} from '@chilladesk/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { errorMessage } from '../api/client'
import { confirmPasswordReset, requestPasswordReset, verifyEmail } from '../api/auth'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../components/form'
import { Alert, Button, Spinner, TextField } from '../components/ui'
import { useLinkToken } from '../hooks/useLinkToken'
import { useT } from '../i18n'
import { currentUserKey } from '../queryClient'
import { authLinkClass, AuthShell } from './AuthShell'

function BackToLogin() {
  const texts = useT().account.email
  return (
    <Link to="/login" className={authLinkClass}>
      {texts.backToLogin}
    </Link>
  )
}

/** `/forgot-password`: asks for the address to send a reset link to. */
export function ForgotPasswordPage() {
  const t = useT()
  const texts = t.account.email.forgot
  const request = useMutation({ mutationFn: requestPasswordReset })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = parseForm(passwordResetRequestSchema, {
      email: String(new FormData(event.currentTarget).get('email') ?? '').trim(),
    })
    setFieldErrors(parsed.ok ? {} : parsed.errors)
    if (!parsed.ok) {
      request.reset()
      focusFirstInvalid(event.currentTarget, parsed.errors)
      return
    }
    request.mutate(parsed.data.email)
  }

  return (
    <AuthShell title={texts.title} footer={<BackToLogin />}>
      {request.isSuccess ? (
        <p role="status" className="text-sm">
          {texts.sent}
        </p>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {request.isError && <Alert>{errorMessage(request.error)}</Alert>}
          <p className="text-sm text-slate-600 dark:text-slate-400">{texts.hint}</p>
          <TextField
            label={t.shell.auth.email}
            name="email"
            type="email"
            autoComplete="email"
            required
            error={fieldErrors.email}
          />
          <Button type="submit" className="w-full" disabled={request.isPending}>
            {texts.submit}
          </Button>
        </form>
      )}
    </AuthShell>
  )
}

/** `/reset-password#token=…`: where the link from the reset email leads. */
export function ResetPasswordPage() {
  const t = useT()
  const texts = t.account.email.reset
  const token = useLinkToken()
  const queryClient = useQueryClient()
  const reset = useMutation({
    mutationFn: confirmPasswordReset,
    // Every session of the account has just ended, this browser's included.
    onSuccess: () => queryClient.setQueryData(currentUserKey, null),
  })
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = parseForm(passwordResetConfirmSchema, {
      token,
      password: String(new FormData(event.currentTarget).get('password') ?? ''),
    })
    setFieldErrors(parsed.ok ? {} : parsed.errors)
    if (!parsed.ok) {
      reset.reset()
      focusFirstInvalid(event.currentTarget, parsed.errors)
      return
    }
    reset.mutate(parsed.data)
  }

  return (
    <AuthShell title={texts.title} footer={<BackToLogin />}>
      {reset.isSuccess ? (
        <p role="status" className="text-sm">
          {texts.done}
        </p>
      ) : token === '' ? (
        <p className="text-sm">{t.account.email.badLink}</p>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {reset.isError && <Alert>{errorMessage(reset.error)}</Alert>}
          <TextField
            label={t.account.profile.newPassword}
            name="password"
            type="password"
            autoComplete="new-password"
            required
            hint={t.shell.auth.register.passwordHint(PASSWORD_MIN_LENGTH)}
            error={fieldErrors.password}
          />
          <Button type="submit" className="w-full" disabled={reset.isPending}>
            {texts.submit}
          </Button>
        </form>
      )}
    </AuthShell>
  )
}

/**
 * `/verify-email#token=…`: where the link from the confirmation email leads. Only the
 * signed-in owner of the account can confirm it; a visitor is asked to log in first.
 */
export function VerifyEmailPage() {
  const t = useT()
  const texts = t.account.email.verify
  const token = useLinkToken()
  const queryClient = useQueryClient()
  // A query, not an effect: the token works once, and a query is not run twice for one key.
  const verification = useQuery({
    queryKey: ['verify-email', token],
    queryFn: async () => {
      await verifyEmail(token)
      await queryClient.invalidateQueries({ queryKey: currentUserKey })
      return true
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
        <Link to="/" className={authLinkClass}>
          {texts.continue}
        </Link>
      }
    >
      {token === '' && <p className="text-sm">{t.account.email.badLink}</p>}
      {token !== '' && verification.isPending && <Spinner />}
      {verification.isError && <Alert>{errorMessage(verification.error)}</Alert>}
      {verification.isSuccess && (
        <p role="status" className="text-sm">
          {texts.done}
        </p>
      )}
    </AuthShell>
  )
}
