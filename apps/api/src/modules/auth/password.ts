import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const SALT_BYTES = 16
const KEY_BYTES = 64
// scrypt cost: N=2^15, r=8, p=1 needs ~32 MB per hash.
const COST = { N: 32768, r: 8, p: 1 } as const
const MAX_MEMORY = 64 * 1024 * 1024

function deriveKey(
  password: string,
  salt: Buffer,
  cost: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { ...cost, maxmem: MAX_MEMORY }, (error, key) => {
      if (error) reject(error)
      else resolve(key)
    })
  })
}

/** Returns `scrypt$N$r$p$salt$hash`, so the cost can be raised later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const key = await deriveKey(password, salt, COST)
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join(
    '$',
  )
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false

  const expected = Buffer.from(hash, 'base64')
  const cost = { N: Number(n), r: Number(r), p: Number(p) }
  try {
    const actual = await deriveKey(password, Buffer.from(salt, 'base64'), cost)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    // Corrupt cost parameters make scrypt throw; treat that as a failed login.
    return false
  }
}
