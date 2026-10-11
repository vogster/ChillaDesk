import { createHash, randomBytes } from 'node:crypto'

const TOKEN_BYTES = 32

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** The token goes to the client once; only its hash is persisted. */
export function generateToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString('base64url')
  return { token, tokenHash: hashToken(token) }
}
