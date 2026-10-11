import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Integration tests start an embedded PostgreSQL and hash passwords; on a busy machine
    // (CI, or the other packages' tests running alongside) the defaults are too tight.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/server.ts', 'src/test/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
