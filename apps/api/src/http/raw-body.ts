import type { Readable } from 'node:stream'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { notFound } from '../errors'
import { requireAuth } from '../modules/auth/plugin'
import type { AuthContext } from '../modules/auth/service'

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

/** Decides, before a byte of the body is kept, whether this sender may send it. */
export type BodyAuthorizer = (
  auth: AuthContext,
  projectId: string,
  request: FastifyRequest,
) => Promise<void>

/**
 * Makes every body of the plugin's routes a raw Buffer, whatever type it claims, for routes
 * that take a whole file. The sender is checked first (signed in, a valid project id,
 * whatever `authorize` requires), so nobody unknown can make the server hold a large body
 * in memory; the body is limited to `maxBytes`.
 *
 * Use it inside a plugin of its own: it replaces every body parser of that plugin.
 */
export function acceptRawBodies(
  app: FastifyInstance,
  { maxBytes, authorize }: { maxBytes: number; authorize: BodyAuthorizer },
): void {
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', async (request: FastifyRequest, payload: Readable) => {
    try {
      // The address is not validated yet at this point, so the id is checked here.
      const projectId = z.uuid().safeParse((request.params as { projectId?: unknown }).projectId)
      const auth = requireAuth(request)
      if (!projectId.success) throw notFound('Project')
      await authorize(auth, projectId.data, request)
    } catch (error) {
      await discard(payload, maxBytes)
      throw error
    }
    return readLimited(payload, maxBytes)
  })
}
