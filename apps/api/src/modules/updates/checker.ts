import type { ReleaseNotes, VersionInfo } from '@chilladesk/shared'

/** Where the changelog of released versions is read from. */
export const CHANGELOG_URL =
  'https://raw.githubusercontent.com/vogster/ChillaDesk/main/CHANGELOG.md'
export const HOMEPAGE = 'https://github.com/vogster/ChillaDesk'

const CHECK_EVERY_MS = 12 * 60 * 60 * 1000
const TIMEOUT_MS = 10_000
/** A changelog is a few kilobytes; anything far larger is not one. */
const MAX_BYTES = 512 * 1024

/** `1.2.3` as numbers; null for anything else (`Unreleased`, `1.2`, `1.2.3-beta`). */
function parseVersion(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** Positive when `left` is newer than `right`. */
export function compareVersions(left: string, right: string): number {
  const [a, b] = [parseVersion(left), parseVersion(right)]
  if (!a || !b) return 0
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * The released versions of a changelog, newest first: every `## 1.2.3` section with the
 * text under it. Sections that are not a version (`## Unreleased`) are left out.
 */
export function parseChangelog(markdown: string): ReleaseNotes[] {
  const releases: ReleaseNotes[] = []
  let current: { version: string; lines: string[] } | null = null
  const finish = () => {
    if (current) releases.push({ version: current.version, notes: current.lines.join('\n').trim() })
  }
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## +(.+?)\s*$/.exec(line)
    if (heading) {
      finish()
      const version = (heading[1] ?? '').replace(/^v/, '')
      current = parseVersion(version) ? { version, lines: [] } : null
      continue
    }
    current?.lines.push(line)
  }
  finish()
  return releases.sort((left, right) => compareVersions(right.version, left.version))
}

export type FetchText = (url: string) => Promise<string>

/** Reads a URL as text, refusing slow answers, errors and anything too large. */
const fetchText: FetchText = async (url) => {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': 'ChillaDesk update check' },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const length = Number(response.headers.get('content-length') ?? 0)
  if (length > MAX_BYTES) throw new Error('The changelog is too large')
  const text = await response.text()
  if (text.length > MAX_BYTES) throw new Error('The changelog is too large')
  return text
}

export interface UpdateChecker {
  /** What is known now; never waits for the network. */
  info(): VersionInfo
  /** Looks at the changelog once; failures keep what was known before. */
  check(): Promise<void>
  /** Checks now and then every 12 hours; the returned function stops it. */
  start(onError?: (error: unknown) => void): () => void
}

export interface UpdateCheckerOptions {
  current: string
  /** False when the server must not look for new versions (UPDATE_CHECK=false). */
  enabled: boolean
  url?: string
  fetch?: FetchText
  now?: () => Date
}

/**
 * Finds out whether a newer ChillaDesk was released, from the changelog in its repository.
 * Nothing is sent but the request for that public file.
 */
export function createUpdateChecker({
  current,
  enabled,
  url = CHANGELOG_URL,
  fetch = fetchText,
  now = () => new Date(),
}: UpdateCheckerOptions): UpdateChecker {
  let releases: ReleaseNotes[] = []
  let checkedAt: Date | null = null

  return {
    info() {
      const latest = releases[0]?.version ?? null
      const updateAvailable = latest !== null && compareVersions(latest, current) > 0
      const newer = releases.filter((release) => compareVersions(release.version, current) > 0)
      const own = releases.filter((release) => release.version === current)
      return {
        current,
        latest,
        updateAvailable,
        checking: enabled,
        checkedAt: checkedAt?.toISOString() ?? null,
        releases: updateAvailable ? newer : own,
        homepage: HOMEPAGE,
      }
    },

    async check() {
      if (!enabled) return
      const parsed = parseChangelog(await fetch(url))
      // A changelog without a single version is not trusted over what was known.
      if (parsed.length === 0) throw new Error('No versions found in the changelog')
      releases = parsed
      checkedAt = now()
    },

    start(onError) {
      if (!enabled) return () => undefined
      const run = () => void this.check().catch((error: unknown) => onError?.(error))
      run()
      const timer = setInterval(run, CHECK_EVERY_MS)
      timer.unref()
      return () => clearInterval(timer)
    },
  }
}
