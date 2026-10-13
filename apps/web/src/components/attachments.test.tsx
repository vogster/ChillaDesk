import type { Attachment } from '@chilladesk/shared'
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  ann,
  apiError,
  doing,
  done,
  makeMember,
  makeProject,
  makeTask,
  makeWikiPage,
  mockApi,
  noContent,
  ok,
  renderApp,
  summary,
  todo,
  type ApiRoutes,
} from '../test/render'
import { markdownImage } from './Attachments'

const project = makeProject()
const url = `/api/projects/${project.id}`
const task = makeTask(1, { title: 'With files' })
const listUrl = `${url}/tasks/${task.id}/attachments`

const attachment = (number: number, overrides: Partial<Attachment> = {}): Attachment => {
  const id = `99999999-9999-4999-8999-${String(number).padStart(12, '0')}`
  return {
    id,
    fileName: `file-${number}.txt`,
    mimeType: 'text/plain',
    size: 2048,
    isImage: false,
    url: `${url}/attachments/${id}`,
    uploadedBy: summary(ann),
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}
const picture = attachment(2, { fileName: 'shot [1].png', mimeType: 'image/png', isImage: true })

/** An in-memory stand-in for the attachment endpoints of one task. */
function server(initial: Attachment[], role: 'owner' | 'viewer' = 'owner', extra: ApiRoutes = {}) {
  let attachments = initial
  const routes: ApiRoutes = {
    'GET /api/auth/me': () => ok(ann),
    [`GET ${url}`]: () => ok(makeProject({ role })),
    [`GET ${url}/members`]: () => ok([makeMember(ann, role)]),
    [`GET ${url}/statuses`]: () => ok([todo, doing, done]),
    [`GET ${url}/labels`]: () => ok([]),
    [`GET ${url}/tasks`]: () => ok({ items: [task], total: 1 }),
    [`GET ${url}/tasks/${task.id}`]: () => ok(task),
    [`GET ${url}/tasks/${task.id}/comments`]: () => ok([]),
    [`GET ${listUrl}`]: () => ok(attachments),
    [`POST ${listUrl}`]: () => {
      const created = attachment(attachments.length + 10, { fileName: 'uploaded.txt' })
      attachments = [...attachments, created]
      return ok(created, 201)
    },
  }
  for (const existing of initial) {
    routes[`DELETE ${listUrl}/${existing.id}`] = () => {
      attachments = attachments.filter((item) => item.id !== existing.id)
      return noContent()
    }
  }
  return mockApi({ ...routes, ...extra })
}

async function openSection() {
  const dialog = await screen.findByRole('dialog')
  return within(dialog).findByRole('region', { name: 'Attachments' })
}

describe('attachments of a task', () => {
  it('lists files with their size and a download link, pictures with a preview', async () => {
    server([attachment(1), picture])
    renderApp(`/projects/${project.id}?task=${task.id}`)
    const section = await openSection()

    const link = await within(section).findByRole('link', { name: 'file-1.txt' })

    expect(link).toHaveAttribute('href', attachment(1).url)
    expect(link).toHaveAttribute('download', 'file-1.txt')
    expect(within(section).getAllByText('2 KB')).toHaveLength(2)
    const items = within(section).getAllByRole('listitem')
    expect(items[0]?.querySelector('img')).toBeNull()
    expect(items[1]?.querySelector('img')).toHaveAttribute('src', picture.url)
  })

  it('uploads the chosen file as it is, with its name and type in the headers', async () => {
    server([])
    const { user } = renderApp(`/projects/${project.id}?task=${task.id}`)
    const section = await openSection()
    const file = new File(['hello'], 'Отчёт.txt', { type: 'text/plain' })

    await user.upload(within(section).getByLabelText('Attach files'), file)

    expect(await within(section).findByRole('link', { name: 'uploaded.txt' })).toBeInTheDocument()
    const sent = vi
      .mocked(fetch)
      .mock.calls.find(([input, init]) => String(input) === listUrl && init?.method === 'POST')
    expect(sent?.[1]?.body).toBe(file)
    expect(sent?.[1]?.headers).toEqual({
      'Content-Type': 'text/plain',
      'X-File-Name': encodeURIComponent('Отчёт.txt'),
    })
  })

  it('says what the server refuses, for example a file that is too large', async () => {
    server([], 'owner', {
      [`POST ${listUrl}`]: () => apiError(413, 'VALIDATION_ERROR', 'The file is too large'),
    })
    const { user } = renderApp(`/projects/${project.id}?task=${task.id}`)
    const section = await openSection()

    await user.upload(
      within(section).getByLabelText('Attach files'),
      new File(['x'], 'huge.bin', { type: '' }),
    )

    expect(await within(section).findByRole('alert')).toHaveTextContent('too large')
  })

  it('removes a file', async () => {
    server([attachment(1), attachment(3)])
    const { user } = renderApp(`/projects/${project.id}?task=${task.id}`)
    const section = await openSection()

    await user.click(
      await within(section).findByRole('button', { name: 'Remove the file file-1.txt' }),
    )

    await waitFor(() =>
      expect(within(section).queryByRole('link', { name: 'file-1.txt' })).not.toBeInTheDocument(),
    )
    expect(within(section).getByRole('link', { name: 'file-3.txt' })).toBeInTheDocument()
  })

  it('copies the Markdown that shows a picture', async () => {
    server([picture])
    const { user } = renderApp(`/projects/${project.id}?task=${task.id}`)
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    const section = await openSection()

    await user.click(
      await within(section).findByRole('button', {
        name: 'Copy the Markdown for the picture shot [1].png',
      }),
    )

    expect(writeText).toHaveBeenCalledWith(`![shot 1.png](${picture.url})`)
    expect(await within(section).findByText('Copied')).toBeInTheDocument()
    expect(markdownImage(picture)).toBe(`![shot 1.png](${picture.url})`)
  })

  it('is read-only for a viewer, and hidden from them while empty', async () => {
    server([attachment(1)], 'viewer')
    const first = renderApp(`/projects/${project.id}?task=${task.id}`)
    const section = await openSection()
    expect(await within(section).findByRole('link', { name: 'file-1.txt' })).toBeInTheDocument()
    expect(within(section).queryByLabelText('Attach files')).not.toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
    first.unmount()

    server([], 'viewer')
    renderApp(`/projects/${project.id}?task=${task.id}`)
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByRole('heading', { name: 'With files' })
    expect(within(dialog).queryByRole('region', { name: 'Attachments' })).not.toBeInTheDocument()
  })
})

describe('pictures in Markdown', () => {
  it('shows attached pictures and leaves every other image out', async () => {
    const page = makeWikiPage(1, {
      title: 'Guide',
      content: [
        `![diagram](${picture.url})`,
        '![tracker](https://evil.example/pixel.png)',
        `![elsewhere](${url}/members)`,
        'Text stays.',
      ].join('\n\n'),
    })
    mockApi({
      'GET /api/auth/me': () => ok(ann),
      [`GET ${url}`]: () => ok(project),
      [`GET ${url}/wiki`]: () => ok([page]),
      [`GET ${url}/wiki/${page.id}`]: () => ok(page),
      [`GET ${url}/wiki/${page.id}/attachments`]: () => ok([]),
    })
    renderApp(`/projects/${project.id}/wiki/${page.id}`)

    expect(await screen.findByText('Text stays.')).toBeInTheDocument()

    const images = screen.getAllByRole('img')
    expect(images.map((image) => image.getAttribute('src'))).toEqual([picture.url])
    expect(images[0]).toHaveAttribute('alt', 'diagram')
    expect(await screen.findByRole('region', { name: 'Attachments' })).toBeInTheDocument()
  })
})
