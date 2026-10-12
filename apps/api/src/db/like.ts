/**
 * Builds a "contains" pattern for LIKE / ILIKE in which the search text is taken literally:
 * `%`, `_` and `\` are wildcards there, and a search for "100%" must match that exact text.
 */
export function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, '\\$&')}%`
}
