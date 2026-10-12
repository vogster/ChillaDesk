import { z } from 'zod'

const envSchema = z.object({
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'DATABASE_URL must be a postgres:// connection string')
    .optional(),
  PGLITE_DATA_DIR: z.string().min(1).default('./.data/pglite'),
  TRUST_PROXY: z
    .string()
    .regex(/^(true|false|\d+)$/, 'TRUST_PROXY must be true, false or a number of proxy hops')
    .default('false')
    .transform((value) => (/^\d+$/.test(value) ? Number(value) : value === 'true')),
  COOKIE_SECURE: z
    .enum(['auto', 'true', 'false'])
    .default('auto')
    .transform((value) => (value === 'auto' ? value : value === 'true')),
  REGISTRATION_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(600),
})

export interface AppConfig {
  host: string
  port: number
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL']
  /** When unset, the API falls back to an embedded PGlite database. */
  databaseUrl: string | undefined
  pgliteDataDir: string
  /**
   * Number of reverse proxies in front of the API whose X-Forwarded-* headers are trusted.
   * `true` trusts every hop and is only safe when clients cannot reach the API directly.
   */
  trustProxy: boolean | number
  /** `auto` follows the request protocol; set `true` when TLS ends at an upstream proxy. */
  cookieSecure: boolean | 'auto'
  /** Turn off once your team has signed up to stop strangers from creating accounts. */
  registrationEnabled: boolean
  /**
   * Requests per minute allowed from one client address across the whole API. Everyone
   * behind the same NAT shares it, so a team in one office needs more than a single user.
   */
  rateLimitMax: number
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env)
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid configuration: ${details}`)
  }

  const parsed = result.data
  return {
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    pgliteDataDir: parsed.PGLITE_DATA_DIR,
    trustProxy: parsed.TRUST_PROXY,
    registrationEnabled: parsed.REGISTRATION_ENABLED,
    cookieSecure: parsed.COOKIE_SECURE,
    rateLimitMax: parsed.RATE_LIMIT_MAX,
  }
}
