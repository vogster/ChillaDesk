import type { FastifyInstance } from 'fastify'
import { buildApp } from './app'
import { loadConfig } from './config'
import { createDatabase } from './db/client'
import { sweepFiles } from './modules/attachments/service'
import { createMailSender, startMailWorker } from './modules/notifications/mailer'
import { startWebhookWorker } from './modules/webhooks/delivery'

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
  registration: config.registration,
  cookieSecure: config.cookieSecure,
  rateLimitMax: config.rateLimitMax,
  authRateLimitMax: config.authRateLimitMax,
  filesDir: config.filesDir,
  maxUploadBytes: config.maxUploadMb * 1024 * 1024,
  projectQuotaBytes: config.projectFilesMb * 1024 * 1024,
  webhooksAllowPrivate: config.webhooksAllowPrivate,
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
const stopWebhookWorker = startWebhookWorker({
  db: database.db,
  publicUrl: config.publicUrl,
  allowPrivate: config.webhooksAllowPrivate,
  log: app.log,
})
app.log.info(mail ? 'emails are on' : 'SMTP_URL is not set, notifications stay in the app')

// Files whose task, page or project was deleted are removed from the disk now and then.
const FILE_SWEEP_INTERVAL_MS = 60 * 60 * 1000
const sweep = () =>
  sweepFiles(database.db, app.files).then(
    (removed) => removed > 0 && app.log.info({ removed }, 'removed files nothing refers to'),
    (error: unknown) => app.log.warn({ err: error }, 'sweeping attached files failed'),
  )
void sweep()
const sweepTimer = setInterval(() => void sweep(), FILE_SWEEP_INTERVAL_MS)
sweepTimer.unref()

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  app.log.info({ signal }, 'shutting down')
  try {
    await stopMailWorker?.()
    await stopWebhookWorker()
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
