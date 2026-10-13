import { attachmentSchema, errorResponseSchema } from '@chilladesk/shared'
import type { Readable } from 'node:stream'
import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { Db } from '../../db/client'
import { invalid, notFound } from '../../errors'
import { requireAuth } from '../auth/plugin'
import { getProject } from '../projects/service'
import {
  addAttachment,
  deleteAttachment,
  getAttachmentFile,
  listAttachments,
  type AttachmentOwner,
} from './service'
import type { FileStore } from './storage'

export interface AttachmentRoutesOptions {
  db: Db
  store: FileStore
  /** Largest file accepted, in bytes. */
  maxUploadBytes: number
  /** Bytes all the files of one project may take up together. */
  projectQuotaBytes: number
  /** Uploads one client may make per minute. */
  uploadRateLimitMax: number
}

const projectParams = z.object({ projectId: z.uuid() })
const errors = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  403: errorResponseSchema,
  404: errorResponseSchema,
}

const tooLarge = () =>
  Object.assign(new Error('The file is too large'), { statusCode: 413 as const })

/**
 * Reads past a body nobody wants, so that the answer can be sent: a proxy in front goes on
 * sending the file and only then listens. Far more than a file could be is not waited for.
 */
async function discard(payload: Readable, maxBytes: number): Promise<void> {
  let seen = 0
  try {
    for await (const chunk of payload) {
      seen += (chunk as Buffer).length
      if (seen > maxBytes * 2) {
        payload.destroy()
        return
      }
    }
  } catch {
    // The sender went away; there is nobody left to answer.
  }
}

/** Collects a body of at most `maxBytes`; a longer one is read to its end and refused. */
async function readLimited(payload: Readable, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of payload) {
    size += (chunk as Buffer).length
    if (size > maxBytes) {
      await discard(payload, maxBytes)
      throw tooLarge()
    }
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

/** The header carrying the name of an uploaded file, percent-encoded. */
export const FILE_NAME_HEADER = 'x-file-name'

function fileNameOf(request: FastifyRequest): string {
  const header = request.headers[FILE_NAME_HEADER]
  if (typeof header !== 'string' || header === '') {
    throw invalid(`Send the name of the file in the ${FILE_NAME_HEADER} header`)
  }
  try {
    return decodeURIComponent(header)
  } catch {
    throw invalid(`The ${FILE_NAME_HEADER} header is not properly encoded`)
  }
}

/**
 * Files attached to tasks and wiki pages; mounted under `/api/projects/:projectId`.
 *
 * A file is uploaded as the raw body of the request, with its name in a header: no form
 * encoding to parse, and any HTTP client can do it.
 */
export const attachmentRoutes: FastifyPluginAsyncZod<AttachmentRoutesOptions> = async (
  app,
  { db, store, maxUploadBytes, projectQuotaBytes, uploadRateLimitMax },
) => {
  // In this plugin every body is a file: nothing is parsed, whatever type it claims.
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', async (request: FastifyRequest, payload: Readable) => {
    try {
      // Before a single byte is kept: who is sending, and may they attach files here?
      // The address is not validated yet at this point, so the id is checked here.
      const projectId = z.uuid().safeParse((request.params as { projectId?: unknown }).projectId)
      const userId = requireAuth(request).user.id
      if (!projectId.success) throw notFound('Project')
      await getProject(db, userId, projectId.data, 'member')
    } catch (error) {
      await discard(payload, maxUploadBytes)
      throw error
    }
    return readLimited(payload, maxUploadBytes)
  })

  const tags = ['attachments']
  const userOf = (request: FastifyRequest) => requireAuth(request).user.id
  const uploadDescription =
    `Send the file as the body of the request, its media type in Content-Type and its ` +
    `name, percent-encoded, in the ${FILE_NAME_HEADER} header.`

  /** The same four routes for both things a file can be attached to. */
  function ownerRoutes<Params extends z.ZodType<{ projectId: string }>>(
    path: string,
    params: Params,
    ownerOf: (params: z.infer<Params>) => AttachmentOwner,
    what: string,
  ) {
    const itemParams = z.intersection(params, z.object({ attachmentId: z.uuid() }))

    app.get(
      path,
      {
        schema: {
          tags,
          summary: `Files attached to ${what}`,
          params,
          response: { 200: z.array(attachmentSchema), ...errors },
        },
      },
      (request) => {
        const parsed = request.params as z.infer<Params>
        return listAttachments(db, userOf(request), parsed.projectId, ownerOf(parsed))
      },
    )

    app.post(
      path,
      {
        config: { rateLimit: { max: uploadRateLimitMax, timeWindow: '1 minute' } },
        schema: {
          tags,
          summary: `Attach a file to ${what}`,
          description: uploadDescription,
          params,
          response: { 201: attachmentSchema, ...errors, 409: errorResponseSchema },
        },
      },
      async (request, reply) => {
        const parsed = request.params as z.infer<Params>
        if (!Buffer.isBuffer(request.body)) throw invalid('The file is empty')
        const attachment = await addAttachment(
          db,
          store,
          userOf(request),
          parsed.projectId,
          ownerOf(parsed),
          {
            fileName: fileNameOf(request),
            mimeType: request.headers['content-type'],
            content: request.body,
          },
          { projectQuotaBytes },
        )
        return reply.code(201).send(attachment)
      },
    )

    app.delete(
      `${path}/:attachmentId`,
      {
        schema: {
          tags,
          summary: `Remove a file from ${what}`,
          params: itemParams,
          response: { 204: z.null(), ...errors },
        },
      },
      async (request, reply) => {
        const parsed = request.params as z.infer<Params> & { attachmentId: string }
        await deleteAttachment(
          db,
          store,
          userOf(request),
          parsed.projectId,
          ownerOf(parsed),
          parsed.attachmentId,
        )
        return reply.code(204).send(null)
      },
    )
  }

  ownerRoutes(
    '/tasks/:taskId/attachments',
    projectParams.extend({ taskId: z.uuid() }),
    ({ taskId }) => ({ taskId }),
    'a task',
  )
  ownerRoutes(
    '/wiki/:pageId/attachments',
    projectParams.extend({ pageId: z.uuid() }),
    ({ pageId }) => ({ wikiPageId: pageId }),
    'a wiki page',
  )

  app.get(
    '/attachments/:attachmentId',
    {
      schema: {
        tags,
        summary: 'Download an attached file',
        description:
          'Pictures (PNG, JPEG, GIF, WebP) are sent to be shown in place; everything else ' +
          'as a download, whatever type it was uploaded with.',
        params: projectParams.extend({ attachmentId: z.uuid() }),
      },
    },
    async (request, reply) => {
      const { projectId, attachmentId } = request.params
      const file = await getAttachmentFile(db, userOf(request), projectId, attachmentId)
      // RFC 5987: the plain form for old clients, the encoded one for the real name.
      const fallback = file.fileName.replace(/[^\x20-\x7e]|["\\]/g, '_')
      const encoded = encodeURIComponent(file.fileName).replace(
        /['()*]/g,
        (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
      )
      const disposition = `${file.inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`
      return (
        reply
          .header('Content-Type', file.mimeType)
          .header('Content-Length', file.size)
          .header('Content-Disposition', disposition)
          // The file comes from a user and is served from the site's own address: it must
          // never be read as a page or run anything, whatever is inside.
          .header('X-Content-Type-Options', 'nosniff')
          .header('Content-Security-Policy', "default-src 'none'; sandbox")
          // Other sites may not embed it, and no copy outlives the right to see it.
          .header('Cross-Origin-Resource-Policy', 'same-origin')
          .header('Cache-Control', 'private, no-cache')
          .send(store.open(file.storageKey))
      )
    },
  )
}
