import { PASSWORD_MIN_LENGTH, registerRequestSchema } from '@chilladesk/shared'
import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { errorMessage } from '../api/client'
import { inviteTokenFrom } from '../auth/redirect'
import { useAuthOptions, useRegister } from '../auth/useAuth'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../components/form'
import { Alert, Button, TextField } from '../components/ui'
import { useLocale, useT } from '../i18n'
import { authLinkClass, AuthShell } from './AuthShell'

export function RegisterPage() {
  const texts = useT().shell.auth
  const register = useRegister()
  const [locale] = useLocale()
  const location = useLocation()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const { registration } = useAuthOptions()
  // Came here from an invite link: the sign-up brings it along and joins its project.
  const inviteToken = inviteTokenFrom(location.state)
  const closedToMe = registration === 'closed' || (registration === 'invite' && !inviteToken)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = parseForm(registerRequestSchema, {
      name: String(form.get('name') ?? ''),
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
      // The language of the page the account was made on becomes the user's own.
      locale,
      ...(inviteToken ? { inviteToken } : {}),
    })
    if (!parsed.ok) {
      register.reset()
      setFieldErrors(parsed.errors)
      focusFirstInvalid(event.currentTarget, parsed.errors)
      return
    }
    setFieldErrors({})
    // No navigation here: signing in flips the app state and GuestOnly redirects.
    register.mutate(parsed.data)
  }

  return (
    <AuthShell
      title={texts.register.title}
      footer={
        <>
          {texts.register.haveAccount}{' '}
          <Link to="/login" state={location.state} className={authLinkClass}>
            {texts.register.logIn}
          </Link>
        </>
      }
    >
      {closedToMe && (
        <p className="text-sm">
          {registration === 'invite' ? texts.login.invitationOnly : texts.register.closed}
        </p>
      )}
      {register.data === 'pending' && (
        <p role="status" className="text-sm">
          {texts.register.checkEmail(register.variables.email)}
        </p>
      )}
      <form
        onSubmit={handleSubmit}
        noValidate
        className="space-y-4"
        hidden={register.data === 'pending' || closedToMe}
      >
        {register.isError && <Alert>{errorMessage(register.error)}</Alert>}
        <TextField
          label={texts.name}
          name="name"
          autoComplete="name"
          required
          error={fieldErrors.name}
        />
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
          autoComplete="new-password"
          required
          hint={texts.register.passwordHint(PASSWORD_MIN_LENGTH)}
          error={fieldErrors.password}
        />
        <Button type="submit" className="w-full" disabled={register.isPending}>
          {register.isPending ? texts.register.submitting : texts.register.submit}
        </Button>
      </form>
    </AuthShell>
  )
}
