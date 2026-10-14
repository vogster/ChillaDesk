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

/**
 * Messages between the replicas of the API, through the database: what one publishes,
 * every one (itself included) hears. Live events travel this way, so a browser hears of a
 * change whichever replica it is connected to.
 */
export interface Relay {
  publish(payload: string): Promise<void>
  /** Starts listening; the returned function stops it. */
  subscribe(handler: (payload: string) => void): Promise<() => Promise<void>>
}

/** PostgreSQL limits a notification to 8000 bytes; senders split what is longer. */
export const RELAY_PAYLOAD_MAX = 7900

const RELAY_CHANNEL = 'chilladesk_events'

export interface Database {
  driver: 'pglite' | 'postgres'
  db: Db
  /** Null for the embedded database, which only ever has one API process. */
  relay: Relay | null
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
    relay: null,
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
    relay: {
      publish: async (payload) => {
        await client.notify(RELAY_CHANNEL, payload)
      },
      // postgres-js keeps a connection of its own for listening and reconnects it.
      subscribe: async (handler) => {
        const { unlisten } = await client.listen(RELAY_CHANNEL, handler)
        return unlisten
      },
    },
    migrate: () => migratePostgres(db, { migrationsFolder: findMigrationsFolder() }),
    ping: () => safePing(db, onPingError),
    close: () => client.end({ timeout: 5 }),
  }
}
