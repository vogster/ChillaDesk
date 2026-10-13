import type { User } from '@chilladesk/shared'
import { screen, waitFor } from '@testing-library/react'
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
