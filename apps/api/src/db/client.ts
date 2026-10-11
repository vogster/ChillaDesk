import { mkdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { AppConfig } from '../config'

type DrizzleDb = ReturnType<typeof drizzlePglite> | ReturnType<typeof drizzlePostgres>

export interface Database {
  driver: 'pglite' | 'postgres'
  db: DrizzleDb
  /** Resolves to false instead of throwing so health checks can report the outage. */
  ping(): Promise<boolean>
  close(): Promise<void>
}

export type PingErrorHandler = (error: unknown) => void

async function safePing(db: DrizzleDb, onPingError?: PingErrorHandler): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch (error) {
    onPingError?.(error)
    return false
  }
}

function fromPglite(client: PGlite, onPingError?: PingErrorHandler): Database {
  const db = drizzlePglite(client)
  return {
    driver: 'pglite',
    db,
    ping: () => (client.closed ? Promise.resolve(false) : safePing(db, onPingError)),
    close: async () => {
      if (!client.closed) await client.close()
    },
  }
}

export async function createMemoryDatabase(): Promise<Database> {
  return fromPglite(await PGlite.create())
}

export async function createDatabase(
  config: Pick<AppConfig, 'databaseUrl' | 'pgliteDataDir'>,
  onPingError?: PingErrorHandler,
): Promise<Database> {
  if (!config.databaseUrl) {
    await mkdir(config.pgliteDataDir, { recursive: true })
    return fromPglite(await PGlite.create(config.pgliteDataDir), onPingError)
  }

  const client = postgres(config.databaseUrl, { max: 10, connect_timeout: 5 })
  const db = drizzlePostgres(client)
  return {
    driver: 'postgres',
    db,
    ping: () => safePing(db, onPingError),
    close: () => client.end({ timeout: 5 }),
  }
}
