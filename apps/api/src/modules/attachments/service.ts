import {
  ATTACHMENT_NAME_MAX,
  attachmentUrl,
  INLINE_IMAGE_TYPES,
  type Attachment,
} from '@chilladesk/shared'
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { attachments, projects, users, wikiPages } from '../../db/schema'
import { conflict, invalid, isForeignKeyViolation, notFound } from '../../errors'
import { getProject } from '../projects/service'
import { assertTaskInProject } from '../tasks/service'
import type { FileStore } from './storage'

/** Files one task or page can carry. */
export const MAX_ATTACHMENTS_PER_ITEM = 50

/** What a file is attached to. */
export type AttachmentOwner = { taskId: string } | { wikiPageId: string }

const isInlineImage = (mimeType: string): boolean =>
  (INLINE_IMAGE_TYPES as readonly string[]).includes(mimeType)

/**
 * A file name safe to show and to send back in a header: no path, no control characters,
 * not empty, not endless. Characters that reorder or hide text are dropped too, so a name
 * cannot be made to look like it ends in another extension than it does.
 */
// Control characters, zero-width characters and the bidirectional overrides.
// eslint-disable-next-line no-control-regex -- control characters are exactly the target
const UNSAFE_IN_NAME = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g

export function cleanFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? ''
  const cleaned = base.replace(UNSAFE_IN_NAME, '').trim()
  return (cleaned || 'file').slice(0, ATTACHMENT_NAME_MAX)
}

/** The media type as declared, reduced to `type/subtype`; unknown shapes become a download. */
export function cleanMimeType(raw: string | undefined): string {
  const [type = ''] = (raw ?? '').toLowerCase().split(';')
  return /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/.test(type.trim())
    ? type.trim()
    : 'application/octet-stream'
}

type AttachmentRow = typeof attachments.$inferSelect
type Uploader = { id: string | null; name: string | null; email: string | null } | null

function toAttachment(row: AttachmentRow, uploader: Uploader): Attachment {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    size: row.size,
    isImage: isInlineImage(row.mimeType),
    url: attachmentUrl(row.projectId, row.id),
    uploadedBy:
      uploader?.id && uploader.name !== null && uploader.email !== null
        ? { id: uploader.id, name: uploader.name, email: uploader.email }
        : null,
    createdAt: row.createdAt.toISOString(),
  }
}

const ownerFilter = (owner: AttachmentOwner) =>
  'taskId' in owner
    ? eq(attachments.taskId, owner.taskId)
    : eq(attachments.wikiPageId, owner.wikiPageId)

async function assertOwnerInProject(db: Db, projectId: string, owner: AttachmentOwner) {
  if ('taskId' in owner) return assertTaskInProject(db, projectId, owner.taskId)
  const [page] = await db
    .select({ id: wikiPages.id })
    .from(wikiPages)
    .where(and(eq(wikiPages.projectId, projectId), eq(wikiPages.id, owner.wikiPageId)))
  if (!page) throw notFound('Wiki page')
}

const uploader = { id: users.id, name: users.name, email: users.email }

export async function listAttachments(
  db: Db,
  userId: string,
  projectId: string,
  owner: AttachmentOwner,
): Promise<Attachment[]> {
  await getProject(db, userId, projectId)
  await assertOwnerInProject(db, projectId, owner)
  const rows = await db
    .select({ attachment: attachments, uploader })
    .from(attachments)
    .leftJoin(users, eq(users.id, attachments.uploadedBy))
    .where(and(eq(attachments.projectId, projectId), ownerFilter(owner)))
    .orderBy(asc(attachments.createdAt), asc(attachments.id))
  return rows.map((row) => toAttachment(row.attachment, row.uploader))
}

export interface Upload {
  fileName: string
  mimeType: string | undefined
  content: Buffer
}

export interface UploadLimits {
  /** Bytes all the files of one project may take up together. */
  projectQuotaBytes: number
}

export async function addAttachment(
  db: Db,
  store: FileStore,
  userId: string,
  projectId: string,
  owner: AttachmentOwner,
  upload: Upload,
  { projectQuotaBytes }: UploadLimits,
): Promise<Attachment> {
  await getProject(db, userId, projectId, 'member')
  await assertOwnerInProject(db, projectId, owner)
  if (upload.content.length === 0) throw invalid('The file is empty')

  let storageKey: string | undefined
  try {
    return await db.transaction(async (tx) => {
      // One upload per project at a time, so the two limits below cannot be raced past.
      await tx
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, projectId))
        .for('update')
      const [here] = await tx
        .select({ total: count() })
        .from(attachments)
        .where(and(eq(attachments.projectId, projectId), ownerFilter(owner)))
      if ((here?.total ?? 0) >= MAX_ATTACHMENTS_PER_ITEM) {
        throw conflict(`At most ${MAX_ATTACHMENTS_PER_ITEM} files can be attached here`)
      }
      const [used] = await tx
        .select({ bytes: sql<number>`coalesce(sum(${attachments.size}), 0)`.mapWith(Number) })
        .from(attachments)
        .where(eq(attachments.projectId, projectId))
      if ((used?.bytes ?? 0) + upload.content.length > projectQuotaBytes) {
        throw conflict('This project has no room for more files, remove some first')
      }

      storageKey = await store.save(upload.content)
      const [created] = await tx
        .insert(attachments)
        .values({
          projectId,
          ...owner,
          fileName: cleanFileName(upload.fileName),
          mimeType: cleanMimeType(upload.mimeType),
          size: upload.content.length,
          storageKey,
          uploadedBy: userId,
        })
        .returning()
      if (!created) throw new Error('Insert returned no attachment row')
      const [author] = await tx.select(uploader).from(users).where(eq(users.id, userId))
      return toAttachment(created, author ?? null)
    })
  } catch (error) {
    // Whatever went wrong after the bytes were written, they must not stay behind.
    if (storageKey) await store.remove(storageKey)
    // The task or page was deleted while the file was on its way.
    if (isForeignKeyViolation(error)) throw notFound('taskId' in owner ? 'Task' : 'Wiki page')
    throw error
  }
}

export interface StoredFile {
  fileName: string
  mimeType: string
  size: number
  /** Whether a browser may show it in place instead of saving it. */
  inline: boolean
  storageKey: string
}

/** What is needed to send a file back. Any member of the project may read it. */
export async function getAttachmentFile(
  db: Db,
  userId: string,
  projectId: string,
  attachmentId: string,
): Promise<StoredFile> {
  await getProject(db, userId, projectId)
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.projectId, projectId), eq(attachments.id, attachmentId)))
  if (!row) throw notFound('Attachment')
  const inline = isInlineImage(row.mimeType)
  return {
    fileName: row.fileName,
    // Anything but a known picture is sent as opaque bytes, whatever it claimed to be.
    mimeType: inline ? row.mimeType : 'application/octet-stream',
    size: row.size,
    inline,
    storageKey: row.storageKey,
  }
}

export async function deleteAttachment(
  db: Db,
  store: FileStore,
  userId: string,
  projectId: string,
  owner: AttachmentOwner,
  attachmentId: string,
): Promise<void> {
  await getProject(db, userId, projectId, 'member')
  const [removed] = await db
    .delete(attachments)
    .where(
      and(
        eq(attachments.projectId, projectId),
        eq(attachments.id, attachmentId),
        ownerFilter(owner),
      ),
    )
    .returning({ storageKey: attachments.storageKey })
  if (!removed) throw notFound('Attachment')
  await store.remove(removed.storageKey)
}

const SWEEP_CHUNK = 1000

/**
 * Removes the files of attachments whose rows are gone: deleting a task, a page or a
 * project removes the rows at once, and this catches up with the bytes.
 */
export function sweepFiles(db: Db, store: FileStore, now?: Date): Promise<number> {
  return store.sweep(async (keys) => {
    const referenced = new Set<string>()
    // In portions: one statement cannot carry more than some tens of thousands of values.
    for (let start = 0; start < keys.length; start += SWEEP_CHUNK) {
      const rows = await db
        .select({ storageKey: attachments.storageKey })
        .from(attachments)
        .where(inArray(attachments.storageKey, keys.slice(start, start + SWEEP_CHUNK)))
      for (const row of rows) referenced.add(row.storageKey)
    }
    return referenced
  }, now)
}
