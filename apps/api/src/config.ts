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
  SMTP_URL: z
    .string()
    .regex(/^smtps?:\/\//, 'SMTP_URL must be an smtp:// or smtps:// URL')
    .optional(),
  MAIL_FROM: z.string().min(3).optional(),
  PUBLIC_URL: z
    .string()
    .regex(/^https?:\/\//, 'PUBLIC_URL must be an http:// or https:// URL')
    .optional(),
})

export interface MailConfig {
  smtpUrl: string
  /** The sender, e.g. `ChillaWiki <wiki@example.com>`. */
  from: string
  /** Where people open ChillaWiki; emails link there. */
  publicUrl: string
}

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
  /** Null until SMTP is configured: notifications then stay in the app only. */
  mail: MailConfig | null
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  // docker compose passes a variable that is not set as an empty string; that means "unset".
  const given = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''))
  const result = envSchema.safeParse(given)
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ')
    throw new Error(`Invalid configuration: ${details}`)
  }

  const parsed = result.data
  const { SMTP_URL: smtpUrl, MAIL_FROM: from, PUBLIC_URL: publicUrl } = parsed
  if (smtpUrl && !(from && publicUrl)) {
    throw new Error('Invalid configuration: SMTP_URL needs MAIL_FROM and PUBLIC_URL as well')
  }
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
    mail: smtpUrl && from && publicUrl ? { smtpUrl, from, publicUrl } : null,
  }
}
