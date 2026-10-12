import { describe, expect, it } from 'vitest'
import { findMentions, mentionedEmails } from './mentions'

describe('findMentions', () => {
  it('finds a mention with its position and lowercased email', () => {
    expect(findMentions('Ask @Ann.Lee@Example.com today')).toEqual([
      { index: 4, text: '@Ann.Lee@Example.com', email: 'ann.lee@example.com' },
    ])
  })

  it('finds mentions at the start, after brackets and quotes, and several in a row', () => {
    const text = '@a@x.io (@b@x.io) "@c@x.io" and\n@d@sub.x.co.uk'

    expect(findMentions(text).map((mention) => mention.email)).toEqual([
      'a@x.io',
      'b@x.io',
      'c@x.io',
      'd@sub.x.co.uk',
    ])
  })

  it('leaves the punctuation after a mention out of it', () => {
    const emails = (text: string) => findMentions(text).map((mention) => mention.text)

    expect(emails('Thanks @bob@example.com.')).toEqual(['@bob@example.com'])
    expect(emails('cc @bob@example.com, @eve@example.com!')).toEqual([
      '@bob@example.com',
      '@eve@example.com',
    ])
  })

  it.each([
    ['a plain email address', 'Write to ann@example.com please'],
    ['an email glued to a word', 'mail:x@ann@example.com'],
    ['a bare at-sign or a name without a domain', 'Hi @ann and @ and @ann@localhost'],
    ['a social handle', 'follow @chillawiki'],
  ])('does not treat %s as a mention', (_label, text) => {
    expect(findMentions(text)).toEqual([])
  })
})

describe('mentionedEmails', () => {
  it('lists each mentioned email once', () => {
    expect(mentionedEmails('@ann@example.com and @ANN@example.com, also @bob@example.com')).toEqual(
      ['ann@example.com', 'bob@example.com'],
    )
  })

  it('ignores mentions inside code', () => {
    const markdown = [
      'Real: @ann@example.com',
      'Inline `@bob@example.com` is quoted.',
      '```',
      '@eve@example.com',
      '```',
      '~~~',
      '@dan@example.com',
      '~~~',
    ].join('\n')

    expect(mentionedEmails(markdown)).toEqual(['ann@example.com'])
  })

  it('sees a mention inside emphasis and table cells, as readers do', () => {
    const markdown =
      '**@ann@example.com** _@bob@example.com_ ~~@cy@example.com~~ |@dee@example.com|'

    expect(mentionedEmails(markdown)).toEqual([
      'ann@example.com',
      'bob@example.com',
      'cy@example.com',
      'dee@example.com',
    ])
  })

  it('does not take backticks in the middle of a line for a code block', () => {
    const markdown = 'Use ``` to open a block. Thanks @ann@example.com\n\n    ```\n@bob@example.com'

    expect(mentionedEmails(markdown)).toContain('ann@example.com')
  })

  it('ignores everything after a code fence that is never closed', () => {
    expect(mentionedEmails('@ann@example.com\n```\n@bob@example.com')).toEqual(['ann@example.com'])
  })

  it('returns nothing for text without mentions and stays fast on hostile input', () => {
    expect(mentionedEmails('No one here.')).toEqual([])

    const started = Date.now()
    mentionedEmails('@'.repeat(100_000) + ' ' + '@a'.repeat(50_000) + ' ' + '`'.repeat(100_000))
    expect(Date.now() - started).toBeLessThan(1000)
  })
})
