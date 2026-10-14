import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': apiTarget },
  },
  build: {
    rolldownOptions: {
      output: {
        // Libraries change less often than the app, so they get chunks of their own that
        // browsers keep cached across releases; Markdown and dragging load with the pages
        // that use them.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler|react-router|@tanstack)[\\/]/,
              priority: 3,
            },
            {
              name: 'markdown',
              test: /node_modules[\\/](react-markdown|remark-|rehype-|micromark|mdast-|hast-|unist-|unified|vfile|property-information|space-separated-tokens|comma-separated-tokens|decode-named-character-reference|character-entities|html-url-attributes|devlop|bail|trough|zwitch|ccount|markdown-table|longest-streak|estree-util|style-to|inline-style-parser|trim-lines|is-plain-obj)/,
              priority: 2,
            },
            { name: 'dnd', test: /node_modules[\\/]@dnd-kit[\\/]/, priority: 2 },
            { name: 'zod', test: /node_modules[\\/]zod[\\/]/, priority: 2 },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // UI flows type character by character and slow down a lot under coverage and load.
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/main.tsx', 'src/test/**'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
})
