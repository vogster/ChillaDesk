import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestContext, type TestContext } from '../test/harness'

let ctx: TestContext
let webDir: string
const SCRIPT = `console.log(${JSON.stringify('x'.repeat(5000))})`

beforeAll(async () => {
  webDir = await mkdtemp(join(tmpdir(), 'chilladesk-web-'))
  await mkdir(join(webDir, 'assets'))
  await writeFile(join(webDir, 'index.html'), '<!doctype html><title>ChillaDesk</title>')
  await writeFile(join(webDir, 'assets', 'index-abc123.js'), SCRIPT)
  ctx = await createTestContext({ webDir })
})

afterAll(async () => {
  await ctx.close()
  await rm(webDir, { recursive: true, force: true })
})

const get = (url: string, headers: Record<string, string> = {}) =>
  ctx.app.inject({ method: 'GET', url, headers })

describe('the web app served by the API', () => {
  it('serves the app for its own pages, never to be cached', async () => {
    for (const url of ['/', '/projects/123', '/projects/123/wiki/abc', '/login']) {
      const response = await get(url)
      expect(response.statusCode, url).toBe(200)
      expect(response.body).toContain('<title>ChillaDesk</title>')
      expect(response.headers['cache-control']).toBe('no-cache')
    }
  })

  it('keeps built assets cached for good and compresses them', async () => {
    const response = await get('/assets/index-abc123.js', { 'accept-encoding': 'gzip' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect(response.headers['content-encoding']).toBe('gzip')
  })

  it('still answers unknown API routes and other methods with the API error', async () => {
    const missing = await get('/api/nothing-here')
    const posted = await ctx.app.inject({ method: 'POST', url: '/projects/123' })

    expect([missing.statusCode, posted.statusCode]).toEqual([404, 404])
    expect(missing.json()).toMatchObject({ error: { code: 'NOT_FOUND' } })
  })

  it('sets the security headers the proxy sets otherwise', async () => {
    const page = await get('/')
    const api = await get('/api/health')

    for (const response of [page, api]) {
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['x-frame-options']).toBe('DENY')
      expect(response.headers['referrer-policy']).toBe('same-origin')
    }
    expect(api.headers['cache-control']).toBe('no-store')
  })
})
