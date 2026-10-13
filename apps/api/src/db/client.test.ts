import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDatabase, createMemoryDatabase } from './client'

describe('database client', () => {
  it('pings an in-memory PGlite database', async () => {
    const database = await createMemoryDatabase()

    await expect(database.ping()).resolves.toBe(true)
    await database.close()
  })

  it('reports false from ping after the database is closed', async () => {
    const database = await createMemoryDatabase()
    await database.close()

    await expect(database.ping()).resolves.toBe(false)
  })

  it('uses PGlite on disk when no DATABASE_URL is configured', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'chilladesk-pglite-'))
    try {
      const database = await createDatabase({ databaseUrl: undefined, pgliteDataDir: dataDir })

      expect(database.driver).toBe('pglite')
      await expect(database.ping()).resolves.toBe(true)
      await database.close()
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('uses postgres-js when DATABASE_URL is configured', async () => {
    const onPingError = vi.fn()
    const database = await createDatabase(
      { databaseUrl: 'postgres://nobody:nothing@127.0.0.1:1/none', pgliteDataDir: './unused' },
      onPingError,
    )

    expect(database.driver).toBe('postgres')
    await expect(database.ping()).resolves.toBe(false)
    expect(onPingError).toHaveBeenCalledWith(expect.any(Error))
    await database.close()
  })
})
