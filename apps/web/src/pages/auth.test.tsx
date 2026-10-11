import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ann,
  apiError,
  makeMember,
  makeProject,
  mockApi,
  noContent,
  ok,
  renderApp,
  session,
  signedOut,
} from '../test/render'

describe('signed-out visitors', () => {
  it('are sent to the login page', async () => {
    mockApi({ 'GET /api/auth/me': signedOut })

    renderApp('/')

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })

  it('see an error when the server cannot be reached', async () => {
    mockApi({ 'GET /api/auth/me': () => ({ status: 502, body: 'Bad Gateway' }) })

    renderApp('/')

    expect(await screen.findByRole('alert')).toHaveTextContent('Server error (HTTP 502)')
  })
})

describe('login', () => {
  it('signs in and returns to the page that was requested', async () => {
    const calls = mockApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/login': () => ok(session(ann)),
      'GET /api/projects': () => ok([]),
    })
    const { user } = renderApp('/')

    await user.type(await screen.findByLabelText('Email'), '  ann@example.com ')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByText('Ann')).toBeInTheDocument()
    expect(calls.find((call) => call.key === 'POST /api/auth/login')?.body).toEqual({
      email: 'ann@example.com',
      password: 'correct horse',
    })
  })

  it('validates the form before calling the API', async () => {
    const calls = mockApi({ 'GET /api/auth/me': signedOut })
    const { user } = renderApp('/login')

    await user.type(await screen.findByLabelText('Email'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(screen.getByLabelText('Email')).toBeInvalid()
    expect(screen.getByLabelText('Password')).toBeInvalid()
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false)
  })

  it('shows the server message for wrong credentials', async () => {
    mockApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/login': () => apiError(401, 'UNAUTHENTICATED', 'Invalid email or password'),
    })
    const { user } = renderApp('/login')

    await user.type(await screen.findByLabelText('Email'), 'ann@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
  })
})

describe('registration', () => {
  it('creates an account and opens the projects page', async () => {
    const calls = mockApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/register': () => ok(session(ann), 201),
      'GET /api/projects': () => ok([]),
    })
    const { user } = renderApp('/login')

    await user.click(await screen.findByRole('link', { name: 'Sign up' }))
    await user.type(screen.getByLabelText('Name'), 'Ann')
    await user.type(screen.getByLabelText('Email'), 'ann@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
    expect(calls.find((call) => call.key === 'POST /api/auth/register')?.body).toEqual({
      name: 'Ann',
      email: 'ann@example.com',
      password: 'correct horse',
    })
  })

  it('rejects a short password locally and shows a taken email from the server', async () => {
    mockApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/register': () =>
        apiError(409, 'CONFLICT', 'An account with this email already exists'),
    })
    const { user } = renderApp('/register')

    await user.type(await screen.findByLabelText('Name'), 'Ann')
    await user.type(screen.getByLabelText('Email'), 'ann@example.com')
    await user.type(screen.getByLabelText('Password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    expect(screen.getByLabelText('Password')).toBeInvalid()

    await user.type(screen.getByLabelText('Password'), ' but longer')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
  })
})

describe('signed-in users', () => {
  it('are redirected away from the login page', async () => {
    mockApi({ 'GET /api/auth/me': () => ok(ann), 'GET /api/projects': () => ok([]) })

    renderApp('/login')

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
  })

  it('can log out', async () => {
    const calls = mockApi({
      'GET /api/auth/me': () => ok(ann),
      'GET /api/projects': () => ok([]),
      'POST /api/auth/logout': noContent,
    })
    const { user } = renderApp('/')

    await user.click(await screen.findByRole('button', { name: 'Log out' }))

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(calls.some((call) => call.key === 'POST /api/auth/logout')).toBe(true)
  })

  it('see a not-found page for unknown addresses', async () => {
    mockApi({ 'GET /api/auth/me': () => ok(ann) })

    renderApp('/nowhere')

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})

describe('returning to the requested page', () => {
  const project = makeProject()
  const deepLink = `/projects/${project.id}`

  it('opens the page the visitor asked for once they log in', async () => {
    let signedIn = false
    mockApi({
      'GET /api/auth/me': () => (signedIn ? ok(ann) : signedOut()),
      'POST /api/auth/login': () => {
        signedIn = true
        return ok(session(ann))
      },
      [`GET /api${deepLink}`]: () => ok(project),
      [`GET /api${deepLink}/members`]: () => ok([makeMember(ann, 'owner')]),
      'GET /api/projects': () => ok([]),
    })
    const { user } = renderApp(deepLink)

    await user.type(await screen.findByLabelText('Email'), 'ann@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('heading', { name: 'Chilla', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Projects' })).not.toBeInTheDocument()
  })

  it('keeps the requested page when the visitor signs up instead', async () => {
    mockApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/register': () => ok(session(ann), 201),
      [`GET /api${deepLink}`]: () => ok(project),
      [`GET /api${deepLink}/members`]: () => ok([makeMember(ann, 'owner')]),
    })
    const { user } = renderApp(deepLink)

    await user.click(await screen.findByRole('link', { name: 'Sign up' }))
    await user.type(screen.getByLabelText('Name'), 'Ann')
    await user.type(screen.getByLabelText('Email'), 'ann@example.com')
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Sign up' }))

    expect(await screen.findByRole('heading', { name: 'Chilla', level: 1 })).toBeInTheDocument()
  })
})

describe('form feedback', () => {
  it('moves focus to the first invalid field', async () => {
    mockApi({ 'GET /api/auth/me': signedOut })
    const { user } = renderApp('/login')

    await user.type(await screen.findByLabelText('Password'), 'something')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(screen.getByLabelText('Email')).toHaveFocus()
  })

  it('removes an old server error when the next attempt fails local validation', async () => {
    mockApi({
      'GET /api/auth/me': signedOut,
      'POST /api/auth/login': () => apiError(401, 'UNAUTHENTICATED', 'Invalid email or password'),
    })
    const { user } = renderApp('/login')

    await user.type(await screen.findByLabelText('Email'), 'ann@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Log in' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Password'))
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInvalid()
  })
})

describe('session problems', () => {
  it('drops to the login page when the session has expired', async () => {
    mockApi({ 'GET /api/auth/me': () => ok(ann), 'GET /api/projects': signedOut })

    renderApp('/')

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })

  it('offers a retry when the first load fails', async () => {
    let attempts = 0
    mockApi({
      'GET /api/auth/me': () => {
        attempts += 1
        return attempts === 1 ? apiError(500, 'INTERNAL_ERROR', 'Internal server error') : ok(ann)
      },
      'GET /api/projects': () => ok([]),
    })
    const { user } = renderApp('/')

    await user.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: 'Projects' })).toBeInTheDocument()
  })
})
