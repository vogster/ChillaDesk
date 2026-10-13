import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ann,
  apiError,
  mockApi,
  noContent,
  ok,
  renderApp,
  signedOut,
  type ApiRoutes,
} from '../test/render'

const withEmail = { registrationEnabled: true, emailEnabled: true }

const guest = (routes: ApiRoutes = {}) =>
  mockApi({
    'GET /api/auth/me': () => signedOut(),
    'GET /api/auth/options': () => ok(withEmail),
    ...routes,
  })

const bodyOf = (calls: ReturnType<typeof mockApi>, key: string) =>
  calls.find((call) => call.key === key)?.body

describe('forgotten password', () => {
  it('is offered on the login page only when the server sends email', async () => {
    guest()
    const first = renderApp('/login')
    expect(await screen.findByRole('link', { name: 'Forgot your password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
    first.unmount()

    guest({ 'GET /api/auth/options': () => ok({ ...withEmail, emailEnabled: false }) })
    renderApp('/login')
    await screen.findByRole('heading', { name: 'Log in' })
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Forgot your password?' })).not.toBeInTheDocument(),
    )
  })

  it('asks for the address and then says a link may be on its way', async () => {
    const calls = guest({ 'POST /api/auth/password-reset': () => noContent() })
    const { user } = renderApp('/forgot-password')

    await user.type(await screen.findByLabelText('Email'), 'ann@example.com')
    await user.click(screen.getByRole('button', { name: 'Send the link' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/If there is an account/)
    expect(bodyOf(calls, 'POST /api/auth/password-reset')).toEqual({ email: 'ann@example.com' })
    expect(screen.getByRole('link', { name: 'Back to log in' })).toHaveAttribute('href', '/login')
  })

  it('checks the address before sending and reports a failure', async () => {
    const calls = guest({
      'POST /api/auth/password-reset': () =>
        apiError(409, 'CONFLICT', 'This server is not set up to send email'),
    })
    const { user } = renderApp('/forgot-password')

    await user.type(await screen.findByLabelText('Email'), 'not an address')
    await user.click(screen.getByRole('button', { name: 'Send the link' }))
    expect(screen.getByLabelText('Email')).toBeInvalid()
    expect(bodyOf(calls, 'POST /api/auth/password-reset')).toBeUndefined()

    await user.clear(screen.getByLabelText('Email'))
    await user.type(screen.getByLabelText('Email'), 'ann@example.com')
    await user.click(screen.getByRole('button', { name: 'Send the link' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('not set up to send email')
  })
})

describe('choosing a new password from the emailed link', () => {
  it('sends the token of the link with the new password', async () => {
    const calls = guest({ 'POST /api/auth/password-reset/confirm': () => noContent() })
    const { user } = renderApp('/reset-password#token=reset-token-1')

    await user.type(await screen.findByLabelText('New password'), 'a brand new password')
    await user.click(screen.getByRole('button', { name: 'Set the new password' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/Your password was changed/)
    expect(bodyOf(calls, 'POST /api/auth/password-reset/confirm')).toEqual({
      token: 'reset-token-1',
      password: 'a brand new password',
    })
    // The token never becomes part of an address the browser requests.
    expect(calls.some((call) => call.key.includes('reset-token-1'))).toBe(false)
  })

  it('checks the password first and shows a link that no longer works', async () => {
    guest({
      'POST /api/auth/password-reset/confirm': () =>
        apiError(400, 'VALIDATION_ERROR', 'This link is not valid any more, ask for a new one'),
    })
    const { user } = renderApp('/reset-password#token=used')

    await user.type(await screen.findByLabelText('New password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Set the new password' }))
    expect(screen.getByLabelText('New password')).toBeInvalid()

    await user.type(screen.getByLabelText('New password'), ' but now long enough')
    await user.click(screen.getByRole('button', { name: 'Set the new password' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This link is not valid any more')
  })

  it('says so when the link has no token', async () => {
    guest()
    renderApp('/reset-password')

    expect(await screen.findByText(/This link is incomplete/)).toBeInTheDocument()
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument()
  })
})

describe('confirming the email address', () => {
  it('confirms with the token of the link, once, and shows the result', async () => {
    let verified = false
    const calls = mockApi({
      'GET /api/auth/me': () => ok({ ...ann, emailVerified: verified }),
      'POST /api/auth/verify-email': () => {
        verified = true
        return noContent()
      },
    })
    renderApp('/verify-email#token=verify-token-1')

    expect(await screen.findByText(/your email address is confirmed/)).toBeInTheDocument()
    const confirmations = calls.filter((call) => call.key === 'POST /api/auth/verify-email')
    expect(confirmations.map((call) => call.body)).toEqual([{ token: 'verify-token-1' }])
    expect(screen.getByRole('link', { name: 'Go to ChillaDesk' })).toHaveAttribute('href', '/')
  })

  it('reports a link that was used already, and one without a token', async () => {
    mockApi({
      'GET /api/auth/me': () => ok(ann),
      'POST /api/auth/verify-email': () =>
        apiError(400, 'VALIDATION_ERROR', 'This link is not valid any more, ask for a new one'),
    })
    const first = renderApp('/verify-email#token=old')
    expect(await screen.findByRole('alert')).toHaveTextContent('not valid any more')
    first.unmount()

    mockApi({ 'GET /api/auth/me': () => ok(ann) })
    renderApp('/verify-email')
    expect(await screen.findByText(/This link is incomplete/)).toBeInTheDocument()
  })

  it('asks a visitor to log in first: the link alone confirms nothing', async () => {
    let signedIn = false
    const calls = mockApi({
      'GET /api/auth/me': () => (signedIn ? ok(ann) : signedOut()),
      'POST /api/auth/login': () => {
        signedIn = true
        return ok({ user: ann, token: 't', expiresAt: ann.createdAt })
      },
      'POST /api/auth/verify-email': () => noContent(),
    })
    const { user } = renderApp('/verify-email#token=verify-token-2')

    await user.type(await screen.findByLabelText('Email'), 'ann@example.com')
    expect(calls.some((call) => call.key === 'POST /api/auth/verify-email')).toBe(false)
    await user.type(screen.getByLabelText('Password'), 'correct horse')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText(/your email address is confirmed/)).toBeInTheDocument()
    expect(bodyOf(calls, 'POST /api/auth/verify-email')).toEqual({ token: 'verify-token-2' })
  })

  it('offers to send the email again from the profile of an unconfirmed account', async () => {
    const calls = mockApi({
      'GET /api/auth/me': () => ok({ ...ann, emailVerified: false }),
      'GET /api/auth/options': () => ok(withEmail),
      'GET /api/notifications': () => ok({ items: [], unreadCount: 0 }),
      'POST /api/auth/verify-email/resend': () => noContent(),
    })
    const { user } = renderApp('/profile')

    await user.click(await screen.findByRole('button', { name: 'Send a confirmation email' }))

    expect(await screen.findByText(/Open the link in the email/)).toBeInTheDocument()
    expect(calls.filter((call) => call.key === 'POST /api/auth/verify-email/resend')).toHaveLength(
      1,
    )
  })

  it('does not offer it for a confirmed address or when the server sends no email', async () => {
    mockApi({
      'GET /api/auth/me': () => ok({ ...ann, emailVerified: false }),
      'GET /api/auth/options': () => ok({ ...withEmail, emailEnabled: false }),
      'GET /api/notifications': () => ok({ items: [], unreadCount: 0 }),
    })
    renderApp('/profile')

    await screen.findByRole('heading', { name: 'Profile' })
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(
      screen.queryByRole('button', { name: 'Send a confirmation email' }),
    ).not.toBeInTheDocument()
  })
})
