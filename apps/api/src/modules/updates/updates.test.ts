import type { VersionInfo } from '@chilladesk/shared'
import { describe, expect, it } from 'vitest'
import { createTestContext } from '../../test/harness'
import { compareVersions, createUpdateChecker, parseChangelog } from './checker'

const CHANGELOG = `# Changelog

## Unreleased

- Something not out yet.

## 0.10.0

- Big one.

## 0.9.1

- A fix.

## 0.9.0

- The first.
`

describe('compareVersions', () => {
  it.each([
    ['0.10.0', '0.9.1', 1],
    ['0.9.1', '0.10.0', -1],
    ['1.0.0', '0.99.99', 1],
    ['0.3.0', '0.3.0', 0],
    ['garbage', '0.3.0', 0],
  ])('%s against %s', (left, right, sign) => {
    expect(Math.sign(compareVersions(left, right))).toBe(sign)
  })
})

describe('parseChangelog', () => {
  it('reads released versions, newest first, and leaves the rest out', () => {
    expect(parseChangelog(CHANGELOG)).toEqual([
      { version: '0.10.0', notes: '- Big one.' },
      { version: '0.9.1', notes: '- A fix.' },
      { version: '0.9.0', notes: '- The first.' },
    ])
    expect(parseChangelog('not a changelog at all')).toEqual([])
  })
})

describe('the update checker', () => {
  const checker = (current: string, text: string | Error = CHANGELOG, enabled = true) =>
    createUpdateChecker({
      current,
      enabled,
      fetch: async () => {
        if (text instanceof Error) throw text
        return text
      },
      now: () => new Date('2026-10-15T10:00:00Z'),
    })

  it('knows nothing before the first check', () => {
    expect(checker('0.9.0').info()).toMatchObject({
      current: '0.9.0',
      latest: null,
      updateAvailable: false,
      checking: true,
      checkedAt: null,
      releases: [],
    })
  })

  it('tells of newer versions with their notes', async () => {
    const updates = checker('0.9.0')
    await updates.check()

    expect(updates.info()).toMatchObject({
      latest: '0.10.0',
      updateAvailable: true,
      checkedAt: '2026-10-15T10:00:00.000Z',
      releases: [{ version: '0.10.0' }, { version: '0.9.1' }],
    })
  })

  it('shows the running version’s own notes when it is the newest', async () => {
    const updates = checker('0.10.0')
    await updates.check()

    expect(updates.info()).toMatchObject({
      updateAvailable: false,
      releases: [{ version: '0.10.0', notes: '- Big one.' }],
    })
  })

  it('keeps what it knew when a check fails or finds no versions', async () => {
    let answer: string | Error = CHANGELOG
    const updates = createUpdateChecker({
      current: '0.9.0',
      enabled: true,
      fetch: async () => {
        if (answer instanceof Error) throw answer
        return answer
      },
    })
    await updates.check()
    answer = new Error('offline')
    await expect(updates.check()).rejects.toThrow('offline')
    answer = '<html>Rate limited</html>'
    await expect(updates.check()).rejects.toThrow(/No versions/)

    expect(updates.info().latest).toBe('0.10.0')
  })

  it('never looks anything up when turned off', async () => {
    let asked = 0
    const updates = createUpdateChecker({
      current: '0.9.0',
      enabled: false,
      fetch: async () => {
        asked += 1
        return CHANGELOG
      },
    })
    await updates.check()
    updates.start()()

    expect(asked).toBe(0)
    expect(updates.info()).toMatchObject({ checking: false, latest: null })
  })
})

describe('GET /api/version', () => {
  it('answers signed-in people only', async () => {
    const updates = createUpdateChecker({
      current: '0.9.0',
      enabled: true,
      fetch: async () => CHANGELOG,
    })
    await updates.check()
    const ctx = await createTestContext({ updateChecker: updates })
    const user = await ctx.signUp()

    const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/version' })
    const signedIn = await ctx.request(user, 'GET', '/api/version')
    await ctx.close()

    expect(anonymous.statusCode).toBe(401)
    expect(signedIn.json<VersionInfo>()).toMatchObject({ latest: '0.10.0', updateAvailable: true })
  })
})
