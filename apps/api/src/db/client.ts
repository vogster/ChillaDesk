import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import { migrate as migratePostgres } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import type { AppConfig } from '../config'
import * as schema from './schema'

/** Driver-independent handle: services depend on this, never on PGlite or postgres-js directly. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

/** The handle passed to a `db.transaction` callback. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** Anything that can run queries: the database itself or an open transaction. */
export type Executor = Db | Tx

export interface Database {
  driver: 'pglite' | 'postgres'
  db: Db
  /** Applies pending SQL migrations from the `drizzle` folder. */
  migrate(): Promise<void>
  /** Resolves to false instead of throwing so health checks can report the outage. */
  ping(): Promise<boolean>
  close(): Promise<void>
}

export type PingErrorHandler = (error: unknown) => void

// The folder sits next to `src` in development and next to `dist` in the built image.
function findMigrationsFolder(): string {
  const candidates = ['../drizzle', '../../drizzle'].map((relative) =>
    fileURLToPath(new URL(relative, import.meta.url)),
  )
  const found = candidates.find((folder) => existsSync(join(folder, 'meta', '_journal.json')))
  if (!found) {
    throw new Error(`Migrations folder not found, looked in: ${candidates.join(', ')}`)
  }
  return found
}

async function safePing(db: Db, onPingError?: PingErrorHandler): Promise<boolean> {
  try {
    await db.execute(sql`select 1`)
    return true
  } catch (error) {
    onPingError?.(error)
    return false
  }
}

function fromPglite(client: PGlite, onPingError?: PingErrorHandler): Database {
  const db = drizzlePglite(client, { schema })
  return {
    driver: 'pglite',
    db,
    migrate: () => migratePglite(db, { migrationsFolder: findMigrationsFolder() }),
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

  const client = postgres(config.databaseUrl, { max: 10, connect_timeout: 5, onnotice: () => {} })
  const db = drizzlePostgres(client, { schema })
  return {
    driver: 'postgres',
    db,
    migrate: () => migratePostgres(db, { migrationsFolder: findMigrationsFolder() }),
    ping: () => safePing(db, onPingError),
    close: () => client.end({ timeout: 5 }),
  }
}
