import {
  changePasswordRequestSchema,
  PASSWORD_MIN_LENGTH,
  updateProfileRequestSchema,
  type User,
} from '@chilladesk/shared'
import { useState, type FormEvent } from 'react'
import { ApiError, errorMessage } from '../api/client'
import { useChangePassword, useUpdateProfile } from '../auth/useAuth'
import { focusFirstInvalid, parseForm, type FieldErrors } from '../components/form'
import { Alert, Button, Card, TextField } from '../components/ui'
import { currentMessages, LanguageSwitcher, useT } from '../i18n'

const headingClass = 'mb-3 text-base font-semibold'
const hintClass = 'mt-2 text-xs text-slate-500'

/** Field errors the server reported, in the language of the interface. */
function serverFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ApiError)) return {}
  const { serverText } = currentMessages().common.errors
  return Object.fromEntries(
    error.details.map(({ path, message }) => [path, serverText(message) ?? message]),
  )
}

function NameForm({ user }: { user: User }) {
  const t = useT()
  const texts = t.account.profile
  const update = useUpdateProfile()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsed = parseForm(updateProfileRequestSchema, {
      name: String(new FormData(event.currentTarget).get('name') ?? ''),
    })
    setFieldErrors(parsed.ok ? {} : parsed.errors)
    if (!parsed.ok) {
      update.reset()
      focusFirstInvalid(event.currentTarget, parsed.errors)
      return
    }
    update.mutate(parsed.data)
  }

  return (
    <Card>
      <h2 className={headingClass}>{texts.details}</h2>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {update.isError && <Alert>{errorMessage(update.error)}</Alert>}
        <TextField
          label={texts.name}
          name="name"
          defaultValue={user.name}
          autoComplete="name"
          required
          error={fieldErrors.name}
        />
        <p className="text-sm">
          <span className="font-medium">{texts.email}:</span> {user.email}{' '}
          <span className="text-slate-500">
            ({user.emailVerified ? texts.emailVerified : texts.emailNotVerified})
          </span>
        </p>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={update.isPending}>
            {texts.saveName}
          </Button>
          {update.isSuccess && update.variables.name !== undefined && (
            <span role="status" className="text-sm text-slate-500">
              {texts.saved}
            </span>
          )}
        </div>
      </form>
    </Card>
  )
}

function Preferences({ user }: { user: User }) {
  const texts = useT().account.profile
  const update = useUpdateProfile()

  return (
    <>
      <Card>
        <h2 className={headingClass}>{texts.language}</h2>
        {/* The switcher changes the interface at once; the profile follows it. */}
        <LanguageSwitcher />
        <p className={hintClass}>{texts.languageHint}</p>
      </Card>
      <Card>
        <h2 className={headingClass}>{texts.notifications}</h2>
        {update.isError && <Alert>{errorMessage(update.error)}</Alert>}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={user.emailNotifications}
            disabled={update.isPending}
            onChange={(event) => update.mutate({ emailNotifications: event.target.checked })}
          />
          {texts.emailNotifications}
        </label>
        <p className={hintClass}>{texts.emailNotificationsHint}</p>
      </Card>
    </>
  )
}

function PasswordForm() {
  const t = useT()
  const texts = t.account.profile
  const change = useChangePassword()
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const parsed = parseForm(changePasswordRequestSchema, {
      currentPassword: String(values.get('currentPassword') ?? ''),
      newPassword: String(values.get('newPassword') ?? ''),
    })
    setFieldErrors(parsed.ok ? {} : parsed.errors)
    if (!parsed.ok) {
      change.reset()
      focusFirstInvalid(form, parsed.errors)
      return
    }
    change.mutate(parsed.data, {
      onSuccess: () => form.reset(),
      onError: (error) => setFieldErrors(serverFieldErrors(error)),
    })
  }

  // A problem with one field is shown at that field; anything else above the form.
  const general = change.isError && Object.keys(fieldErrors).length === 0

  return (
    <Card>
      <h2 className={headingClass}>{texts.password}</h2>
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {general && <Alert>{errorMessage(change.error)}</Alert>}
        <TextField
          label={texts.currentPassword}
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          error={fieldErrors.currentPassword}
        />
        <TextField
          label={texts.newPassword}
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          hint={t.shell.auth.register.passwordHint(PASSWORD_MIN_LENGTH)}
          error={fieldErrors.newPassword}
        />
        <Button type="submit" disabled={change.isPending}>
          {texts.changePassword}
        </Button>
        {change.isSuccess && (
          <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
            {texts.passwordChanged}
          </p>
        )}
      </form>
    </Card>
  )
}

/** `/profile`: the signed-in user's own name, language, email preference and password. */
export function ProfilePage({ user }: { user: User }) {
  const texts = useT().account.profile
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{texts.title}</h1>
      <NameForm user={user} />
      <Preferences user={user} />
      <PasswordForm />
    </div>
  )
}
