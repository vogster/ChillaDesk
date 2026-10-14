import { z } from 'zod'

/** What a task import is read as: our own CSV (or a Jira export), or a Trello board in JSON. */
export const importFormatSchema = z.enum(['csv', 'trello'])
export type ImportFormat = z.infer<typeof importFormatSchema>

/** At most this many tasks come in with one import. */
export const IMPORT_MAX_TASKS = 1000
/** An import file may be at most this large. */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024

export const importQuerySchema = z.object({ format: importFormatSchema.default('csv') })

export const importResultSchema = z.object({
  /** How many tasks were created. */
  created: z.number().int().min(0),
  /** Rows (1-based, the header being row 1) or cards that were left out, and why. */
  skipped: z.array(z.object({ row: z.number().int().min(1), reason: z.string() })),
  /** Things that came in other than the file said: an unknown assignee, a status guessed. */
  warnings: z.array(z.string()),
})
export type ImportResult = z.infer<typeof importResultSchema>
