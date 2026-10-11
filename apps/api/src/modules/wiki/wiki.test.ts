import {
  wikiPageSchema,
  wikiPageSummarySchema,
  type WikiPage,
  type WikiPageSummary,
  type WikiVersionSummary,
} from '@chillawiki/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  type ProjectFixture,
  type TestContext,
  type TestUser,
} from '../../test/harness'

let ctx: TestContext

beforeAll(async () => {
  ctx = await createTestContext()
})

afterAll(async () => {
  await ctx.close()
})

async function addPage(
  fixture: ProjectFixture,
  payload: Record<string, unknown>,
  user: TestUser = fixture.member,
): Promise<WikiPage> {
  const response = await fixture.call(user, 'POST', '/wiki', payload)
  expect(response.statusCode, response.body).toBe(201)
  return response.json<WikiPage>()
}

async function listTitles(fixture: ProjectFixture, query = ''): Promise<string[]> {
  const response = await fixture.call(fixture.viewer, 'GET', `/wiki${query}`)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<WikiPageSummary[]>().map((page) => page.title)
}

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000'

describe('creating pages', () => {
  it('starts a page at version 1 and remembers who wrote it', async () => {
    const fixture = await ctx.createProject()

    const page = await addPage(fixture, { title: ' Getting started ', content: '# Hello' })

    expect(wikiPageSchema.parse(page)).toMatchObject({
      projectId: fixture.project.id,
      parentId: null,
      title: 'Getting started',
      content: '# Hello',
      version: 1,
      updatedBy: { id: fixture.member.id, name: 'Max Member' },
    })
  })

  it('nests a page under a parent of the same project', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    const parent = await addPage(fixture, { title: 'Guides' })
    const foreign = await addPage(other, { title: 'Elsewhere' })

    const child = await addPage(fixture, { title: 'Install', parentId: parent.id })
    const badParents = await Promise.all(
      [foreign.id, UNKNOWN_ID].map((parentId) =>
        fixture.call(fixture.member, 'POST', '/wiki', { title: `Orphan ${parentId}`, parentId }),
      ),
    )

    expect(child.parentId).toBe(parent.id)
    expect(badParents.map((response) => response.statusCode)).toEqual([400, 400])
  })

  it('keeps titles unique within a project, ignoring case, but not across projects', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    await addPage(fixture, { title: 'Roadmap' })

    const duplicate = await fixture.call(fixture.member, 'POST', '/wiki', { title: 'ROADMAP' })
    const elsewhere = await other.call(other.member, 'POST', '/wiki', { title: 'Roadmap' })

    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json<{ error: { message: string } }>().error.message).toContain('ROADMAP')
    expect(elsewhere.statusCode).toBe(201)
  })

  it('is forbidden for viewers and hidden from outsiders', async () => {
    const fixture = await ctx.createProject()

    const viewer = await fixture.call(fixture.viewer, 'POST', '/wiki', { title: 'Nope' })
    const outsider = await fixture.call(fixture.outsider, 'POST', '/wiki', { title: 'Nope' })

    expect([viewer.statusCode, outsider.statusCode]).toEqual([403, 404])
  })
})

describe('listing and searching pages', () => {
  async function seeded() {
    const fixture = await ctx.createProject()
    const guides = await addPage(fixture, { title: 'guides', content: 'How-to articles' })
    await addPage(fixture, { title: 'Architecture', content: 'Uses PostgreSQL, 100% typed' })
    await addPage(fixture, { title: 'Deploy', content: 'docker compose up', parentId: guides.id })
    return { fixture, guides }
  }

  it('returns every page without content, sorted by title ignoring case', async () => {
    const { fixture, guides } = await seeded()

    const response = await fixture.call(fixture.viewer, 'GET', '/wiki')

    const pages = response.json<WikiPageSummary[]>()
    expect(pages.map((page) => page.title)).toEqual(['Architecture', 'Deploy', 'guides'])
    expect(pages.map((page) => wikiPageSummarySchema.parse(page).parentId)).toEqual([
      null,
      guides.id,
      null,
    ])
    expect(response.body).not.toContain('docker compose')
  })

  it('searches titles and content without case, treating % literally', async () => {
    const { fixture } = await seeded()

    expect(await listTitles(fixture, '?q=DEPLOY')).toEqual(['Deploy'])
    expect(await listTitles(fixture, '?q=postgresql')).toEqual(['Architecture'])
    expect(await listTitles(fixture, `?q=${encodeURIComponent('100%')}`)).toEqual(['Architecture'])
    expect(await listTitles(fixture, `?q=${encodeURIComponent('%')}`)).toEqual(['Architecture'])
    expect(await listTitles(fixture, '?q=nothing-like-this')).toEqual([])
  })

  it('is hidden from outsiders', async () => {
    const { fixture } = await seeded()

    expect((await fixture.call(fixture.outsider, 'GET', '/wiki')).statusCode).toBe(404)
  })
})

describe('reading a page', () => {
  it('returns the full page to any member', async () => {
    const fixture = await ctx.createProject()
    const page = await addPage(fixture, { title: 'Readable', content: 'Body' })

    const response = await fixture.call(fixture.viewer, 'GET', `/wiki/${page.id}`)

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(page)
  })

  it('does not find unknown pages or pages of another project', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    const foreign = await addPage(other, { title: 'Foreign' })

    const unknown = await fixture.call(fixture.owner, 'GET', `/wiki/${UNKNOWN_ID}`)
    const crossProject = await fixture.call(fixture.owner, 'GET', `/wiki/${foreign.id}`)

    expect([unknown.statusCode, crossProject.statusCode]).toEqual([404, 404])
  })
})

describe('editing a page', () => {
  it('saves a new version and records who made it', async () => {
    const fixture = await ctx.createProject()
    const page = await addPage(fixture, { title: 'Notes', content: 'First' })

    const response = await fixture.call(fixture.owner, 'PATCH', `/wiki/${page.id}`, {
      content: 'Second',
      baseVersion: 1,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      title: 'Notes',
      content: 'Second',
      version: 2,
      updatedBy: { id: fixture.owner.id },
    })
  })

  it('refuses to overwrite a change the editor has not seen', async () => {
    const fixture = await ctx.createProject()
    const page = await addPage(fixture, { title: 'Shared', content: 'Original' })
    const save = (user: TestUser, content: string) =>
      fixture.call(user, 'PATCH', `/wiki/${page.id}`, { content, baseVersion: 1 })

    const first = await save(fixture.owner, 'Owner edit')
    const second = await save(fixture.member, 'Member edit')

    expect(first.statusCode).toBe(200)
    expect(second.statusCode).toBe(409)
    const current = await fixture.call(fixture.viewer, 'GET', `/wiki/${page.id}`)
    expect(current.json()).toMatchObject({ content: 'Owner edit', version: 2 })
  })

  it('does not create a version when nothing in the text changed', async () => {
    const fixture = await ctx.createProject()
    const parent = await addPage(fixture, { title: 'Parent' })
    const page = await addPage(fixture, { title: 'Movable', content: 'Same' })

    const moved = await fixture.call(fixture.member, 'PATCH', `/wiki/${page.id}`, {
      parentId: parent.id,
      baseVersion: 1,
    })
    const resaved = await fixture.call(fixture.member, 'PATCH', `/wiki/${page.id}`, {
      content: 'Same',
      baseVersion: 1,
    })

    expect(moved.json()).toMatchObject({ parentId: parent.id, version: 1 })
    expect(resaved.json()).toMatchObject({ version: 1 })
    const versions = await fixture.call(fixture.member, 'GET', `/wiki/${page.id}/versions`)
    expect(versions.json()).toHaveLength(1)
  })

  it('rejects a rename to a title that is taken, but allows changing its own case', async () => {
    const fixture = await ctx.createProject()
    await addPage(fixture, { title: 'Taken' })
    const page = await addPage(fixture, { title: 'mine' })
    const rename = (title: string, baseVersion: number) =>
      fixture.call(fixture.member, 'PATCH', `/wiki/${page.id}`, { title, baseVersion })

    const taken = await rename('taken', 1)
    const ownCase = await rename('Mine', 1)

    expect(taken.statusCode).toBe(409)
    expect(ownCase.statusCode).toBe(200)
    expect(ownCase.json()).toMatchObject({ title: 'Mine', version: 2 })
  })

  it('cannot move a page under itself, its descendants, or another project', async () => {
    const fixture = await ctx.createProject()
    const other = await ctx.createProject()
    const foreign = await addPage(other, { title: 'Foreign' })
    const top = await addPage(fixture, { title: 'Top' })
    const middle = await addPage(fixture, { title: 'Middle', parentId: top.id })
    const leaf = await addPage(fixture, { title: 'Leaf', parentId: middle.id })
    const moveTop = (parentId: string) =>
      fixture.call(fixture.member, 'PATCH', `/wiki/${top.id}`, { parentId, baseVersion: 1 })

    const responses = await Promise.all([
      moveTop(top.id),
      moveTop(middle.id),
      moveTop(leaf.id),
      moveTop(foreign.id),
    ])
    const allowed = await fixture.call(fixture.member, 'PATCH', `/wiki/${leaf.id}`, {
      parentId: top.id,
      baseVersion: 1,
    })

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400, 400])
    expect(allowed.statusCode).toBe(200)
  })

  it('is forbidden for viewers and reports unknown pages', async () => {
    const fixture = await ctx.createProject()
    const page = await addPage(fixture, { title: 'Guarded' })
    const patch = { content: 'X', baseVersion: 1 }

    const viewer = await fixture.call(fixture.viewer, 'PATCH', `/wiki/${page.id}`, patch)
    const unknown = await fixture.call(fixture.member, 'PATCH', `/wiki/${UNKNOWN_ID}`, patch)

    expect([viewer.statusCode, unknown.statusCode]).toEqual([403, 404])
  })
})

describe('page history', () => {
  async function edited() {
    const fixture = await ctx.createProject()
    const page = await addPage(fixture, { title: 'Draft', content: 'v1 text' })
    await fixture.call(fixture.owner, 'PATCH', `/wiki/${page.id}`, {
      title: 'Final',
      content: 'v2 text',
      baseVersion: 1,
    })
    return { fixture, page }
  }

  it('lists versions newest first with their authors', async () => {
    const { fixture, page } = await edited()

    const response = await fixture.call(fixture.viewer, 'GET', `/wiki/${page.id}/versions`)

    expect(response.statusCode).toBe(200)
    expect(
      response.json<WikiVersionSummary[]>().map(({ version, title, author }) => ({
        version,
        title,
        author: author?.id,
      })),
    ).toEqual([
      { version: 2, title: 'Final', author: fixture.owner.id },
      { version: 1, title: 'Draft', author: fixture.member.id },
    ])
    expect(response.body).not.toContain('v1 text')
  })

  it('returns the text of an old version', async () => {
    const { fixture, page } = await edited()

    const old = await fixture.call(fixture.viewer, 'GET', `/wiki/${page.id}/versions/1`)
    const missing = await fixture.call(fixture.viewer, 'GET', `/wiki/${page.id}/versions/9`)

    expect(old.json()).toMatchObject({ version: 1, title: 'Draft', content: 'v1 text' })
    expect(missing.statusCode).toBe(404)
  })

  it('is hidden from outsiders', async () => {
    const { fixture, page } = await edited()

    const response = await fixture.call(fixture.outsider, 'GET', `/wiki/${page.id}/versions`)

    expect(response.statusCode).toBe(404)
  })
})

describe('deleting a page', () => {
  it('moves its children up one level and removes its history', async () => {
    const fixture = await ctx.createProject()
    const top = await addPage(fixture, { title: 'Top' })
    const middle = await addPage(fixture, { title: 'Middle', parentId: top.id })
    const leaf = await addPage(fixture, { title: 'Leaf', parentId: middle.id })

    const response = await fixture.call(fixture.member, 'DELETE', `/wiki/${middle.id}`)

    expect(response.statusCode).toBe(204)
    const pages = (await fixture.call(fixture.viewer, 'GET', '/wiki')).json<WikiPageSummary[]>()
    expect(pages.map(({ title, parentId }) => ({ title, parentId }))).toEqual([
      { title: 'Leaf', parentId: top.id },
      { title: 'Top', parentId: null },
    ])
    expect((await fixture.call(fixture.viewer, 'GET', `/wiki/${leaf.id}`)).statusCode).toBe(200)
    expect(
      (await fixture.call(fixture.viewer, 'GET', `/wiki/${middle.id}/versions`)).statusCode,
    ).toBe(404)
  })

  it('is forbidden for viewers and reports unknown pages', async () => {
    const fixture = await ctx.createProject()
    const page = await addPage(fixture, { title: 'Keep' })

    const viewer = await fixture.call(fixture.viewer, 'DELETE', `/wiki/${page.id}`)
    const unknown = await fixture.call(fixture.member, 'DELETE', `/wiki/${UNKNOWN_ID}`)

    expect([viewer.statusCode, unknown.statusCode]).toEqual([403, 404])
  })
})

describe('looking a task up by its number', () => {
  it('finds the task behind a key such as KEY-2', async () => {
    const fixture = await ctx.createProject()
    await fixture.call(fixture.member, 'POST', '/tasks', { title: 'One' })
    await fixture.call(fixture.member, 'POST', '/tasks', { title: 'Two' })

    const found = await fixture.call(fixture.viewer, 'GET', '/tasks/by-number/2')
    const missing = await fixture.call(fixture.viewer, 'GET', '/tasks/by-number/99')
    const malformed = await fixture.call(fixture.viewer, 'GET', '/tasks/by-number/abc')
    const outsider = await fixture.call(fixture.outsider, 'GET', '/tasks/by-number/2')

    expect(found.json()).toMatchObject({ number: 2, title: 'Two' })
    expect([missing.statusCode, malformed.statusCode, outsider.statusCode]).toEqual([404, 400, 404])
  })
})
