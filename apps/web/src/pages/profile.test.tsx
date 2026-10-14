import type { User } from '@chilladesk/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyLocale } from '../i18n/messages'
import { ann, apiError, mockApi, noContent, ok, renderApp, type ApiRoutes } from '../test/render'

/** An in-memory account, so what the page saves comes back on the next read. */
function server(initial: Partial<User> = {}, extra: ApiRoutes = {}) {
  let user: User = { ...ann, ...initial }
  const calls = mockApi({
    'GET /api/auth/me': () => ok(user),
    'PATCH /api/auth/me': (body) => {
      user = { ...user, ...(body as Partial<User>) }
      return ok(user)
    },
    'GET /api/projects': () => ok([]),
    'GET /api/notifications': () => ok({ items: [], unreadCount: 0 }),
    ...extra,
  })
  const bodies = (key: string) => calls.filter((call) => call.key === key).map((call) => call.body)
  return { calls, bodies }
}

function browserLanguage(language: string) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue([language])
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(language)
}

afterEach(() => {
  applyLocale('en')
})

describe('the profile page', () => {
  it('is reached from the name in the header and shows the account', async () => {
    server({ emailVerified: false })
    const { user } = renderApp('/')

    await user.click(await screen.findByRole('link', { name: 'Profile of Ann' }))

    expect(await screen.findByRole('heading', { name: 'Profile' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('Ann')
    expect(screen.getByText(/ann@example\.com/)).toHaveTextContent('(not confirmed)')
  })

  it('saves a new name and shows it in the header', async () => {
    const api = server()
    const { user } = renderApp('/profile')
    const name = await screen.findByLabelText('Name')

    await user.clear(name)
    await user.type(name, 'Ann Lee')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(await screen.findByRole('link', { name: 'Profile of Ann Lee' })).toBeInTheDocument()
    expect(screen.getByText('Saved')).toBeInTheDocument()
    expect(api.bodies('PATCH /api/auth/me')).toEqual([{ name: 'Ann Lee' }])
  })

  it('does not send an empty name', async () => {
    const api = server()
    const { user } = renderApp('/profile')

    await user.clear(await screen.findByLabelText('Name'))
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(screen.getByLabelText('Name')).toBeInvalid()
    expect(api.bodies('PATCH /api/auth/me')).toEqual([])
  })

  it('turns notification emails off and on', async () => {
    const api = server()
    const { user } = renderApp('/profile')
    const box = await screen.findByRole('checkbox', {
      name: 'Also send my notifications by email',
    })
    expect(box).toBeChecked()

    await user.click(box)

    await waitFor(() => expect(box).not.toBeChecked())
    expect(api.bodies('PATCH /api/auth/me')).toEqual([{ emailNotifications: false }])
  })
})

describe('changing the password', () => {
  const fill = async (
    user: ReturnType<typeof renderApp>['user'],
    current: string,
    next: string,
  ) => {
    await user.type(await screen.findByLabelText('Current password'), current)
    await user.type(screen.getByLabelText('New password'), next)
    await user.click(screen.getByRole('button', { name: 'Change password' }))
  }

  it('sends both passwords, confirms and clears the form', async () => {
    const api = server({}, { 'POST /api/auth/password': () => noContent() })
    const { user } = renderApp('/profile')

    await fill(user, 'old password 1', 'new password 2')

    expect(await screen.findByText(/Password changed/)).toBeInTheDocument()
    expect(api.bodies('POST /api/auth/password')).toEqual([
      { currentPassword: 'old password 1', newPassword: 'new password 2' },
    ])
    expect(screen.getByLabelText('Current password')).toHaveValue('')
  })

  it('checks the new password before asking the server', async () => {
    const api = server()
    const { user } = renderApp('/profile')

    await fill(user, 'old password 1', 'short')

    expect(screen.getByLabelText('New password')).toBeInvalid()
    expect(api.bodies('POST /api/auth/password')).toEqual([])
  })

  it('shows a wrong current password at that field, in the language of the interface', async () => {
    browserLanguage('ru-RU')
    const wrong = {
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The current password is wrong',
          details: [{ path: 'currentPassword', message: 'The current password is wrong' }],
        },
      },
    }
    server({ locale: 'ru' }, { 'POST /api/auth/password': () => wrong })
    const { user } = renderApp('/profile')

    await user.type(await screen.findByLabelText('Текущий пароль'), 'not it at all')
    await user.type(screen.getByLabelText('Новый пароль'), 'new password 2')
    await user.click(screen.getByRole('button', { name: 'Сменить пароль' }))

    await waitFor(() => expect(screen.getByLabelText('Текущий пароль')).toBeInvalid())
    expect(screen.getByLabelText('Текущий пароль')).toHaveAccessibleDescription(
      'Текущий пароль неверен',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reports any other failure above the form', async () => {
    server({}, { 'POST /api/auth/password': () => apiError(429, 'RATE_LIMITED', 'Slow down') })
    const { user } = renderApp('/profile')

    await fill(user, 'old password 1', 'new password 2')

    expect(await screen.findByRole('alert')).toHaveTextContent('Slow down')
  })
})

describe('the language of the account', () => {
  it('follows the profile on a device where no language was picked', async () => {
    browserLanguage('en-US')
    const api = server({ locale: 'ru' })
    renderApp('/profile')

    expect(await screen.findByRole('heading', { name: 'Профиль' })).toBeInTheDocument()
    expect(api.bodies('PATCH /api/auth/me')).toEqual([])
  })

  it('tells the profile when the language is changed here', async () => {
    const api = server()
    const { user } = renderApp('/profile')
    await screen.findByRole('heading', { name: 'Profile' })

    // The header and the page both have the switcher; either will do.
    const [switcher] = screen.getAllByRole('combobox', { name: 'Language' })
    await user.selectOptions(switcher as HTMLElement, 'Русский')

    expect(await screen.findByRole('heading', { name: 'Профиль' })).toBeInTheDocument()
    await waitFor(() => expect(api.bodies('PATCH /api/auth/me')).toEqual([{ locale: 'ru' }]))
  })

  it('reports the language of a device to a profile that has none yet', async () => {
    browserLanguage('ru-RU')
    const api = server({ locale: null })
    renderApp('/profile')

    await screen.findByRole('heading', { name: 'Профиль' })

    await waitFor(() => expect(api.bodies('PATCH /api/auth/me')).toEqual([{ locale: 'ru' }]))
  })

  it('sends the language of the page with a new registration', async () => {
    browserLanguage('ru-RU')
    const calls = mockApi({
      'GET /api/auth/me': () => apiError(401, 'UNAUTHENTICATED', 'Authentication required'),
      'POST /api/auth/register': () =>
        ok({ user: { ...ann, locale: 'ru' }, token: 't', expiresAt: ann.createdAt }, 201),
    })
    const { user } = renderApp('/register')

    await user.type(await screen.findByLabelText('Имя'), 'Аня')
    await user.type(screen.getByLabelText('Эл. почта'), 'ann@example.com')
    await user.type(screen.getByLabelText(/Пароль/), 'correct horse battery')
    await user.click(screen.getByRole('button', { name: 'Зарегистрироваться' }))

    await waitFor(() =>
      expect(calls.find((call) => call.key === 'POST /api/auth/register')?.body).toMatchObject({
        locale: 'ru',
      }),
    )
  })
})

/** The card of the profile page under this heading. */
async function card(name: string): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name })
  return heading.closest('section') as HTMLElement
}

describe('changing the email address', () => {
  it('changes it at once on a server without email', async () => {
    const { bodies } = server(
      {},
      {
        'POST /api/auth/email': (body) => ok({ ...ann, ...(body as object), emailVerified: false }),
      },
    )
    const { user } = renderApp('/profile')

    const section = await card('Email address')
    await user.type(within(section).getByLabelText('New address'), 'new@example.com')
    await user.type(within(section).getByLabelText('Your password'), 'secret password')
    await user.click(within(section).getByRole('button', { name: 'Change address' }))

    expect(await within(section).findByRole('status')).toHaveTextContent('Address changed.')
    expect(screen.getByText(/new@example.com/)).toBeInTheDocument()
    expect(bodies('POST /api/auth/email')).toEqual([
      { email: 'new@example.com', password: 'secret password' },
    ])
  })

  it('asks to open the link sent to the new address when the server sends email', async () => {
    server({}, { 'POST /api/auth/email': () => ok({ confirmationSent: true }, 202) })
    const { user } = renderApp('/profile')

    const section = await card('Email address')
    await user.type(within(section).getByLabelText('New address'), 'new@example.com')
    await user.type(within(section).getByLabelText('Your password'), 'secret password')
    await user.click(within(section).getByRole('button', { name: 'Change address' }))

    expect(await within(section).findByRole('status')).toHaveTextContent(
      'Check new@example.com and open the link there',
    )
    expect(screen.getByText(/ann@example.com/)).toBeInTheDocument()
  })

  it('makes the change when the signed-in owner opens the link', async () => {
    const { bodies } = server(
      {},
      { 'POST /api/auth/email/confirm': () => ok({ ...ann, email: 'new@example.com' }) },
    )
    renderApp('/confirm-email#token=change-token')

    expect(
      await screen.findByText('Your account now uses this address. new@example.com'),
    ).toBeInTheDocument()
    expect(bodies('POST /api/auth/email/confirm')).toEqual([{ token: 'change-token' }])
  })
})

describe('deleting the account', () => {
  it('lists the projects to hand over first', async () => {
    server(
      {},
      {
        'POST /api/auth/me/delete': () => ({
          status: 409,
          body: {
            error: {
              code: 'CONFLICT',
              message: 'Make someone else an owner of your projects with other members first',
              details: [{ path: 'projects', message: 'Website' }],
            },
          },
        }),
      },
    )
    const { user } = renderApp('/profile')

    const section = await card('Delete account')
    await user.type(within(section).getByLabelText('Your password'), 'secret password')
    await user.click(within(section).getByRole('button', { name: 'Delete my account' }))

    const alert = await within(section).findByRole('alert')
    expect(alert).toHaveTextContent('First make someone else an owner of these projects:')
    expect(alert).toHaveTextContent('Website')
  })

  it('deletes it and goes to the login page', async () => {
    let deleted = false
    mockApi({
      'GET /api/auth/me': () => (deleted ? apiError(401, 'UNAUTHENTICATED', 'x') : ok(ann)),
      'GET /api/auth/options': () => ok({ registrationEnabled: true, emailEnabled: false }),
      'GET /api/notifications': () => ok({ items: [], unreadCount: 0 }),
      'POST /api/auth/me/delete': () => {
        deleted = true
        return noContent()
      },
    })
    const { user } = renderApp('/profile')

    const section = await card('Delete account')
    await user.type(within(section).getByLabelText('Your password'), 'secret password')
    await user.click(within(section).getByRole('button', { name: 'Delete my account' }))

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })
})
