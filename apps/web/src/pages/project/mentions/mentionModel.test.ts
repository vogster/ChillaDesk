import { describe, expect, it } from 'vitest'
import { ann, bob, makeMember } from '../../../test/render'
import { insertMention, mentionTokenAt, suggestMembers } from './mentionModel'

describe('mentionTokenAt', () => {
  it('finds the mention being typed at the caret', () => {
    expect(mentionTokenAt('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionTokenAt('Ask @bo', 7)).toEqual({ start: 4, query: 'bo' })
    expect(mentionTokenAt('(@a', 3)).toEqual({ start: 1, query: 'a' })
    expect(mentionTokenAt('line\n@bob later', 9)).toEqual({ start: 5, query: 'bob' })
  })

  it('is not fooled by an email, a finished mention or text before the caret', () => {
    expect(mentionTokenAt('mail bob@exa', 12)).toBeNull()
    expect(mentionTokenAt('@bob@example.com', 16)).toBeNull()
    expect(mentionTokenAt('@bob and more', 13)).toBeNull()
    expect(mentionTokenAt('no mention here', 5)).toBeNull()
  })
})

describe('suggestMembers', () => {
  const members = [makeMember(bob, 'member'), makeMember(ann, 'owner')]

  it('matches the name or the email, ignoring case, sorted by name', () => {
    expect(suggestMembers(members, '').map((member) => member.name)).toEqual(['Ann', 'Bob'])
    expect(suggestMembers(members, 'BO').map((member) => member.name)).toEqual(['Bob'])
    expect(suggestMembers(members, 'ann@ex').map((member) => member.name)).toEqual(['Ann'])
    expect(suggestMembers(members, 'zed')).toEqual([])
    expect(suggestMembers(members, '', 1)).toHaveLength(1)
  })
})

describe('insertMention', () => {
  it('replaces what was typed with the email and puts the caret after it', () => {
    const text = 'Ask @bo about it'
    const token = { start: 4, query: 'bo' }

    const result = insertMention(text, token, 7, 'bob@example.com')

    expect(result).toEqual({ text: 'Ask @bob@example.com about it', caret: 21 })
  })

  it('adds a space when there is none after the caret', () => {
    expect(insertMention('@', { start: 0, query: '' }, 1, 'ann@example.com')).toEqual({
      text: '@ann@example.com ',
      caret: 17,
    })
  })
})
