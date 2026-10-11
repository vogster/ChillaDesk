import type { WikiPageSummary } from '@chillawiki/shared'
import { describe, expect, it } from 'vitest'
import { buildTree, descendantIds, splitLinks, type LinkContext, type TreeNode } from './wikiModel'

const TIMESTAMP = '2026-01-01T00:00:00.000Z'

const page = (id: string, title: string, parentId: string | null = null): WikiPageSummary => ({
  id,
  projectId: 'p',
  parentId,
  title,
  updatedAt: TIMESTAMP,
})

// Guides ─┬─ Deploy ── Docker
//         └─ install
// About
const pages = [
  page('docker', 'Docker', 'deploy'),
  page('guides', 'Guides'),
  page('install', 'install', 'guides'),
  page('about', 'About'),
  page('deploy', 'Deploy', 'guides'),
]

const outline = (nodes: TreeNode[]): unknown[] =>
  nodes.map((node) =>
    node.children.length ? [node.page.title, outline(node.children)] : node.page.title,
  )

describe('buildTree', () => {
  it('nests pages under their parents and sorts siblings by title ignoring case', () => {
    expect(outline(buildTree(pages))).toEqual([
      'About',
      ['Guides', [['Deploy', ['Docker']], 'install']],
    ])
  })

  it('shows a page whose parent is missing at the top level instead of losing it', () => {
    expect(outline(buildTree([page('lost', 'Lost', 'gone'), page('a', 'A')]))).toEqual([
      'A',
      'Lost',
    ])
  })

  it('still shows every page once when parents form a loop', () => {
    const looped = [page('a', 'A', 'b'), page('b', 'B', 'a'), page('c', 'C', 'b'), page('z', 'Z')]

    expect(outline(buildTree(looped))).toEqual(['Z', ['A', [['B', ['C']]]]])
  })

  it('returns an empty tree for no pages', () => {
    expect(buildTree([])).toEqual([])
  })
})

describe('descendantIds', () => {
  it('collects every page below the given one', () => {
    expect([...descendantIds(pages, 'guides')].sort()).toEqual(['deploy', 'docker', 'install'])
    expect([...descendantIds(pages, 'docker')]).toEqual([])
  })
})

describe('splitLinks', () => {
  const context: LinkContext = {
    projectId: 'p1',
    projectKey: 'CHL',
    pages: [...pages, page('retro', 'CHL-12 retro')],
    linkMissingPages: true,
  }
  const run = (text: string, overrides: Partial<LinkContext> = {}) =>
    splitLinks(text, { ...context, ...overrides })
  const text = (value: string) => ({ kind: 'text', value })
  const link = (label: string, href: string, missing = false) => ({
    kind: 'link',
    label,
    href,
    missing,
  })

  it('links [[Title]] to that page, ignoring case and outer spaces', () => {
    expect(run('See [[Guides]] and [[ deploy ]].')).toEqual([
      text('See '),
      link('Guides', '/projects/p1/wiki/guides'),
      text(' and '),
      link('Deploy', '/projects/p1/wiki/deploy'),
      text('.'),
    ])
  })

  it('links a title without a page to the form that creates it', () => {
    expect(run('[[Plan (draft) & more]]')).toEqual([
      link('Plan (draft) & more', '/projects/p1/wiki/new?title=Plan%20(draft)%20%26%20more', true),
    ])
  })

  it('leaves a title without a page as text when missing pages are not linked', () => {
    expect(run('Read [[Roadmap]]', { linkMissingPages: false })).toEqual([text('Read [[Roadmap]]')])
  })

  it('leaves titles as text until the page list has loaded, but still links task keys', () => {
    expect(run('[[Guides]] CHL-3', { pages: undefined })).toEqual([
      text('[[Guides]] '),
      link('CHL-3', '/projects/p1/tasks/3'),
    ])
  })

  it('links task keys of this project', () => {
    expect(run('Fixed in CHL-12, see (CHL-7).')).toEqual([
      text('Fixed in '),
      link('CHL-12', '/projects/p1/tasks/12'),
      text(', see ('),
      link('CHL-7', '/projects/p1/tasks/7'),
      text(').'),
    ])
  })

  it('keeps a task key inside a page title as part of that one link', () => {
    expect(run('[[CHL-12 retro]] and [[CHL-7 plan]]')).toEqual([
      link('CHL-12 retro', '/projects/p1/wiki/retro'),
      text(' and '),
      link('CHL-7 plan', '/projects/p1/wiki/new?title=CHL-7%20plan', true),
    ])
  })

  it('ignores other keys, partial matches, number zero and numbers too large to exist', () => {
    const input = 'ABC-1 XCHL-2 CHL-3x CHL-0 CHL-1234567890 pre-CHL-4'
    expect(run(input)).toEqual([text(input)])
  })

  it('ignores empty and unclosed brackets', () => {
    const input = '[[ ]] [[]] [[open [single] ]]'
    expect(run(input)).toEqual([text(input)])
  })

  it('returns plain text as a single part and nothing for an empty string', () => {
    expect(run('Plain text.')).toEqual([text('Plain text.')])
    expect(run('')).toEqual([])
  })

  it('stays fast on a page full of brackets', () => {
    const hostile = ['['.repeat(200_000), '[[a'.repeat(60_000), '[]('.repeat(60_000)]

    const started = performance.now()
    for (const input of hostile) splitLinks(input, context)

    expect(performance.now() - started).toBeLessThan(1000)
  })
})
