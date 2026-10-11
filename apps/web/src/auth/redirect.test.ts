import { describe, expect, it } from 'vitest'
import { redirectTarget } from './redirect'

describe('redirectTarget', () => {
  it('returns a local path with its query and hash', () => {
    expect(redirectTarget({ from: '/projects/1?tab=wiki#top' })).toBe('/projects/1?tab=wiki#top')
  })

  it.each([
    ['no state', null],
    ['a missing path', {}],
    ['a non-string path', { from: 42 }],
    ['an absolute URL', { from: 'https://evil.example' }],
    ['a protocol-relative URL', { from: '//evil.example' }],
    ['a backslash trick', { from: '/\\evil.example' }],
  ])('falls back to the home page for %s', (_label, state) => {
    expect(redirectTarget(state)).toBe('/')
  })
})
