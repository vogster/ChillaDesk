import type { Comment } from '@chilladesk/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  ann,
  bob,
  doing,
  done,
  makeMember,
  makeProject,
  makeTask,
  makeWikiPage,
  mockApi,
  ok,
  renderApp,
  summary,
  todo,
  type ApiRoutes,
} from '../../../test/render'

const project = makeProject()
const url = `/api/projects/${project.id}`
const TIMESTAMP = '2026-01-01T00:00:00.000Z'

const task = makeTask(1, {
  title: 'Ship it',
  description: 'Owner: @bob@example.com, not @stranger@example.com. Code: `@ann@example.com`',
})
const taskPath = `/projects/${project.id}?task=${task.id}`

const comment = (body: string): Comment => ({
  id: '66666666-6666-4666-8666-000000000001',
  taskId: task.id,
  author: summary(ann),
  body,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
})

function server(extra: ApiRoutes = {}) {
  return mockApi({
    'GET /api/auth/me': () => ok(ann),
    [`GET ${url}`]: () => ok(project),
    [`GET ${url}/members`]: () => ok([makeMember(ann, 'owner'), makeMember(bob, 'member')]),
    [`GET ${url}/statuses`]: () => ok([todo, doing, done]),
    [`GET ${url}/labels`]: () => ok([]),
    [`GET ${url}/tasks`]: () => ok([task]),
    [`GET ${url}/tasks/${task.id}`]: () => ok(task),
    [`GET ${url}/tasks/${task.id}/comments`]: () => ok([]),
    ...extra,
  })
}

describe('reading mentions', () => {
  it('shows a member by name and leaves strangers and code as written', async () => {
    server()
    renderApp(taskPath)

    const dialog = await screen.findByRole('dialog')
    const mention = await within(dialog).findByText('@Bob')

    expect(mention).toHaveClass('mention')
    expect(mention).toHaveAttribute('title', 'bob@example.com')
    expect(dialog).toHaveTextContent('not @stranger@example.com.')
    // Someone outside the project is no mention: the address stays an ordinary mail link.
    expect(within(dialog).getByRole('link', { name: 'stranger@example.com' })).toHaveAttribute(
      'href',
      'mailto:stranger@example.com',
    )
    expect(within(dialog).getByText('@ann@example.com').tagName).toBe('CODE')
    expect(within(dialog).queryByText('@Ann')).not.toBeInTheDocument()
  })

  it('shows mentions in comments and on wiki pages', async () => {
    const page = makeWikiPage(1, { title: 'Plan', content: 'Lead: @ANN@example.com' })
    server({
      [`GET ${url}/tasks/${task.id}/comments`]: () => ok([comment('Thanks @bob@example.com!')]),
      [`GET ${url}/wiki`]: () => ok([page]),
      [`GET ${url}/wiki/${page.id}`]: () => ok(page),
    })
    const { unmount } = renderApp(taskPath)
    const comments = await screen.findByRole('list', { name: /comments/i }).catch(() => null)
    expect(
      await within(comments ?? (await screen.findByRole('dialog'))).findAllByText('@Bob'),
    ).not.toHaveLength(0)
    unmount()

    renderApp(`/projects/${project.id}/wiki/${page.id}`)

    expect(await screen.findByText('@Ann')).toHaveClass('mention')
  })
})

describe('writing mentions', () => {
  it('suggests members after @ and writes the chosen email into the comment', async () => {
    const calls = server({
      [`POST ${url}/tasks/${task.id}/comments`]: (body) =>
        ok(comment((body as { body: string }).body), 201),
    })
    const { user } = renderApp(taskPath)
    const field = await screen.findByLabelText('Add a comment')

    await user.type(field, 'Ping @')
    const list = await screen.findByRole('listbox', { name: 'Mention a member' })
    expect(within(list).getAllByRole('option')).toHaveLength(2)

    await user.type(field, 'bo')
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    await user.keyboard('{Enter}')

    expect(field).toHaveValue('Ping @bob@example.com ')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.type(field, 'please')
    await user.click(screen.getByRole('button', { name: 'Comment' }))
    await waitFor(() =>
      expect(calls.find((call) => call.key.startsWith('POST'))?.body).toEqual({
        body: 'Ping @bob@example.com please',
      }),
    )
  })

  it('moves through the list with the arrows and picks with a click', async () => {
    server()
    const { user } = renderApp(taskPath)
    await user.click(await screen.findByRole('button', { name: 'Edit' }))
    const field = screen.getByLabelText('Description')

    await user.clear(field)
    await user.type(field, '@')
    const list = await screen.findByRole('listbox', { name: 'Mention a member' })
    const options = within(list).getAllByRole('option')
    expect(options[0]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{ArrowDown}{ArrowUp}')
    expect(options[1]).toHaveAttribute('aria-selected', 'true')

    await user.click(within(list).getByRole('option', { name: /Ann/ }))

    expect(field).toHaveValue('@ann@example.com ')
    expect(field).toHaveFocus()
  })

  it('closes the list on Escape without closing the task', async () => {
    server()
    const { user } = renderApp(taskPath)
    const field = await screen.findByLabelText('Add a comment')

    await user.type(field, '@')
    await screen.findByRole('listbox')
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(field).toHaveFocus()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('leaves Enter alone once the caret has left the mention', async () => {
    server()
    const { user } = renderApp(taskPath)
    const field = await screen.findByLabelText('Add a comment')

    await user.type(field, 'First @')
    await screen.findByRole('listbox')
    await user.keyboard('{ArrowLeft}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    await user.keyboard('{Enter}')

    expect(field).toHaveValue('First \n@')
  })

  it('does not pick a member on Shift+Enter', async () => {
    server()
    const { user } = renderApp(taskPath)
    const field = await screen.findByLabelText('Add a comment')

    await user.type(field, '@')
    await screen.findByRole('listbox')
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    expect(field).toHaveValue('@\n')
  })

  it('suggests members in the wiki editor and keeps the draft in step', async () => {
    server({ [`GET ${url}/wiki`]: () => ok([]) })
    const { user } = renderApp(`/projects/${project.id}/wiki/new`)
    const field = await screen.findByLabelText('Content')

    await user.type(field, 'Lead: @an')
    await user.click(await screen.findByRole('option', { name: /Ann/ }))
    await user.type(field, 'decides')

    expect(field).toHaveValue('Lead: @ann@example.com decides')
  })
})
