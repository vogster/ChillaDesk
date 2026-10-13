import { readdir, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Attachment, Task, WikiPage } from '@chilladesk/shared'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  type ProjectFixture,
  type TestContext,
  type TestUser,
} from '../../test/harness'
import { cleanFileName, cleanMimeType, MAX_ATTACHMENTS_PER_ITEM, sweepFiles } from './service'
import { createFileStore } from './storage'

const MAX_BYTES = 2000
let ctx: TestContext
let filesDir: string

beforeAll(async () => {
  filesDir = await mkdtemp(join(tmpdir(), 'chilladesk-attachments-'))
  ctx = await createTestContext({ filesDir, maxUploadBytes: MAX_BYTES })
})

afterAll(async () => {
  await ctx.close()
  await rm(filesDir, { recursive: true, force: true })
})

async function addTask(fixture: ProjectFixture, title = 'With files'): Promise<Task> {
  return (await fixture.call(fixture.owner, 'POST', '/tasks', { title })).json<Task>()
}

interface UploadOptions {
  name?: string
  type?: string
  content?: string | Buffer
  user?: TestUser
}

function upload(fixture: ProjectFixture, path: string, options: UploadOptions = {}) {
  const {
    name = 'notes.txt',
    type = 'text/plain',
    content = 'hello',
    user = fixture.member,
  } = options
  return ctx.app.inject({
    method: 'POST',
    url: `/api/projects/${fixture.project.id}${path}`,
    headers: {
      ...user.headers,
      'content-type': type,
      'x-file-name': encodeURIComponent(name),
    },
    payload: typeof content === 'string' ? Buffer.from(content) : content,
  })
}

const download = (
  fixture: ProjectFixture,
  attachment: Attachment,
  user: TestUser = fixture.viewer,
) => ctx.app.inject({ method: 'GET', url: attachment.url, headers: user.headers })

describe('attaching files to a task', () => {
  it('stores a file and lists it with its name, type, size and uploader', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture)
    const path = `/tasks/${task.id}/attachments`

    const response = await upload(fixture, path, { name: 'Отчёт за май.txt', content: 'hello' })

    expect(response.statusCode, response.body).toBe(201)
    const created = response.json<Attachment>()
    expect(created).toMatchObject({
      fileName: 'Отчёт за май.txt',
      mimeType: 'text/plain',
      size: 5,
      isImage: false,
      url: `/api/projects/${fixture.project.id}/attachments/${created.id}`,
      uploadedBy: { id: fixture.member.id },
    })
    const listed = (await fixture.call(fixture.viewer, 'GET', path)).json<Attachment[]>()
    expect(listed).toEqual([created])
  })

  it('gives the file back as a download that can never run as a page', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture)
    const html = '<script>alert(1)</script>'
    const attachment = (
      await upload(fixture, `/tasks/${task.id}/attachments`, {
        name: 'page "one".html',
        type: 'text/html',
        content: html,
      })
    ).json<Attachment>()

    const response = await download(fixture, attachment)

    expect(response.statusCode).toBe(200)
    expect(response.body).toBe(html)
    expect(response.headers['content-type']).toBe('application/octet-stream')
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="page _one_.html"; filename*=UTF-8''page%20%22one%22.html`,
    )
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
  })

  it('shows known picture types in place, and SVG never', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture)
    const path = `/tasks/${task.id}/attachments`
    const png = (
      await upload(fixture, path, { name: 'a.png', type: 'image/png' })
    ).json<Attachment>()
    const svg = (
      await upload(fixture, path, { name: 'a.svg', type: 'image/svg+xml', content: '<svg/>' })
    ).json<Attachment>()

    const [shown, saved] = [await download(fixture, png), await download(fixture, svg)]

    expect([png.isImage, svg.isImage]).toEqual([true, false])
    expect(shown.headers['content-type']).toBe('image/png')
    expect(shown.headers['content-disposition']).toMatch(/^inline;/)
    expect(saved.headers['content-type']).toBe('application/octet-stream')
    expect(saved.headers['content-disposition']).toMatch(/^attachment;/)
  })

  it('keeps binary content byte for byte, whatever type it claims', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture)
    const bytes = Buffer.from([0, 255, 1, 254, 123, 34, 125, 10])
    const attachment = (
      await upload(fixture, `/tasks/${task.id}/attachments`, {
        name: 'data.json',
        type: 'application/json',
        content: bytes,
      })
    ).json<Attachment>()

    const response = await download(fixture, attachment)

    expect(response.rawPayload.equals(bytes)).toBe(true)
    expect(attachment.size).toBe(bytes.length)
  })

  it('refuses a file that is too large, empty or unnamed, and limits how many there are', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture)
    const path = `/tasks/${task.id}/attachments`

    const tooLarge = await upload(fixture, path, { content: 'x'.repeat(MAX_BYTES + 1) })
    const empty = await upload(fixture, path, { content: '' })
    const unnamed = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${fixture.project.id}${path}`,
      headers: { ...fixture.member.headers, 'content-type': 'text/plain' },
      payload: Buffer.from('x'),
    })
    const badName = await ctx.app.inject({
      method: 'POST',
      url: `/api/projects/${fixture.project.id}${path}`,
      headers: {
        ...fixture.member.headers,
        'content-type': 'text/plain',
        'x-file-name': '%E0%A4%A',
      },
      payload: Buffer.from('x'),
    })
    for (let index = 0; index < MAX_ATTACHMENTS_PER_ITEM; index += 1) {
      await upload(fixture, path, { name: `${index}.txt` })
    }
    const oneTooMany = await upload(fixture, path)

    expect(
      [tooLarge, empty, unnamed, badName, oneTooMany].map((response) => response.statusCode),
    ).toEqual([413, 400, 400, 400, 409])
    // Nothing of the refused uploads was kept.
    expect((await fixture.call(fixture.viewer, 'GET', path)).json()).toHaveLength(
      MAX_ATTACHMENTS_PER_ITEM,
    )
  })

  it('removes a file, and with it its bytes', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture)
    const other = await addTask(fixture, 'Other')
    const before = (await readdir(filesDir)).length
    const attachment = (await upload(fixture, `/tasks/${task.id}/attachments`)).json<Attachment>()
    const remove = (taskId: string, user: TestUser = fixture.member) =>
      fixture.call(user, 'DELETE', `/tasks/${taskId}/attachments/${attachment.id}`)

    // Only through the task it is attached to.
    const wrongTask = await remove(other.id)
    const removed = await remove(task.id)
    const again = await remove(task.id)

    expect([wrongTask.statusCode, removed.statusCode, again.statusCode]).toEqual([404, 204, 404])
    expect((await download(fixture, attachment)).statusCode).toBe(404)
    expect(await readdir(filesDir)).toHaveLength(before)
  })

  it('lets viewers read and members change; outsiders and strangers get nothing', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    const task = await addTask(fixture)
    const path = `/tasks/${task.id}/attachments`
    const attachment = (await upload(fixture, path)).json<Attachment>()

    const statuses = [
      (await upload(fixture, path, { user: fixture.viewer })).statusCode,
      (await fixture.call(fixture.viewer, 'DELETE', `${path}/${attachment.id}`)).statusCode,
      (await upload(fixture, path, { user: fixture.outsider })).statusCode,
      (await fixture.call(fixture.outsider, 'GET', path)).statusCode,
      (await download(fixture, attachment, fixture.outsider)).statusCode,
      (await ctx.app.inject({ method: 'GET', url: attachment.url })).statusCode,
      // The id of a file does not open it through another project.
      (
        await ctx.app.inject({
          method: 'GET',
          url: `/api/projects/${other.project.id}/attachments/${attachment.id}`,
          headers: other.owner.headers,
        })
      ).statusCode,
    ]

    expect(statuses).toEqual([403, 403, 404, 404, 404, 401, 404])
  })
})

describe('attaching files to a wiki page', () => {
  it('works the same way, and a file of a page is not a file of a task', async () => {
    const fixture = await ctx.createProject()
    const page = (
      await fixture.call(fixture.owner, 'POST', '/wiki', { title: 'Guide', content: '' })
    ).json<WikiPage>()
    const task = await addTask(fixture)
    const path = `/wiki/${page.id}/attachments`

    const attachment = (
      await upload(fixture, path, { name: 'diagram.png', type: 'image/png' })
    ).json<Attachment>()

    expect((await fixture.call(fixture.viewer, 'GET', path)).json()).toEqual([attachment])
    expect(
      (await fixture.call(fixture.viewer, 'GET', `/tasks/${task.id}/attachments`)).json(),
    ).toEqual([])
    expect((await download(fixture, attachment)).statusCode).toBe(200)
    const viaTask = await fixture.call(
      fixture.member,
      'DELETE',
      `/tasks/${task.id}/attachments/${attachment.id}`,
    )
    expect(viaTask.statusCode).toBe(404)
    expect(
      (await fixture.call(fixture.member, 'DELETE', `${path}/${attachment.id}`)).statusCode,
    ).toBe(204)
  })

  it('answers 404 for a page that is not there', async () => {
    const fixture = await ctx.createProject()
    const missing = '00000000-0000-4000-8000-000000000000'

    expect((await upload(fixture, `/wiki/${missing}/attachments`)).statusCode).toBe(404)
    expect((await upload(fixture, `/tasks/${missing}/attachments`)).statusCode).toBe(404)
  })
})

describe('files left behind', () => {
  it('are swept once nothing refers to them, but not while they are fresh', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chilladesk-sweep-'))
    const swept = await createTestContext({ filesDir: dir })
    const fixture = await swept.createProject()
    const task = (
      await fixture.call(fixture.owner, 'POST', '/tasks', { title: 'Gone soon' })
    ).json<Task>()
    const kept = (
      await fixture.call(fixture.owner, 'POST', '/tasks', { title: 'Stays' })
    ).json<Task>()
    const send = (taskId: string) =>
      swept.app.inject({
        method: 'POST',
        url: `/api/projects/${fixture.project.id}/tasks/${taskId}/attachments`,
        headers: { ...fixture.owner.headers, 'content-type': 'text/plain', 'x-file-name': 'a.txt' },
        payload: Buffer.from('x'),
      })
    await send(task.id)
    await send(kept.id)

    // Deleting the task removes the row at once; the bytes are still on the disk.
    await fixture.call(fixture.owner, 'DELETE', `/tasks/${task.id}`)
    expect(await readdir(dir)).toHaveLength(2)
    const tooSoon = await sweepFiles(swept.database.db, swept.app.files)
    const hourAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    for (const name of await readdir(dir)) await utimes(join(dir, name), hourAgo, hourAgo)
    const later = await sweepFiles(swept.database.db, swept.app.files)

    expect([tooSoon, later]).toEqual([0, 1])
    expect(await readdir(dir)).toHaveLength(1)
    await swept.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('sweeping a store that was never used does nothing', async () => {
    const store = createFileStore(join(tmpdir(), 'chilladesk-never-created'))

    expect(await store.sweep(() => Promise.resolve(new Set()))).toBe(0)
    expect(() => store.open('../../etc/passwd')).toThrow('Invalid storage key')
  })
})

describe('cleaning what a client sends', () => {
  it('keeps only the name of a file, without path or control characters', () => {
    expect(cleanFileName('C:\\Users\\me\\report.pdf')).toBe('report.pdf')
    expect(cleanFileName('../../etc/passwd')).toBe('passwd')
    expect(cleanFileName('a\r\nb\u0000.txt')).toBe('ab.txt')
    expect(cleanFileName('   ')).toBe('file')
    expect(cleanFileName('x'.repeat(500))).toHaveLength(200)
  })

  it('reduces a media type to type/subtype, or to plain bytes', () => {
    expect(cleanMimeType('Text/HTML; charset=utf-8')).toBe('text/html')
    expect(cleanMimeType('image/svg+xml')).toBe('image/svg+xml')
    expect(cleanMimeType('nonsense')).toBe('application/octet-stream')
    expect(cleanMimeType(undefined)).toBe('application/octet-stream')
    expect(cleanMimeType('text/html\r\nX-Evil: 1')).toBe('application/octet-stream')
  })
})

describe('limits on what a project can hold', () => {
  it('refuses a file once the files of the project fill its quota, and frees room on removal', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chilladesk-quota-'))
    const limited = await createTestContext({ filesDir: dir, projectQuotaBytes: 25 })
    const fixture = await limited.createProject()
    const other = await limited.createProject()
    const taskOf = async (project: ProjectFixture) =>
      (await project.call(project.owner, 'POST', '/tasks', { title: 'T' })).json<Task>()
    const [first, second, elsewhere] = [
      await taskOf(fixture),
      await taskOf(fixture),
      await taskOf(other),
    ]
    const send = (project: ProjectFixture, task: Task, bytes: number) =>
      limited.app.inject({
        method: 'POST',
        url: `/api/projects/${project.project.id}/tasks/${task.id}/attachments`,
        headers: { ...project.owner.headers, 'content-type': 'text/plain', 'x-file-name': 'a.txt' },
        payload: Buffer.alloc(bytes, 1),
      })

    const fits = await send(fixture, first, 20)
    const tooMuch = await send(fixture, second, 6)
    // The quota is per project: another one has all of its own.
    const elsewhereFits = await send(other, elsewhere, 20)
    await fixture.call(
      fixture.owner,
      'DELETE',
      `/tasks/${first.id}/attachments/${fits.json<Attachment>().id}`,
    )
    const afterRemoval = await send(fixture, second, 6)

    expect(
      [fits, tooMuch, elsewhereFits, afterRemoval].map((response) => response.statusCode),
    ).toEqual([201, 409, 201, 201])
    expect(tooMuch.json()).toMatchObject({ error: { code: 'CONFLICT' } })
    // The refused file left nothing on the disk.
    expect(await readdir(dir)).toHaveLength(2)
    await limited.close()
    await rm(dir, { recursive: true, force: true })
  })

  it('limits how many files one client uploads per minute', async () => {
    const limited = await createTestContext({ uploadRateLimitMax: 2 })
    const fixture = await limited.createProject()
    const task = (await fixture.call(fixture.owner, 'POST', '/tasks', { title: 'T' })).json<Task>()
    const send = () =>
      limited.app.inject({
        method: 'POST',
        url: `/api/projects/${fixture.project.id}/tasks/${task.id}/attachments`,
        headers: { ...fixture.owner.headers, 'content-type': 'text/plain', 'x-file-name': 'a.txt' },
        payload: Buffer.from('x'),
      })

    const statuses = [
      (await send()).statusCode,
      (await send()).statusCode,
      (await send()).statusCode,
    ]
    await limited.close()

    expect(statuses).toEqual([201, 201, 429])
  })
})

describe('who the server reads a file from', () => {
  it('does not keep a byte from someone who is not signed in or may not attach files', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture)
    const before = (await readdir(filesDir)).length
    const big = Buffer.alloc(MAX_BYTES * 3, 1)
    const send = (headers: Record<string, string>) =>
      ctx.app.inject({
        method: 'POST',
        url: `/api/projects/${fixture.project.id}/tasks/${task.id}/attachments`,
        headers: {
          ...headers,
          'content-type': 'application/octet-stream',
          'x-file-name': 'big.bin',
        },
        payload: big,
      })

    const statuses = [
      (await send({})).statusCode,
      (await send(fixture.outsider.headers)).statusCode,
      (await send(fixture.viewer.headers)).statusCode,
      // A member is told about the size instead.
      (await send(fixture.member.headers)).statusCode,
    ]

    expect(statuses).toEqual([401, 404, 403, 413])
    expect(await readdir(filesDir)).toHaveLength(before)
  })

  it('takes a name apart from characters that would disguise it', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture)

    const attachment = (
      await upload(fixture, `/tasks/${task.id}/attachments`, { name: 'evil‮gnp.exe​' })
    ).json<Attachment>()
    const response = await download(fixture, attachment)

    expect(attachment.fileName).toBe('evilgnp.exe')
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(response.headers['cache-control']).toBe('private, no-cache')
  })

  it('escapes every character a header may not carry bare', async () => {
    const fixture = await ctx.createProject()
    const task = await addTask(fixture)
    const attachment = (
      await upload(fixture, `/tasks/${task.id}/attachments`, { name: "it's (a) *file*.txt" })
    ).json<Attachment>()

    const response = await download(fixture, attachment)

    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="it's (a) *file*.txt"; filename*=UTF-8''it%27s%20%28a%29%20%2Afile%2A.txt`,
    )
  })
})

describe('an upload to an address that makes no sense', () => {
  it('is answered as not found, not as a server error', async () => {
    const fixture = await ctx.createProject()
    const send = (url: string) =>
      ctx.app.inject({
        method: 'POST',
        url,
        headers: {
          ...fixture.member.headers,
          'content-type': 'text/plain',
          'x-file-name': 'a.txt',
        },
        payload: Buffer.from('x'),
      })

    const badProject = await send('/api/projects/undefined/tasks/also-not-an-id/attachments')
    const badTask = await send(`/api/projects/${fixture.project.id}/tasks/not-an-id/attachments`)

    expect([badProject.statusCode, badTask.statusCode]).toEqual([404, 400])
  })
})

describe('a sweep that looks wrong', () => {
  it('is refused when most of the store would go, as with the wrong database', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'chilladesk-wrong-db-'))
    const store = createFileStore(dir)
    for (let index = 0; index < 25; index += 1) await store.save(Buffer.from('x'))
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
    for (const name of await readdir(dir)) await utimes(join(dir, name), longAgo, longAgo)

    await expect(store.sweep(() => Promise.resolve(new Set()))).rejects.toThrow(
      /Refusing to remove 25/,
    )

    expect(await readdir(dir)).toHaveLength(25)
    await rm(dir, { recursive: true, force: true })
  })
})
