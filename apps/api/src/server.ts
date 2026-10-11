import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { loadConfig } from './config'
import { createDatabase } from './db/client'

const config = loadConfig(process.env)

// The database is created before the app, so its error handler gets the logger late.
const late: { log?: FastifyInstance['log'] } = {}
const database = await createDatabase(config, (error) => {
  late.log?.error({ err: error }, 'database ping failed')
})
const app = await buildApp({
  database,
  logLevel: config.logLevel,
  trustProxy: config.trustProxy,
})
late.log = app.log

if (!(await database.ping())) {
  app.log.fatal({ driver: database.driver }, 'database is unreachable, check DATABASE_URL')
  await database.close()
  process.exit(1)
}
app.log.info({ driver: database.driver }, 'database connected')

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  app.log.info({ signal }, 'shutting down')
  try {
    await app.close()
    await database.close()
    process.exit(0)
  } catch (error) {
    app.log.error({ err: error }, 'graceful shutdown failed')
    process.exit(1)
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error({ err: error }, 'failed to start server')
  await database.close()
  process.exit(1)
}
