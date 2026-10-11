import { describe, expect, it } from 'vitest'
import {
  createWikiPageRequestSchema,
  updateWikiPageRequestSchema,
  wikiListQuerySchema,
} from './wiki'

describe('createWikiPageRequestSchema', () => {
  it('fills the defaults for a page created from just a title', () => {
    expect(createWikiPageRequestSchema.parse({ title: '  Getting started ' })).toEqual({
      title: 'Getting started',
      content: '',
      parentId: null,
    })
  })

  it('allows punctuation that does not interfere with links', () => {
    const title = 'snake_case & co. (v2), 100%: «да»!'

    expect(createWikiPageRequestSchema.parse({ title }).title).toBe(title)
  })

  it.each([
    ['an empty title', { title: '  ' }],
    ['an overlong title', { title: 'x'.repeat(151) }],
    ['square brackets, which would break [[links]]', { title: 'Setup [draft]' }],
    ['a line break in the title', { title: 'Two\nlines' }],
    ['an asterisk, which Markdown reads as emphasis', { title: 'Very *important*' }],
    ['a backtick', { title: 'The `main` branch' }],
    ['a backslash', { title: 'C:\\temp' }],
    ['content over the size limit', { title: 'Big', content: 'x'.repeat(200_001) }],
    ['a malformed parent id', { title: 'Child', parentId: 'root' }],
  ])('rejects %s', (_label, input) => {
    expect(createWikiPageRequestSchema.safeParse(input).success).toBe(false)
  })
})

describe('updateWikiPageRequestSchema', () => {
  it('requires the version the edit started from', () => {
    expect(updateWikiPageRequestSchema.safeParse({ content: 'New' }).success).toBe(false)
    expect(updateWikiPageRequestSchema.safeParse({ content: 'New', baseVersion: 0 }).success).toBe(
      false,
    )
  })

  it('requires at least one change besides the version', () => {
    expect(updateWikiPageRequestSchema.safeParse({ baseVersion: 3 }).success).toBe(false)
  })

  it('accepts a move to the top level on its own', () => {
    expect(updateWikiPageRequestSchema.parse({ parentId: null, baseVersion: 3 })).toEqual({
      parentId: null,
      baseVersion: 3,
    })
  })
})

describe('wikiListQuerySchema', () => {
  it('treats a missing search as "all pages" and rejects a blank one', () => {
    expect(wikiListQuerySchema.parse({})).toEqual({})
    expect(wikiListQuerySchema.safeParse({ q: '   ' }).success).toBe(false)
  })
})
