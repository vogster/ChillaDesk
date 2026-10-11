import { PASSWORD_MIN_LENGTH, registerRequestSchema } from '@chillawiki/shared'
import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { errorMessage } from '../api/client'
import { useRegister } from '../auth/useAuth'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../components/form'
import { Alert, Button, TextField } from '../components/ui'
import { authLinkClass, AuthShell } from './AuthShell'

export function RegisterPage() {
  const register = useRegister()
  const location = useLocation()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = parseForm(registerRequestSchema, {
      name: String(form.get('name') ?? ''),
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
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
      title="Create an account"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" state={location.state} className={authLinkClass}>
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {register.isError && <Alert>{errorMessage(register.error)}</Alert>}
        <TextField label="Name" name="name" autoComplete="name" required error={fieldErrors.name} />
        <TextField
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          error={fieldErrors.email}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          hint={`At least ${PASSWORD_MIN_LENGTH} characters`}
          error={fieldErrors.password}
        />
        <Button type="submit" className="w-full" disabled={register.isPending}>
          {register.isPending ? 'Creating account…' : 'Sign up'}
        </Button>
      </form>
    </AuthShell>
  )
}
