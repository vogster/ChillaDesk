import { z } from 'zod'
import { userSummarySchema } from './tasks'

/** Types a browser may show in place; everything else is only ever offered as a download. */
export const INLINE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const

export const ATTACHMENT_NAME_MAX = 200

/** A file attached to a task or a wiki page. */
export const attachmentSchema = z.object({
  id: z.uuid(),
  fileName: z.string(),
  mimeType: z.string(),
  /** In bytes. */
  size: z.number().int().min(0),
  /** Whether it can be shown as a picture, e.g. inside Markdown. */
  isImage: z.boolean(),
  /** Where to get the file, relative to the site: `/api/projects/…/attachments/…`. */
  url: z.string(),
  uploadedBy: userSummarySchema.nullable(),
  createdAt: z.iso.datetime(),
})
export type Attachment = z.infer<typeof attachmentSchema>

/** The address of an attachment; the same shape Markdown images are allowed to point at. */
export const attachmentUrl = (projectId: string, attachmentId: string) =>
  `/api/projects/${projectId}/attachments/${attachmentId}`

/** Matches `attachmentUrl(…)` and nothing else. */
export const ATTACHMENT_URL_PATTERN =
  /^\/api\/projects\/[0-9a-f-]{36}\/attachments\/[0-9a-f-]{36}$/i
