import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { loadConfig } from './config'
import { createDatabase } from './db/client'
import { createMailSender, startMailWorker } from './modules/notifications/mailer'

const config = loadConfig(process.env)

// The database is created before the app, so its error handler gets the logger late.
const late: { log?: FastifyInstance['log'] } = {}
const database = await createDatabase(config, (error) => {
  late.log?.error({ err: error }, 'database ping failed')
})
// One sender for account emails (sent by the API) and notification emails (by the worker).
const mail = config.mail
  ? {
      send: createMailSender(config.mail.smtpUrl, config.mail.from),
      publicUrl: config.mail.publicUrl,
    }
  : undefined
const app = await buildApp({
  database,
  mail,
  logLevel: config.logLevel,
  trustProxy: config.trustProxy,
  registrationEnabled: config.registrationEnabled,
  cookieSecure: config.cookieSecure,
  rateLimitMax: config.rateLimitMax,
})
late.log = app.log

if (!(await database.ping())) {
  app.log.fatal({ driver: database.driver }, 'database is unreachable, check DATABASE_URL')
  await database.close()
  process.exit(1)
}
try {
  await database.migrate()
} catch (error) {
  app.log.fatal({ err: error }, 'database migration failed')
  await database.close()
  process.exit(1)
}
app.log.info({ driver: database.driver }, 'database connected and migrated')

const stopMailWorker = mail
  ? startMailWorker({ db: database.db, ...mail, log: app.log })
  : undefined
app.log.info(mail ? 'emails are on' : 'SMTP_URL is not set, notifications stay in the app')

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  app.log.info({ signal }, 'shutting down')
  try {
    await stopMailWorker?.()
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
