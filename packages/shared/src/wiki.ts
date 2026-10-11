import { z } from 'zod'
import { textSchema } from './auth'
import { userSummarySchema } from './tasks'

export const WIKI_CONTENT_MAX = 200_000

// `[[Title]]` links are found in Markdown text and resolved by title. Brackets and line breaks
// would end the link early; `*`, backticks and backslashes would be read as formatting first.
const wikiTitleSchema = textSchema
  .trim()
  .min(1)
  .max(150)
  .regex(
    /^[^[\]*`\\\r\n]+$/,
    'Title must not contain square brackets, asterisks, backticks, backslashes or line breaks',
  )

const wikiContentSchema = textSchema.max(WIKI_CONTENT_MAX)

/** A page without its content: what trees, search results and link resolution need. */
export const wikiPageSummarySchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  /** Null for a top-level page. */
  parentId: z.uuid().nullable(),
  /** Unique within the project, ignoring case. */
  title: z.string(),
  updatedAt: z.iso.datetime(),
})
export type WikiPageSummary = z.infer<typeof wikiPageSummarySchema>

export const wikiPageSchema = wikiPageSummarySchema.extend({
  /** Markdown. */
  content: z.string(),
  /** Starts at 1 and grows by one with every saved change to the title or content. */
  version: z.number().int(),
  /** Null when the author's account was deleted. */
  updatedBy: userSummarySchema.nullable(),
  createdAt: z.iso.datetime(),
})
export type WikiPage = z.infer<typeof wikiPageSchema>

export const createWikiPageRequestSchema = z.object({
  title: wikiTitleSchema,
  content: wikiContentSchema.default(''),
  parentId: z.uuid().nullable().default(null),
})
export type CreateWikiPageRequest = z.infer<typeof createWikiPageRequestSchema>

export const updateWikiPageRequestSchema = z
  .object({
    title: wikiTitleSchema.optional(),
    content: wikiContentSchema.optional(),
    parentId: z.uuid().nullable().optional(),
    /**
     * The version the edit started from. If the page has moved on since, the update is
     * refused with CONFLICT instead of silently overwriting someone else's change.
     */
    baseVersion: z.number().int().min(1),
  })
  .refine(
    ({ baseVersion: _baseVersion, ...changes }) => Object.keys(changes).length > 0,
    'At least one field besides baseVersion is required',
  )
export type UpdateWikiPageRequest = z.infer<typeof updateWikiPageRequestSchema>

export const wikiListQuerySchema = z.object({
  /** Case-insensitive match in the title or content. */
  q: textSchema.trim().min(1).max(200).optional(),
})
export type WikiListQuery = z.infer<typeof wikiListQuerySchema>

export const wikiVersionSummarySchema = z.object({
  version: z.number().int(),
  title: z.string(),
  author: userSummarySchema.nullable(),
  createdAt: z.iso.datetime(),
})
export type WikiVersionSummary = z.infer<typeof wikiVersionSummarySchema>

export const wikiVersionSchema = wikiVersionSummarySchema.extend({ content: z.string() })
export type WikiVersion = z.infer<typeof wikiVersionSchema>
