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
    })

    expect(config).toEqual({
      host: '127.0.0.1',
      port: 8080,
      logLevel: 'debug',
      databaseUrl: 'postgres://user:pass@db:5432/chillawiki',
      pgliteDataDir: '/tmp/pg',
      trustProxy: true,
    })
  })

  it('throws a readable error for an invalid port', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid configuration.*PORT/s)
  })

  it('rejects a non-postgres DATABASE_URL', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/DATABASE_URL/)
  })
})
