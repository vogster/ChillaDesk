import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/**
 * Browser tests against the real app: the API on an empty embedded database of its own and
 * the built web app in front of it, both started for the run.
 */
const API_PORT = 3100
const WEB_PORT = 5180
const dataDir = mkdtempSync(join(tmpdir(), 'chilladesk-e2e-'))

export default defineConfig({
  testDir: './tests',
  // Every test signs up its own people and projects, so tests never see each other's data.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    locale: 'en-US',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // A browser that is already installed, if named (msedge, chrome); CI downloads its own.
        ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
      },
    },
  ],
  webServer: [
    {
      command: 'corepack pnpm --filter @chilladesk/api exec tsx src/server.ts',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        HOST: '127.0.0.1',
        PGLITE_DATA_DIR: join(dataDir, 'db'),
        FILES_DIR: join(dataDir, 'files'),
        LOG_LEVEL: 'warn',
        // Tests sign up many people from one address.
        RATE_LIMIT_MAX: '100000',
        AUTH_RATE_LIMIT_MAX: '1000',
      },
    },
    {
      // The built app, as it is shipped: split into chunks, no dev server reloading.
      command: `corepack pnpm --filter @chilladesk/web exec vite build && corepack pnpm --filter @chilladesk/web exec vite preview --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
})
