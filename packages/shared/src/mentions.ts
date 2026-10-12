/**
 * A mention is `@` followed by the email of a project member, e.g. `@ann@example.com`.
 * Emails are used because they are the one unambiguous handle a user has: people, scripts
 * and AI assistants can all write one, and clients show it as `@Name`.
 *
 * The `@` must start a word, so an email address inside a sentence is not a mention.
 */

/** Regex source of the email part of a mention, for clients that build their own pattern. */
export const MENTION_EMAIL_SOURCE =
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}'

/**
 * Regex source of what may come right before the `@` of a mention (besides the start):
 * white space, an opening bracket or quote, or Markdown emphasis and table markup.
 */
export const MENTION_PREFIX_CLASS = '\\s(\\[{>"\'*_~|'

const MENTION_SOURCE = `(^|[${MENTION_PREFIX_CLASS}])@(${MENTION_EMAIL_SOURCE})`

/** A fresh global regex each time, since a shared one would carry `lastIndex` between calls. */
export const mentionPattern = () => new RegExp(MENTION_SOURCE, 'g')

export interface MentionMatch {
  /** Position of the `@` in the text. */
  index: number
  /** The mention as written, including the `@`. */
  text: string
  /** The email, lowercased. */
  email: string
}

/** Every mention in a run of plain text, in order. */
export function findMentions(text: string): MentionMatch[] {
  return [...text.matchAll(mentionPattern())].map((match) => {
    const [, prefix = '', email = ''] = match
    return {
      index: match.index + prefix.length,
      text: `@${email}`,
      email: email.toLowerCase(),
    }
  })
}

// Fenced blocks first, then inline spans: text inside code is quoted, not addressed to anyone.
// A fence only opens at the start of a line, and an unclosed one runs to the end of the text.
const CODE = /^ {0,3}(```|~~~)[\s\S]*?(?:^ {0,3}\1|(?![\s\S]))|`[^`\n]*`/gm

/** The distinct emails mentioned in a piece of Markdown, lowercased, ignoring code. */
export function mentionedEmails(markdown: string): string[] {
  const prose = markdown.replace(CODE, ' ')
  return [...new Set(findMentions(prose).map((mention) => mention.email))]
}
