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
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
})

export interface AppConfig {
  host: string
  port: number
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL']
  /** When unset, the API falls back to an embedded PGlite database. */
  databaseUrl: string | undefined
  pgliteDataDir: string
  /** Enable only when the API sits behind a reverse proxy that sets X-Forwarded-* headers. */
  trustProxy: boolean
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
  }
}
