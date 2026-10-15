import { z } from 'zod'

/** One version from the changelog of the project. */
export const releaseNotesSchema = z.object({
  version: z.string(),
  /** Markdown, as written in CHANGELOG.md. */
  notes: z.string(),
})
export type ReleaseNotes = z.infer<typeof releaseNotesSchema>

/** The running version, and what the project has released since. */
export const versionInfoSchema = z.object({
  current: z.string(),
  /** Null until a check succeeded, or when checking is turned off. */
  latest: z.string().nullable(),
  updateAvailable: z.boolean(),
  /** Whether the server looks for new versions at all (UPDATE_CHECK). */
  checking: z.boolean(),
  checkedAt: z.iso.datetime().nullable(),
  /** Newer versions first; with no update, the running version's own notes. */
  releases: z.array(releaseNotesSchema),
  /** Where the project and its upgrade instructions are. */
  homepage: z.string(),
})
export type VersionInfo = z.infer<typeof versionInfoSchema>
