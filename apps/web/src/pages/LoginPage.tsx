import { loginRequestSchema } from '@chilladesk/shared'
import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { errorMessage } from '../api/client'
import { useAuthOptions, useLogin } from '../auth/useAuth'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../components/form'
import { Alert, Button, TextField } from '../components/ui'
import { useT } from '../i18n'
import { authLinkClass, AuthShell } from './AuthShell'

export function LoginPage() {
  const texts = useT().shell.auth
  const login = useLogin()
  const { emailEnabled } = useAuthOptions()
  const { forgotLink } = useT().account.email
  const location = useLocation()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = parseForm(loginRequestSchema, {
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    })
    if (!parsed.ok) {
      login.reset()
      setFieldErrors(parsed.errors)
      focusFirstInvalid(event.currentTarget, parsed.errors)
      return
    }
    setFieldErrors({})
    // No navigation here: signing in flips the app state and GuestOnly redirects.
    login.mutate(parsed.data)
  }

  return (
    <AuthShell
      title={texts.login.title}
      footer={
        <>
          {texts.login.noAccount} {/* Keep the requested page so signing up also returns to it. */}
          <Link to="/register" state={location.state} className={authLinkClass}>
            {texts.login.signUp}
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {login.isError && <Alert>{errorMessage(login.error)}</Alert>}
        <TextField
          label={texts.email}
          name="email"
          type="email"
          autoComplete="email"
          required
          error={fieldErrors.email}
        />
        <TextField
          label={texts.password}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={fieldErrors.password}
        />
        <Button type="submit" className="w-full" disabled={login.isPending}>
          {login.isPending ? texts.login.submitting : texts.login.submit}
        </Button>
        {emailEnabled && (
          <p className="text-center text-sm">
            <Link to="/forgot-password" className={authLinkClass}>
              {forgotLink}
            </Link>
          </p>
        )}
      </form>
    </AuthShell>
  )
}
