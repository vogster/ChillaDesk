import fastifyCompress from '@fastify/compress'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

/** Built files have their content hash in the name, so a browser may keep them for good. */
const HASHED_ASSET = /[\\/]assets[\\/]/

/**
 * Serves the built web app from the API itself, for the image that runs everything in one
 * container: what Caddy does in front of the API otherwise. Files are compressed, hashed
 * assets are cached for good, and the security headers Caddy sets are set here.
 * Paths the app handles in the browser (`/projects/…`) get `index.html`; see `isAppPath`.
 */
export async function serveWebApp(app: FastifyInstance, webDir: string): Promise<void> {
  // The event stream takes over the raw response, so compression never holds it back.
  await app.register(fastifyCompress, { global: true })
  await app.register(fastifyStatic, {
    root: webDir,
    index: ['index.html'],
    cacheControl: false,
    setHeaders: (response, path) => {
      response.header(
        'Cache-Control',
        HASHED_ASSET.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache',
      )
    },
  })

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Referrer-Policy', 'same-origin')
    // API answers can carry session tokens and private data; downloads set their own.
    if (request.url.startsWith('/api/') && !reply.hasHeader('Cache-Control')) {
      reply.header('Cache-Control', 'no-store')
    }
  })
}

/** Whether a request that found no route is a page of the web app rather than an API call. */
export function isAppPath(method: string, url: string): boolean {
  return (method === 'GET' || method === 'HEAD') && !url.startsWith('/api/') && url !== '/api'
}
