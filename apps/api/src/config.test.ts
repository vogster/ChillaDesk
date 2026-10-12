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

  it('rejects a rate limit that would block every request', () => {
    expect(() => loadConfig({ RATE_LIMIT_MAX: '0' })).toThrow(/RATE_LIMIT_MAX/)
  })

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/)
  })
})
