import type { ProjectMember } from '@chillawiki/shared'

/** The unfinished mention the caret is in: `@` plus what was typed after it. */
export interface MentionToken {
  /** Position of the `@`. */
  start: number
  query: string
}

// The same characters may precede the `@` as in a finished mention; a second `@` ends the
// token, since by then an email is being typed out in full.
const TOKEN = /(?:^|[\s([{>"'*_~|])@([^\s@]{0,50})$/

export function mentionTokenAt(text: string, caret: number): MentionToken | null {
  const match = TOKEN.exec(text.slice(0, caret))
  if (!match) return null
  const query = match[1] ?? ''
  return { start: caret - query.length - 1, query }
}

/** Members whose name or email contains the query, by name. */
export function suggestMembers(
  members: ProjectMember[],
  query: string,
  limit = 6,
): ProjectMember[] {
  const wanted = query.toLowerCase()
  return members
    .filter(
      (member) =>
        member.name.toLowerCase().includes(wanted) || member.email.toLowerCase().includes(wanted),
    )
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
    .slice(0, limit)
}

/** Replaces the token with a finished mention and says where the caret goes. */
export function insertMention(
  text: string,
  token: MentionToken,
  caret: number,
  email: string,
): { text: string; caret: number } {
  const rest = text.slice(caret)
  const mention = `@${email}${rest.startsWith(' ') ? '' : ' '}`
  const head = `${text.slice(0, token.start)}${mention}`
  // Past the space that follows the mention, whether it was just added or already there.
  return { text: `${head}${rest}`, caret: head.length + (rest.startsWith(' ') ? 1 : 0) }
}
