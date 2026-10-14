import type { ImportResult } from '@chilladesk/shared'
import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { serverText } from '../../i18n/ru/serverText'
import {
  ann,
  apiError,
  doing,
  done,
  makeMember,
  makeProject,
  mockApi,
  ok,
  renderApp,
  todo,
  type ApiRoutes,
} from '../../test/render'

const project = makeProject()
const url = `/api/projects/${project.id}`
const settings = `/projects/${project.id}/settings`

function server(importAnswer: ApiRoutes[string]) {
  const calls = mockApi({
    'GET /api/auth/me': () => ok(ann),
    [`GET ${url}`]: () => ok(project),
    [`GET ${url}/members`]: () => ok([makeMember(ann, 'owner')]),
    [`GET ${url}/statuses`]: () => ok([todo, doing, done]),
    [`GET ${url}/labels`]: () => ok([]),
    [`GET ${url}/milestones`]: () => ok([]),
    [`POST ${url}/import/tasks`]: importAnswer,
  })
  return calls
}

const csvFile = () => new File(['Title\nOne'], 'tasks.csv', { type: 'text/csv' })
const boardFile = () => new File(['{}'], 'board.json', { type: 'application/json' })

describe('import and export settings', () => {
  it('links to both exports', async () => {
    server(() => ok({}))
    renderApp(settings)

    expect(await screen.findByRole('link', { name: 'Tasks as CSV' })).toHaveAttribute(
      'href',
      `${url}/export/tasks.csv`,
    )
    expect(screen.getByRole('link', { name: 'Wiki as ZIP of Markdown files' })).toHaveAttribute(
      'href',
      `${url}/export/wiki.zip`,
    )
  })

  it('sends the chosen file in the chosen format and shows what came of it', async () => {
    const result: ImportResult = {
      created: 2,
      skipped: [{ row: 4, reason: 'No title' }],
      warnings: ['Added the column "Ideas"'],
    }
    const calls = server(() => ok(result))
    const fetchSpy = vi.mocked(globalThis.fetch)
    const { user } = renderApp(settings)

    const importButton = await screen.findByRole('button', { name: 'Import' })
    expect(importButton).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Format'), 'trello')
    await user.upload(screen.getByLabelText('File'), boardFile())
    await user.click(importButton)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('Imported 2 tasks.')
    expect(status).toHaveTextContent('Row 4: No title')
    expect(status).toHaveTextContent('Added the column "Ideas"')
    expect(calls.map((call) => call.key)).toContain(`POST ${url}/import/tasks?format=trello`)
    const [, init] = fetchSpy.mock.calls.find(([input]) => String(input).includes('/import/'))!
    expect(init?.body).toBeInstanceOf(File)
  })

  it('shows why a file was refused', async () => {
    server(() => apiError(400, 'VALIDATION_ERROR', 'The file has no Title (or Summary) column'))
    const { user } = renderApp(settings)

    await user.upload(await screen.findByLabelText('File'), csvFile())
    await user.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The file has no Title (or Summary) column',
      ),
    )
  })
})

describe('Russian texts of the import', () => {
  it.each([
    ['No title', 'Нет названия'],
    ['Added the column "Ideas"', 'Добавлена колонка «Ideas»'],
    [
      '"x@example.com" is not a member of this project; left unassigned',
      '«x@example.com» не участвует в проекте; задача оставлена без исполнителя',
    ],
    [
      'Titles longer than 200 characters were shortened',
      'Названия длиннее 200 символов были сокращены',
    ],
    ['Archived card "Old"', 'Карточка «Old» в архиве'],
  ])('translates %s', (english, russian) => {
    expect(serverText(english)).toBe(russian)
  })
})
