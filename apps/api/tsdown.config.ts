import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/server.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // Workspace packages ship TypeScript sources, so they must be bundled in.
  deps: { alwaysBundle: [/^@chillawiki\//] },
})
