import type { CreatedWebhook, Webhook } from '@chilladesk/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { serverText } from '../../../i18n/ru/serverText'
import {
  ann,
  apiError,
  doing,
  done,
  makeMember,
  makeProject,
  mockApi,
  noContent,
  ok,
  renderApp,
  todo,
  type ApiRoutes,
} from '../../../test/render'

const project = makeProject()
const url = `/api/projects/${project.id}`
const settings = `/projects/${project.id}/settings`

const webhook = (overrides: Partial<Webhook> = {}): Webhook => ({
  id: 'abababab-abab-4bab-8bab-000000000001',
  url: 'https://hooks.slack.com/services/T0/B0/secret',
  format: 'slack',
  events: ['task.created', 'comment.created'],
  active: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  lastDelivery: null,
  ...overrides,
})

function server(initial: Webhook[], extra: ApiRoutes = {}) {
  let webhooks = initial
  const routes: ApiRoutes = {
    'GET /api/auth/me': () => ok(ann),
    [`GET ${url}`]: () => ok(project),
    [`GET ${url}/members`]: () => ok([makeMember(ann, 'owner')]),
    [`GET ${url}/statuses`]: () => ok([todo, doing, done]),
    [`GET ${url}/labels`]: () => ok([]),
    [`GET ${url}/milestones`]: () => ok([]),
    [`GET ${url}/webhooks`]: () => ok(webhooks),
    [`POST ${url}/webhooks`]: (body) => {
      const input = body as Pick<Webhook, 'url' | 'format' | 'events'>
      const created: CreatedWebhook = {
        ...webhook({ id: 'abababab-abab-4bab-8bab-000000000002', ...input }),
        secret: 'very-secret-value',
      }
      const { secret: _secret, ...listed } = created
      webhooks = [...webhooks, listed]
      return ok(created, 201)
    },
  }
  for (const existing of initial) {
    routes[`PATCH ${url}/webhooks/${existing.id}`] = (body) => {
      const updated = { ...existing, ...(body as Partial<Webhook>) }
      webhooks = webhooks.map((item) => (item.id === existing.id ? updated : item))
      return ok(updated)
    }
    routes[`DELETE ${url}/webhooks/${existing.id}`] = () => {
      webhooks = webhooks.filter((item) => item.id !== existing.id)
      return noContent()
    }
  }
  const calls = mockApi({ ...routes, ...extra })
  return { bodyOf: (key: string) => calls.findLast((call) => call.key === key)?.body, calls }
}

describe('webhook settings', () => {
  it('lists webhooks by host only, with their events and last delivery', async () => {
    server([
      webhook({
        lastDelivery: {
          id: 'cdcdcdcd-cdcd-4dcd-8dcd-000000000001',
          event: 'task.created',
          status: 'failed',
          attempts: 6,
          responseStatus: 404,
          error: 'The receiver answered HTTP 404',
          createdAt: '2026-10-02T10:00:00.000Z',
          lastAttemptAt: '2026-10-02T15:00:00.000Z',
        },
      }),
    ])
    renderApp(settings)

    expect(await screen.findByText('hooks.slack.com')).toBeInTheDocument()
    expect(screen.queryByText(/T0\/B0/)).not.toBeInTheDocument()
    expect(screen.getByText('Task created, Comment added')).toBeInTheDocument()
    expect(
      screen.getByText('Last delivery failed: The receiver answered HTTP 404'),
    ).toBeInTheDocument()
  })

  it('adds a webhook with the chosen format and events and shows its secret once', async () => {
    const { bodyOf } = server([])
    const { user } = renderApp(settings)

    await user.type(await screen.findByLabelText('Address'), 'https://ci.example.com/hook')
    await user.selectOptions(screen.getByLabelText('Message format'), 'Telegram message')
    await user.click(screen.getByLabelText('Wiki page edited'))
    await user.click(screen.getByLabelText('Task created'))
    await user.click(screen.getByRole('button', { name: 'Add webhook' }))

    expect(await screen.findByText('very-secret-value')).toBeInTheDocument()
    expect(bodyOf(`POST ${url}/webhooks`)).toEqual({
      url: 'https://ci.example.com/hook',
      format: 'telegram',
      events: ['task.updated', 'comment.created', 'page.updated'],
    })
    expect(await screen.findByText('ci.example.com')).toBeInTheDocument()
  })

  it('checks the form before sending it', async () => {
    const { calls } = server([])
    const { user } = renderApp(settings)

    await user.type(await screen.findByLabelText('Address'), 'ftp://example.com')
    for (const event of ['Task created', 'Task changed or moved', 'Comment added']) {
      await user.click(screen.getByLabelText(event))
    }
    await user.click(screen.getByRole('button', { name: 'Add webhook' }))

    expect(await screen.findByText('Must be an http:// or https:// address')).toBeInTheDocument()
    expect(screen.getByText('Choose at least one event')).toBeInTheDocument()
    expect(calls.some((call) => call.key === `POST ${url}/webhooks`)).toBe(false)
  })

  it('turns a webhook off, sends a test and deletes it', async () => {
    const existing = webhook()
    const { bodyOf, calls } = server([existing], {
      [`POST ${url}/webhooks/${existing.id}/test`]: () =>
        ok(
          {
            id: 'cdcdcdcd-cdcd-4dcd-8dcd-000000000002',
            event: 'ping',
            status: 'pending',
            attempts: 0,
            responseStatus: null,
            error: null,
            createdAt: '2026-10-02T10:00:00.000Z',
            lastAttemptAt: null,
          },
          202,
        ),
    })
    const { user } = renderApp(settings)

    await user.click(await screen.findByRole('button', { name: 'Send test' }))
    await waitFor(() =>
      expect(calls.map((call) => call.key)).toContain(`POST ${url}/webhooks/${existing.id}/test`),
    )

    await user.click(screen.getByRole('checkbox', { name: 'On' }))
    await waitFor(() =>
      expect(bodyOf(`PATCH ${url}/webhooks/${existing.id}`)).toEqual({ active: false }),
    )
    expect(await screen.findByRole('button', { name: 'Send test' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Delete the webhook to hooks.slack.com' }))
    expect(await screen.findByText('No webhooks yet.')).toBeInTheDocument()
  })

  it('shows why the server refused a webhook', async () => {
    server([], {
      [`POST ${url}/webhooks`]: () =>
        apiError(
          400,
          'VALIDATION_ERROR',
          'Webhooks cannot point at private addresses on this server',
        ),
    })
    const { user } = renderApp(settings)

    await user.type(await screen.findByLabelText('Address'), 'http://10.0.0.5/hook')
    await user.click(screen.getByRole('button', { name: 'Add webhook' }))

    const card = (await screen.findByRole('heading', { name: 'Webhooks' })).parentElement!
    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'Webhooks cannot point at private addresses on this server',
    )
  })
})

describe('Russian texts of webhooks', () => {
  it.each([
    ['The receiver answered HTTP 503', 'Получатель ответил HTTP 503'],
    ['No answer within 10 s', 'Нет ответа за 10 с'],
    ['10.0.0.5 is not a public address', '10.0.0.5 — не публичный адрес'],
    ['Webhook not found', 'Вебхук не найден'],
  ])('translates %s', (english, russian) => {
    expect(serverText(english)).toBe(russian)
  })
})
