/**
 * Where to send the user after signing in: the page they originally asked for, taken from
 * router state. Only same-site paths are accepted; `//host` and `/\host` would leave the site.
 */
export function redirectTarget(state: unknown): string {
  const from = (state as { from?: unknown } | null)?.from
  const isLocalPath =
    typeof from === 'string' &&
    from.startsWith('/') &&
    !from.startsWith('//') &&
    !from.includes('\\')
  return isLocalPath ? from : '/'
}

/**
 * The token of the invite link someone was on before being sent to log in or sign up, so
 * signing up can bring it along. Null when they came from anywhere else.
 */
export function inviteTokenFrom(state: unknown): string | null {
  const from = redirectTarget(state)
  if (!from.startsWith('/invite')) return null
  const hash = from.includes('#') ? from.slice(from.indexOf('#') + 1) : ''
  return new URLSearchParams(hash).get('token')
}
