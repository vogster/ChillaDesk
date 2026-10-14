import { describe, expect, it } from 'vitest'
import { loadConfig } from './config'

describe('loadConfig', () => {
  it('applies defaults for an empty environment', () => {
    expect(loadConfig({})).toEqual({
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      databaseUrl: undefined,
      pgliteDataDir: './.data/pglite',
      trustProxy: false,
      registrationEnabled: true,
      cookieSecure: 'auto',
      rateLimitMax: 600,
      filesDir: './.data/files',
      maxUploadMb: 10,
      projectFilesMb: 1024,
      mail: null,
      publicUrl: null,
      webhooksAllowPrivate: false,
    })
  })

  it('reads values from the environment', () => {
    const config = loadConfig({
      HOST: '127.0.0.1',
      PORT: '8080',
      LOG_LEVEL: 'debug',
      DATABASE_URL: 'postgres://user:pass@db:5432/chillawiki',
      PGLITE_DATA_DIR: '/tmp/pg',
      TRUST_PROXY: 'true',
      REGISTRATION_ENABLED: 'false',
      COOKIE_SECURE: 'true',
      RATE_LIMIT_MAX: '2000',
    })

    expect(config).toEqual({
      host: '127.0.0.1',
      port: 8080,
      logLevel: 'debug',
      databaseUrl: 'postgres://user:pass@db:5432/chillawiki',
      pgliteDataDir: '/tmp/pg',
      trustProxy: true,
      registrationEnabled: false,
      cookieSecure: true,
      rateLimitMax: 2000,
      filesDir: './.data/files',
      maxUploadMb: 10,
      projectFilesMb: 1024,
      mail: null,
      publicUrl: null,
      webhooksAllowPrivate: false,
    })
  })

  it('throws a readable error for an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid configuration.*PORT/s)
  })

  it('accepts a proxy hop count for TRUST_PROXY', () => {
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(1)
    expect(loadConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(false)
    expect(() => loadConfig({ TRUST_PROXY: 'yes' })).toThrow(/TRUST_PROXY/)
  })

  it('lets COOKIE_SECURE be switched off explicitly', () => {
    expect(loadConfig({ COOKIE_SECURE: 'false' }).cookieSecure).toBe(false)
  })

  it('lets webhooks reach private addresses only when told to', () => {
    expect(loadConfig({ WEBHOOKS_ALLOW_PRIVATE: 'true' }).webhooksAllowPrivate).toBe(true)
    expect(() => loadConfig({ WEBHOOKS_ALLOW_PRIVATE: 'yes' })).toThrow(/WEBHOOKS_ALLOW_PRIVATE/)
  })

  it('keeps PUBLIC_URL for links even without email', () => {
    expect(loadConfig({ PUBLIC_URL: 'https://desk.example.com' }).publicUrl).toBe(
      'https://desk.example.com',
    )
  })

  it('rejects a rate limit that would block every request', () => {
    expect(() => loadConfig({ RATE_LIMIT_MAX: '0' })).toThrow(/RATE_LIMIT_MAX/)
  })

  it('turns notification emails on only when SMTP is fully configured', () => {
    const mail = {
      SMTP_URL: 'smtp://user:secret@mail.example.com:587',
      MAIL_FROM: 'ChillaDesk <wiki@example.com>',
      PUBLIC_URL: 'https://wiki.example.com',
    }

    expect(loadConfig({}).mail).toBeNull()
    expect(loadConfig(mail).mail).toEqual({
      smtpUrl: mail.SMTP_URL,
      from: mail.MAIL_FROM,
      publicUrl: mail.PUBLIC_URL,
    })
    expect(() => loadConfig({ SMTP_URL: mail.SMTP_URL })).toThrow(/MAIL_FROM and PUBLIC_URL/)
    expect(() => loadConfig({ ...mail, SMTP_URL: 'mail.example.com' })).toThrow(/SMTP_URL/)
    expect(() => loadConfig({ ...mail, PUBLIC_URL: 'wiki.example.com' })).toThrow(/PUBLIC_URL/)
  })

  it('treats an empty variable as not set, the way docker compose passes it', () => {
    const config = loadConfig({ SMTP_URL: '', MAIL_FROM: '', PUBLIC_URL: '', PORT: '' })

    expect(config).toMatchObject({ mail: null, port: 3000 })
  })

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/)
  })
})
