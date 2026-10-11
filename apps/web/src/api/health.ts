import { healthResponseSchema, type HealthResponse } from '@chillawiki/shared'

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/api/health')
  // A degraded service answers 503 with a valid body, so validate the body instead of the status.
  const result = healthResponseSchema.safeParse(await response.json())
  if (!result.success) {
    throw new Error(`Unexpected health response (HTTP ${response.status})`)
  }
  return result.data
}
