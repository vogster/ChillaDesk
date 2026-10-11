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
