import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password hashing', () => {
  it('verifies the original password', async () => {
    const hash = await hashPassword('correct horse battery')

    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/)
    await expect(verifyPassword('correct horse battery', hash)).resolves.toBe(true)
  })

  it('rejects a different password', async () => {
    const hash = await hashPassword('correct horse battery')

    await expect(verifyPassword('wrong horse', hash)).resolves.toBe(false)
  })

  it('salts each hash', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')])

    expect(first).not.toBe(second)
  })

  it.each([
    ['an empty string', ''],
    ['an unknown scheme', 'bcrypt$10$abc$def$ghi$jkl'],
    ['corrupt cost parameters', 'scrypt$3$8$1$c2FsdA==$aGFzaA=='],
    ['a truncated hash', 'scrypt$32768$8$1$c2FsdA==$aGFzaA=='],
  ])('rejects %s without throwing', async (_label, stored) => {
    await expect(verifyPassword('anything', stored)).resolves.toBe(false)
  })
})
