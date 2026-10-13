import { screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ann,
  apiError,
  doing,
  done,
  makeMember,
  makeProject,
  makeTask,
  mockApi,
  ok,
  renderApp,
  signedOut,
  todo,
  type ApiRoutes,
} from '../test/render'
import { applyLocale } from './messages'

const project = makeProject()
const url = `/api/projects/${project.id}`

function signedIn(extra: ApiRoutes = {}) {
  return mockApi({
    'GET /api/auth/me': () => ok(ann),
    'GET /api/projects': () => ok([project]),
    'GET /api/notifications': () => ok({ items: [], unreadCount: 2 }),
    'GET /api/me/tasks': () => ok([]),
    [`GET ${url}`]: () => ok(project),
    [`GET ${url}/members`]: () => ok([makeMember(ann, 'owner')]),
    [`GET ${url}/statuses`]: () => ok([todo, doing, done]),
    [`GET ${url}/labels`]: () => ok([]),
    [`GET ${url}/tasks`]: () =>
      ok({ items: [makeTask(1, { priority: 'urgent', dueDate: '2030-05-17' })], total: 1 }),
    ...extra,
  })
}

function browserLanguage(language: string) {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue([language])
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(language)
}

afterEach(() => {
  applyLocale('en')
})

describe('interface language', () => {
  it('switches the whole screen from the header and remembers the choice', async () => {
    signedIn()
    const first = renderApp('/')
    expect(await screen.findByRole('link', { name: 'My tasks' })).toBeInTheDocument()

    await first.user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'Русский')

    expect(screen.getByRole('link', { name: 'Мои задачи' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Проекты' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Выйти' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Уведомления, 2 непрочитанных' })).toBeInTheDocument()
    expect(screen.queryByText('My tasks')).not.toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ru')
    first.unmount()

    renderApp('/my-tasks')

    expect(await screen.findByRole('heading', { name: 'Мои задачи' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Язык' })).toHaveValue('ru')
  })

  it('starts in the language of the browser, also before signing in', async () => {
    browserLanguage('ru-RU')
    mockApi({ 'GET /api/auth/me': () => signedOut() })
    const { user } = renderApp('/login')

    expect(await screen.findByRole('heading', { name: 'Вход' })).toBeInTheDocument()
    expect(screen.getByLabelText('Пароль')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Язык' }), 'English')

    expect(screen.getByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })

  it('shows a project board in Russian, with dates in the Russian manner', async () => {
    browserLanguage('ru-RU')
    signedIn({ 'GET /api/auth/me': () => ok({ ...ann, locale: 'ru' }) })
    renderApp(`/projects/${project.id}`)

    expect(await screen.findByRole('link', { name: 'Доска' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Участники' })).toBeInTheDocument()
    expect(await screen.findByText('Срочный')).toBeInTheDocument()
    expect(await screen.findByText(/17 мая/)).toBeInTheDocument()
    expect(screen.queryByText('Urgent')).not.toBeInTheDocument()
  })

  it('translates what the server answers and what the form checks', async () => {
    browserLanguage('ru-RU')
    mockApi({
      'GET /api/auth/me': () => signedOut(),
      'POST /api/auth/login': () => apiError(401, 'UNAUTHENTICATED', 'Invalid email or password'),
    })
    const { user } = renderApp('/login')

    await user.click(await screen.findByRole('button', { name: 'Войти' }))
    expect(screen.getByLabelText('Эл. почта')).toBeInvalid()
    expect(screen.getByLabelText('Эл. почта')).toHaveAccessibleDescription(/[а-яё]/i)

    await user.type(screen.getByLabelText('Эл. почта'), 'ann@example.com')
    await user.type(screen.getByLabelText('Пароль'), 'wrong password')
    await user.click(screen.getByRole('button', { name: 'Войти' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Неверный email или пароль')
  })
})
